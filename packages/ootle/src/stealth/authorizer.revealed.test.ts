//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Tests for the revealed-only half of the send-side stealth authorizer.
//
// All WASM-free, using the deterministic fake crypto + a stubbed Provider.
// `prepare(provider)` fills the balance proof with a `Mask.zero()` input mask, validates
// the transfer, and patches the statement into the tx. `seal()` reuses
// `signTransaction`/`sealTransaction` from `../transaction`; those are mocked here so the
// authorizer's wiring (signer selection, account-signature skip) is verified without
// hashing a transaction whose fixture addresses aren't engine-parseable. (A real
// end-to-end seal of a stealth tx requires engine-parseable resource/account addresses,
// i.e. a LocalNet run.)

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { generateKeypair, hashUnsignedTransaction, schnorrSign } from "@tari-project/ootle-wasm";
import { describe, expect, it, vi } from "vitest";
import { Network } from "../network";
import type { Provider } from "../provider";
import type { Signer } from "../signer";
import { OotleWallet } from "../wallet";
import { toHexStr } from "../helpers/hex";
import { fakeProvider } from "../test/fake-provider";
import { FakeStealthCrypto } from "../test/fake-crypto";
import { createOutput } from "./primitives";
import { isStealthTransferInstruction, RAW_JSON_FRAGMENT } from "./instruction";
import { StealthTransfer, type StealthTransferSpec } from "./transfer";
import { WalletStealthAuthorizer, patchStealthStatement } from "./authorizer";

// Mock the shared sign/seal pipeline the authorizer REUSES. `resolveTransaction` echoes the
// tx; `signTransaction` records its signers and returns a stub; `sealTransaction` returns a
// fixed envelope. This proves the authorizer routes through the same functions as the
// existing flow without needing engine-parseable addresses.
const signTransactionMock = vi.fn(async (_signers: Signer[], _tx: UnsignedTransactionV1, _seal?: unknown) => ({
  V1: {},
}));
const sealTransactionMock = vi.fn(() => "SEALED_ENVELOPE");
vi.mock("../transaction", () => ({
  resolveTransaction: vi.fn(async (_provider: Provider, tx: UnsignedTransactionV1) => tx),
  signTransaction: (signers: Signer[], tx: UnsignedTransactionV1, seal?: unknown) =>
    signTransactionMock(signers, tx, seal),
  sealTransaction: () => sealTransactionMock(),
  // The authorizer generates its shared seal keypair in a field initializer; the spend path
  // needs a valid one, but the revealed-only tests never inspect it, so a fixed stub is fine.
  generateSealKeypair: () => ({ secret_key: new Uint8Array(32), public_key: new Uint8Array(32) }),
}));

const RESOURCE = "resource_" + "a".repeat(64);
const DESTINATION = "account_dest_address";

/** A real WASM-backed account `Signer` (mirrors `EphemeralKeySigner`). */
class FakeAccountSigner implements Signer {
  private constructor(
    private readonly secretKey: Uint8Array,
    private readonly publicKey: Uint8Array,
  ) {}

  public static generate(): FakeAccountSigner {
    const kp = generateKeypair();
    return new FakeAccountSigner(kp.secret_key, kp.public_key);
  }

  public async getAddress(): Promise<string> {
    return toHexStr(this.publicKey);
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return this.publicKey;
  }

  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    const hash = hashUnsignedTransaction(JSON.stringify(unsignedTx), sealPublicKey);
    const sig = schnorrSign(this.secretKey, hash);
    return [
      {
        public_key: toHexStr(this.publicKey),
        signature: { public_nonce: toHexStr(sig.public_nonce), signature: toHexStr(sig.signature) },
      },
    ];
  }
}

async function buildSpec(crypto: FakeStealthCrypto, provider: Provider): Promise<StealthTransferSpec> {
  return new StealthTransfer(provider, RESOURCE, crypto)
    .spendRevealedInput("component_" + "b".repeat(64), 1000n)
    .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
    .payFeeFromRevealed(50n)
    .prepare();
}

function walletWith(signer: FakeAccountSigner, address: string): OotleWallet {
  const wallet = new OotleWallet();
  wallet.registerKeyProvider(address, signer);
  wallet.setDefaultSigner(address);
  return wallet;
}

describe("WalletStealthAuthorizer.prepare (revealed-only)", () => {
  it("fills the balance proof (Mask.zero input), validates, and patches the statement in place", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    // The incomplete statement has no balance proof yet.
    expect(spec.statement.balanceProof).toBeUndefined();

    const signer = FakeAccountSigner.generate();
    const address = await signer.getAddress();
    const wallet = walletWith(signer, address);

    const validateSpy = vi.spyOn(crypto, "validateTransfer");
    const bpSpy = vi.spyOn(crypto, "generateBalanceProofSignature");

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto });
    const tx = await authorizer.prepare(provider);
    const hydrated = tx.getSpec();

    // The balance proof is filled.
    expect(hydrated.statement.balanceProof).toBeDefined();
    expect(hydrated.statement.balanceProof?.publicNonce).toHaveLength(32);

    // Balance proof was signed with a zero input mask (no stealth inputs).
    expect(bpSpy).toHaveBeenCalledTimes(1);
    const [inputMask] = bpSpy.mock.calls[0];
    expect(inputMask.toHex()).toBe("00".repeat(32));

    // validateTransfer was called and did not throw.
    expect(validateSpy).toHaveBeenCalledTimes(1);

    // The stealth instruction's statement was replaced in place with the hydrated
    // statement, carried as the byte-exact compact JSON fragment — now containing the
    // balance proof.
    const stealth = hydrated.unsignedTx.instructions.find(isStealthTransferInstruction);
    if (stealth === undefined) throw new Error("expected a StealthTransfer instruction");
    const wire = stealth.StealthTransfer.statement as unknown as { [RAW_JSON_FRAGMENT]: string };
    expect(wire[RAW_JSON_FRAGMENT]).toBe(hydrated.statement.toCompactJson());
    expect(wire[RAW_JSON_FRAGMENT]).toContain("balance_proof");
  });
});

describe("patchStealthStatement", () => {
  it("replaces the single stealth instruction's statement and leaves others untouched", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    const before = spec.unsignedTx.instructions.length;
    // Re-use the (incomplete) statement to confirm a fresh object is produced in place.
    const patched = patchStealthStatement(spec.unsignedTx, spec.statement);

    expect(patched.instructions.length).toBe(before);
    // Original is not mutated (new array + new instruction object).
    expect(patched).not.toBe(spec.unsignedTx);
    const stealth = patched.instructions.find(isStealthTransferInstruction);
    if (stealth === undefined) throw new Error("expected a StealthTransfer instruction");
    const wire = stealth.StealthTransfer.statement as unknown as { [RAW_JSON_FRAGMENT]: string };
    expect(wire[RAW_JSON_FRAGMENT]).toBe(spec.statement.toCompactJson());
  });

  it("throws with a `not a stealth tx` message when there is no stealth instruction", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    const tx: UnsignedTransactionV1 = {
      network: Network.LocalNet,
      fee_instructions: [],
      instructions: ["DropAllProofsInWorkspace"],
      inputs: [],
      min_epoch: null,
      max_epoch: null,
      dry_run: false,
      is_seal_signer_authorized: false,
    };
    // A real (incomplete) statement; the throw happens during instruction lookup.
    expect(() => patchStealthStatement(tx, spec.statement)).toThrow(/not a stealth tx/);
  });

  it("throws with a `malformed` message when there is more than one stealth instruction", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    const stealth = spec.unsignedTx.instructions.find(isStealthTransferInstruction);
    if (stealth === undefined) throw new Error("expected a StealthTransfer instruction in spec");
    const tx: UnsignedTransactionV1 = {
      ...spec.unsignedTx,
      instructions: [...spec.unsignedTx.instructions, stealth],
    };
    expect(() => patchStealthStatement(tx, spec.statement)).toThrow(/malformed/);
  });
});

describe("AuthorizedTransfer.seal (reuses signTransaction/sealTransaction)", () => {
  it("returns a sealed TransactionEnvelope and signs with the account key by default", async () => {
    signTransactionMock.mockClear();
    sealTransactionMock.mockClear();

    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    const signer = FakeAccountSigner.generate();
    const address = await signer.getAddress();
    const wallet = walletWith(signer, address);

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto });
    const tx = await authorizer.prepare(provider);
    const envelope = await tx.seal();

    expect(envelope).toBe("SEALED_ENVELOPE");
    // The shared sign + seal functions were reused.
    expect(signTransactionMock).toHaveBeenCalledTimes(1);
    expect(sealTransactionMock).toHaveBeenCalledTimes(1);
    // The account-key signer (the wallet) was passed to signTransaction.
    const [signers] = signTransactionMock.mock.calls[0];
    expect(signers).toContain(wallet);
  });

  it("omits the account signature when mustSignWithAccountKey is false", async () => {
    signTransactionMock.mockClear();

    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    const signer = FakeAccountSigner.generate();
    const address = await signer.getAddress();
    const wallet = walletWith(signer, address);

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, {
      crypto,
      mustSignWithAccountKey: false,
    });
    const tx = await authorizer.prepare(provider);
    await tx.seal();

    // No account-key signer was passed (no extra signatures queued, so no signers at all).
    const [signers] = signTransactionMock.mock.calls[0];
    expect(signers).not.toContain(wallet);
    expect(signers).toHaveLength(0);
  });

  it("includes a queued extra signature via addSignature", async () => {
    signTransactionMock.mockClear();

    const crypto = new FakeStealthCrypto();
    const provider = fakeProvider();
    const spec = await buildSpec(crypto, provider);

    const signer = FakeAccountSigner.generate();
    const address = await signer.getAddress();
    const wallet = walletWith(signer, address);

    const extra: TransactionSignature = {
      public_key: "aa".repeat(32),
      signature: { public_nonce: "bb".repeat(32), signature: "cc".repeat(32) },
    };

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, {
      crypto,
      mustSignWithAccountKey: false,
    });
    const tx = await authorizer.prepare(provider);
    tx.addSignature(extra);
    await tx.seal();

    const [signers] = signTransactionMock.mock.calls[0];
    // One static signer (the extra signature) and no account key.
    expect(signers).toHaveLength(1);
    const sigs = await signers[0].signTransaction(spec.unsignedTx, new Uint8Array(32));
    expect(sigs).toEqual([extra]);
  });

  it("seal() is unreachable on the builder — only AuthorizedTransfer.seal exists (compile-time check)", () => {
    // The state-machine guard is now enforced by the type system: `WalletStealthAuthorizer`
    // exposes only `fromSpec` and `prepare`. Trying to call `.seal()` on the builder is a
    // compile error; `await prepare(provider)` is the only way to obtain a sealable handle.
    // @ts-expect-error — seal() lives on AuthorizedTransfer, not on WalletStealthAuthorizer
    void ((auth: WalletStealthAuthorizer) => auth.seal());
  });
});
