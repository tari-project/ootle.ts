//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// A deterministic, WASM-free `StealthCryptoProvider` for unit tests. **Not**
// cryptographically meaningful — produces stable, distinguishable stand-ins
// keyed off the input bytes so tests can assert round-trips and wiring.
//
// Not re-exported from the package root; tests import via relative subpath.

import type { StealthCryptoProvider } from "../stealth/crypto-provider";
import { Mask, SCALAR_LENGTH, type DecryptedData, type Output } from "../stealth/primitives";
import {
  BalanceProofSignature,
  StealthInput,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
} from "../stealth/statements";
import { microTariString } from "../helpers/amount";
import { toHexStr } from "../helpers/hex";
import { CryptoBridgeError, InvalidArgumentError } from "../errors";

/** A simple deterministic 32-byte digest of arbitrary inputs (NOT cryptographic). */
function fakeScalar(...seeds: (string | number | bigint)[]): Uint8Array {
  const seed = seeds.map(String).join("|");
  const out = new Uint8Array(SCALAR_LENGTH);
  // FNV-1a-ish rolling fill so distinct seeds give distinct (and stable) bytes.
  let h = 0x811c9dc5;
  for (let i = 0; i < SCALAR_LENGTH; i++) {
    for (let j = i; j < seed.length; j += SCALAR_LENGTH) {
      h = (h ^ seed.charCodeAt(j)) >>> 0;
      h = (h * 0x01000193) >>> 0;
    }
    h = (h ^ (i + 1)) >>> 0;
    h = (h * 0x01000193) >>> 0;
    out[i] = h & 0xff;
  }
  return out;
}

/** Hex of a byte array, for keying fake scalars off raw inputs. */
function key(bytes: Uint8Array): string {
  return toHexStr(bytes);
}

/**
 * The receive round-trip the fake encodes: a deterministic value + mask packed into the
 * "encrypted data" / "AEAD key" pair so {@link FakeStealthCrypto.unblindOutput} can
 * recover them, and throw when the AEAD key doesn't match the one the data was sealed to.
 */
interface FakeSealedOutput {
  value: string;
  maskHex: string;
  aeadKeyHex: string;
  memo?: string;
}

/**
 * Deterministic fake {@link StealthCryptoProvider} for WASM-free unit tests.
 *
 * Round-trip guarantees relied on by downstream tests:
 * - `aggregateInputMasks(masks)` is a stable digest of the input masks (non-empty per
 *   the interface contract — the empty case is the caller's responsibility).
 * - {@link sealFakeOutput} + {@link unblindOutput} recover value + mask, and `unblindOutput`
 *   **throws** on a mismatched AEAD key (the "not owned" signal).
 * - all statement / signature outputs are stable for the same inputs.
 */
export class FakeStealthCrypto implements StealthCryptoProvider {
  public async generateOutputsStatement(
    specs: Output[],
    revealedOutputAmount: bigint,
  ): Promise<{ statement: StealthOutputsStatement; outputMask: Mask }> {
    // A stable, parseable structural stand-in for the WASM outputs statement.
    const json = JSON.stringify({
      outputs: specs.map((s) => ({
        destination: s.destination,
        amount: microTariString(s.amount),
        resource_address: s.resourceAddress,
      })),
      revealed_amount: microTariString(revealedOutputAmount),
    });
    const outputMask = Mask.fromBytes(
      fakeScalar("output-mask", revealedOutputAmount, ...specs.map((s) => `${s.destination}:${s.amount}`)),
    );
    return { statement: StealthOutputsStatement.fromJSON(json), outputMask };
  }

  public async buildInputsStatement(inputs: StealthInput[], revealedAmount: bigint): Promise<StealthInputsStatement> {
    const json = JSON.stringify({
      inputs: inputs.map((i) => ({ commitment: toHexStr(i.commitment) })),
      revealed_amount: microTariString(revealedAmount),
    });
    return new StealthInputsStatement(inputs, revealedAmount, json);
  }

  public async generateBalanceProofSignature(
    inputMask: Mask,
    outputMask: Mask,
    inputsStatementJson: string,
    outputsStatementJson: string,
  ): Promise<BalanceProofSignature> {
    const publicNonce = fakeScalar("bp-nonce", inputMask.toHex(), outputMask.toHex(), inputsStatementJson);
    const signature = fakeScalar("bp-sig", inputMask.toHex(), outputMask.toHex(), outputsStatementJson);
    return new BalanceProofSignature(publicNonce, signature);
  }

  public async validateBalanceProofSignature(
    proof: BalanceProofSignature,
    _inputsStatementJson: string,
    _outputsStatementJson: string,
  ): Promise<boolean> {
    // The fake is not cryptographic: there's nothing real to verify. Accept any
    // well-formed 32+32 proof (the structural shape downstream code depends on).
    return proof.publicNonce.length === SCALAR_LENGTH && proof.signature.length === SCALAR_LENGTH;
  }

  public async deriveAeadKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
    return fakeScalar("aead", key(privateKey), key(publicKey));
  }

  public async unblindOutput(
    commitment: Uint8Array,
    encryptedData: Uint8Array,
    aeadKey: Uint8Array,
    skipMemo: boolean,
  ): Promise<DecryptedData> {
    let sealed: FakeSealedOutput;
    try {
      sealed = JSON.parse(new TextDecoder().decode(encryptedData)) as FakeSealedOutput;
    } catch (cause) {
      throw new CryptoBridgeError("FakeStealthCrypto.unblindOutput: encrypted data is not fake-sealed output", {
        cause,
        context: "unblindOutput",
      });
    }
    // Commitment-shape sanity (mirrors the real "commitment mismatch" guard).
    if (commitment.length !== SCALAR_LENGTH) {
      throw new InvalidArgumentError("FakeStealthCrypto.unblindOutput: commitment must be 32 bytes");
    }
    // "AEAD failure" = the key the data was sealed to doesn't match — i.e. not owned.
    if (toHexStr(aeadKey) !== sealed.aeadKeyHex) {
      throw new CryptoBridgeError("FakeStealthCrypto.unblindOutput: AEAD decryption failed (not owned)", {
        context: "unblindOutput",
      });
    }
    return {
      mask: Mask.fromHex(sealed.maskHex),
      value: BigInt(sealed.value),
      memo: skipMemo ? undefined : sealed.memo,
    };
  }

  public async aggregateInputMasks(masks: Mask[]): Promise<Mask> {
    return Mask.fromBytes(fakeScalar("agg-mask", ...masks.map((m) => m.toHex())));
  }

  public async stealthDhSecret(
    networkByte: number,
    ownerSecret: Uint8Array,
    publicNonce: Uint8Array,
  ): Promise<Uint8Array> {
    return fakeScalar("dh", networkByte, key(ownerSecret), key(publicNonce));
  }

  public async validateTransfer(statement: StealthTransferStatement): Promise<void> {
    // Structural-only check: the envelope must be a complete, serialisable statement.
    // (The real engine is authoritative; the fake just refuses obviously-broken input.)
    const json = statement.toCompactJson();
    if (json.length === 0) {
      throw new CryptoBridgeError("FakeStealthCrypto.validateTransfer: empty transfer statement", {
        context: "validateTransfer",
      });
    }
  }
}

/**
 * Helper for tests: produce the `(encryptedData, aeadKey)` pair that
 * {@link FakeStealthCrypto.unblindOutput} will successfully decrypt back to `value`/`mask`.
 *
 * @returns `{ encryptedData, aeadKey }` — feed both into `unblindOutput`. Pass a different
 *   `aeadKey` to simulate a "not owned" output (it will throw).
 */
export function sealFakeOutput(
  value: bigint,
  mask: Mask,
  aeadKey: Uint8Array,
  memo?: string,
): { encryptedData: Uint8Array; aeadKey: Uint8Array } {
  const sealed: FakeSealedOutput = {
    value: microTariString(value),
    maskHex: mask.toHex(),
    aeadKeyHex: toHexStr(aeadKey),
    memo,
  };
  const encryptedData = new TextEncoder().encode(JSON.stringify(sealed));
  return { encryptedData, aeadKey };
}
