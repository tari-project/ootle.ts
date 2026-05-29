//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// The ONLY file in the stealth module that imports `@tari-project/ootle-wasm`.
// Everything else depends on the `StealthCryptoProvider` interface so tests can inject
// a fake. Keep it that way — do not import WASM elsewhere under `stealth/`.

import {
  createStealthOutputWitness,
  generateStealthOutputsStatement,
  buildStealthInputsStatement,
  generateStealthBalanceProofSignature,
  validateBalanceProofSignature as wasmValidateBalanceProofSignature,
  validateStealthTransfer,
  encryptedDataDhKdfAead,
  unblindOutput as wasmUnblindOutput,
  aggregateInputMasks as wasmAggregateInputMasks,
  stealthDhSecret as wasmStealthDhSecret,
  parseOotleAddress,
} from "@tari-project/ootle-wasm";
import type { StealthCryptoProvider } from "./crypto-provider";
import { InvalidArgumentError } from "../errors";
import { Mask, SCALAR_LENGTH, type DecryptedData, type Output } from "./primitives";
import {
  BalanceProofSignature,
  StealthInput,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
} from "./statements";
import { Network } from "../network";

/** Assert a byte array is exactly `SCALAR_LENGTH` (32) bytes, with a clear error. */
function assertScalar(bytes: Uint8Array, what: string): void {
  if (bytes.length !== SCALAR_LENGTH) {
    throw new InvalidArgumentError(`${what} must be ${SCALAR_LENGTH} bytes, got ${bytes.length}`);
  }
}

/**
 * Concatenate `n` 32-byte scalars into one `32·n` buffer (the WASM convention for
 * mask/commitment lists). Validates each entry is exactly 32 bytes.
 */
function concatScalars(scalars: Uint8Array[], what: string): Uint8Array {
  const out = new Uint8Array(scalars.length * SCALAR_LENGTH);
  for (let i = 0; i < scalars.length; i++) {
    const s = scalars[i];
    assertScalar(s, `${what}[${i}]`);
    out.set(s, i * SCALAR_LENGTH);
  }
  return out;
}

/**
 * The real `StealthCryptoProvider`, backed by `@tari-project/ootle-wasm@0.32.0`.
 *
 * Marshals between the step-02 domain types (`Mask`, `Output`, statements) and the raw
 * WASM ABI (snake_case result fields, positional args, raw `Uint8Array`s/`bigint`s).
 * Async signatures wrap synchronous WASM calls — see {@link StealthCryptoProvider}.
 */
export class WasmStealthCrypto implements StealthCryptoProvider {
  /**
   * The network byte fed to the WASM output-witness and DH calls. Defaults to
   * {@link Network.LocalNet}; pass the target network for non-local transfers.
   */
  private readonly network: Network;

  public constructor(network: Network = Network.LocalNet) {
    this.network = network;
  }

  public async generateOutputsStatement(
    specs: Output[],
    revealedOutputAmount: bigint,
  ): Promise<{ statement: StealthOutputsStatement; outputMask: Mask }> {
    // One witness JSON string per output (incl. change). Collect the raw strings and
    // wrap them into a JSON array by **string concatenation** — never JSON.parse +
    // re-stringify: the witness carries u64 amounts that can exceed 2^53 and would be
    // silently corrupted by a round-trip through JS numbers.
    const witnesses = specs.map((spec) => this.outputWitness(spec));
    const witnessesJson = `[${witnesses.join(",")}]`;

    const result = generateStealthOutputsStatement(witnessesJson, revealedOutputAmount);
    assertScalar(result.aggregated_output_mask, "StealthOutputsResult.aggregated_output_mask");

    return {
      statement: StealthOutputsStatement.fromJSON(result.statement_json),
      outputMask: Mask.fromBytes(result.aggregated_output_mask),
    };
  }

  /** Build a single output witness JSON via WASM, mapping an {@link Output} spec. */
  private outputWitness(spec: Output): string {
    // The destination is an Ootle account address; recover its account + view public
    // keys for the witness.
    const parsed = parseOotleAddress(spec.destination);

    // `payTo` defaults (in `createOutput`) to `{ StealthPublicKey: {} }`; the WASM takes
    // `pay_to_json = null` for that default one-time stealth spend key. Only serialise a
    // non-default spend condition.
    const payToJson = isDefaultPayTo(spec.payTo) ? null : JSON.stringify(spec.payTo);
    const memoJson = spec.memo !== undefined ? JSON.stringify(spec.memo) : null;
    // `resourceViewKey` is passed through verbatim; a non-null value makes
    // `generateStealthOutputsStatement` emit the ElGamal viewable-balance proof.
    const resourceViewKey = spec.resourceViewKey ?? null;

    return createStealthOutputWitness(
      this.network,
      parsed.owner_key,
      parsed.view_key,
      spec.amount,
      spec.resourceAddress,
      resourceViewKey,
      memoJson,
      payToJson,
      spec.minimumValuePromise,
    );
  }

  public async buildInputsStatement(inputs: StealthInput[], revealedAmount: bigint): Promise<StealthInputsStatement> {
    // Concat the inputs' 32-byte commitments (empty buffer for a revealed-only spend).
    const commitmentsConcat = concatScalars(
      inputs.map((i) => i.commitment),
      "input commitment",
    );
    const statementJson = buildStealthInputsStatement(commitmentsConcat, revealedAmount);
    return new StealthInputsStatement(inputs, revealedAmount, statementJson);
  }

  public async generateBalanceProofSignature(
    inputMask: Mask,
    outputMask: Mask,
    inputsStatementJson: string,
    outputsStatementJson: string,
  ): Promise<BalanceProofSignature> {
    const result = generateStealthBalanceProofSignature(
      inputMask.toBytes(),
      outputMask.toBytes(),
      inputsStatementJson,
      outputsStatementJson,
    );
    // Validate at the wrapper boundary — silent truncation produces invalid on-chain
    // signatures. The BalanceProofSignature constructor also enforces these.
    assertScalar(result.public_nonce, "balance proof public_nonce");
    assertScalar(result.signature, "balance proof signature");
    return new BalanceProofSignature(result.public_nonce, result.signature);
  }

  public async validateBalanceProofSignature(
    proof: BalanceProofSignature,
    inputsStatementJson: string,
    outputsStatementJson: string,
  ): Promise<boolean> {
    return wasmValidateBalanceProofSignature(
      proof.publicNonce,
      proof.signature,
      inputsStatementJson,
      outputsStatementJson,
    );
  }

  public async deriveAeadKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
    assertScalar(privateKey, "deriveAeadKey privateKey");
    assertScalar(publicKey, "deriveAeadKey publicKey");
    const key = encryptedDataDhKdfAead(privateKey, publicKey);
    assertScalar(key, "derived AEAD key");
    return key;
  }

  public async unblindOutput(
    commitment: Uint8Array,
    encryptedData: Uint8Array,
    aeadKey: Uint8Array,
    skipMemo: boolean,
  ): Promise<DecryptedData> {
    assertScalar(commitment, "unblindOutput commitment");
    assertScalar(aeadKey, "unblindOutput aeadKey");
    // Throws on AEAD failure / commitment mismatch ("not owned") — let it propagate.
    const result = wasmUnblindOutput(commitment, encryptedData, aeadKey, skipMemo);
    return {
      mask: Mask.fromBytes(result.mask),
      value: result.value,
      memo: result.memo_json ?? undefined,
    };
  }

  public async aggregateInputMasks(masks: Mask[]): Promise<Mask> {
    const concat = concatScalars(
      masks.map((m) => m.toBytes()),
      "input mask",
    );
    const aggregated = wasmAggregateInputMasks(concat);
    return Mask.fromBytes(aggregated);
  }

  public async stealthDhSecret(
    networkByte: number,
    ownerSecret: Uint8Array,
    publicNonce: Uint8Array,
  ): Promise<Uint8Array> {
    assertScalar(ownerSecret, "stealthDhSecret ownerSecret");
    assertScalar(publicNonce, "stealthDhSecret publicNonce");
    const secret = wasmStealthDhSecret(networkByte, ownerSecret, publicNonce);
    assertScalar(secret, "stealth DH secret");
    return secret;
  }

  public async validateTransfer(statement: StealthTransferStatement): Promise<void> {
    // Use `toCompactJson()` — the byte-exact signed wire form that embeds the WASM
    // statement fragments verbatim. NEVER `toJSON()` here (structural-only, lossy on
    // u64 amounts). Pass `view_key = null`: the transfer statement does not carry
    // the resource view key; viewable-resource validation is the engine's
    // authoritative job at submission. Throws on invalid — let it propagate.
    validateStealthTransfer(statement.toCompactJson(), null);
  }
}

/** Whether a `payTo` spend condition is the default `{ StealthPublicKey: {} }`. */
function isDefaultPayTo(payTo: object): boolean {
  const keys = Object.keys(payTo);
  if (keys.length !== 1 || keys[0] !== "StealthPublicKey") {
    return false;
  }
  const inner = (payTo as Record<string, unknown>).StealthPublicKey;
  return typeof inner === "object" && inner !== null && Object.keys(inner).length === 0;
}
