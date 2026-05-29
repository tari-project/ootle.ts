//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Tests for the SPEND path of the send-side stealth authorizer.
//
// Uses the deterministic fake crypto, a stubbed `Provider.getStealthUtxo` that
// returns owned UTXO substates (sealed via `sealFakeOutput`), and a WASM-backed test signer
// for the one-time spend-key authorizations (real `schnorrSign`/`publicKeyFromSecretKey`,
// mirroring `SecretKeyWallet.addStealthSignature` — kept local to avoid a reverse dependency
// on the `ootle-secret-key-wallet` package). The shared sign/seal pipeline in
// `../transaction` is mocked (as in `authorizer.revealed.test.ts`) so the authorizer's wiring
// is verified without hashing a tx whose fixture addresses aren't engine-parseable.

import type {
  IndexerGetSubstateResponse,
  OutputBody,
  SubstateRequirement,
  SubstateValue,
  TransactionSignature,
  UnsignedTransactionV1,
  Utxo,
} from "@tari-project/ootle-ts-bindings";
import {
  generateKeypair,
  publicKeyFromSecretKey,
  schnorrSign,
  stealthDhSecret as wasmStealthDhSecret,
} from "@tari-project/ootle-wasm";
import { describe, expect, it, vi } from "vitest";
import { Network } from "../network";
import type { Provider } from "../provider";
import type { Signer } from "../signer";
import { OotleWallet } from "../wallet";
import { SignerError } from "../errors";
import { fromHexStr, toHexStr } from "../helpers/hex";
import { FakeStealthCrypto, sealFakeOutput } from "../test/fake-crypto";
import { createOutput, Mask } from "./primitives";
import { isStealthTransferInstruction, RAW_JSON_FRAGMENT } from "./instruction";
import { StealthTransfer, type StealthTransferSpec } from "./transfer";
import { WalletStealthAuthorizer } from "./authorizer";

// A fixed seal keypair so `generateSealKeypair` is deterministic and `signTransaction`
// receives the same keypair the one-time authorizations were hashed with. The WASM result's
// `public_key`/`secret_key` getters return a fresh copy per access, so snapshot the bytes
// once into stable arrays.
const SEAL_KP = generateKeypair();
const SEAL_PUBLIC_KEY = new Uint8Array(SEAL_KP.public_key);
const SEAL_SECRET_KEY = new Uint8Array(SEAL_KP.secret_key);

const signTransactionMock = vi.fn(async (_signers: Signer[], _tx: UnsignedTransactionV1, _seal?: unknown) => ({
  V1: {},
}));
const sealTransactionMock = vi.fn(() => "SEALED_ENVELOPE");
vi.mock("../transaction", async () => {
  const actual = await vi.importActual<typeof import("../transaction")>("../transaction");
  return {
    serializeUnsignedTx: actual.serializeUnsignedTx,
    resolveTransaction: vi.fn(async (_provider: Provider, tx: UnsignedTransactionV1) => tx),
    signTransaction: (signers: Signer[], tx: UnsignedTransactionV1, seal?: unknown) =>
      signTransactionMock(signers, tx, seal),
    sealTransaction: () => sealTransactionMock(),
    generateSealKeypair: () => ({ secret_key: SEAL_SECRET_KEY, public_key: SEAL_PUBLIC_KEY }),
  };
});

const RESOURCE = "resource_" + "a".repeat(64);
const ACCOUNT = "component_" + "b".repeat(64);
const DESTINATION = "account_dest_address";

const COMMITMENT_A = fromHexStr("11".repeat(32));
const COMMITMENT_B = fromHexStr("22".repeat(32));
const NONCE_A = toHexStr(generateKeypair().public_key);
const NONCE_B = toHexStr(generateKeypair().public_key);
const VIEW_SECRET = fromHexStr("33".repeat(32));

const MASK_A = Mask.fromHex("44".repeat(32));
const MASK_B = Mask.fromHex("55".repeat(32));

/** Build a UTXO substate sealed to the fake AEAD key for (VIEW_SECRET, publicNonce). */
async function ownedUtxo(
  crypto: FakeStealthCrypto,
  publicNonceHex: string,
  value: bigint,
  mask: Mask,
): Promise<IndexerGetSubstateResponse> {
  const aeadKey = await crypto.deriveAeadKey(VIEW_SECRET, fromHexStr(publicNonceHex));
  const { encryptedData } = sealFakeOutput(value, mask, aeadKey);
  const body: OutputBody = {
    public_nonce: publicNonceHex,
    encrypted_data: toHexStr(encryptedData),
    minimum_value_promise: 0,
    viewable_balance: null,
  };
  const utxo: Utxo = {
    output: { output: body, spend_condition: {} as never, tag: 0 as never },
    is_frozen: false,
  };
  const substate: SubstateValue = { Utxo: utxo };
  return { version: 0, substate };
}

/**
 * A WASM-backed account + stealth signer (mirrors `SecretKeyWallet`). `addStealthSignature`
 * derives the one-time spend key via real WASM `stealthDhSecret` (the production
 * `SecretKeyWallet` routes this through `ctx.crypto`; this test double calls WASM directly
 * since it can — the fake crypto's `stealthDhSecret` returns a non-canonical scalar WASM
 * rejects) then signs a deterministic message with real WASM `schnorrSign` — exercising the
 * real one-time-key + Schnorr path without needing an engine-parseable tx for
 * `hashUnsignedTransaction`. `publicNonce` is a real Ristretto point (from `generateKeypair`).
 */
class TestSigner implements Signer {
  public lastSealPublicKey: Uint8Array | null = null;

  private constructor(
    private readonly secretKey: Uint8Array,
    private readonly publicKey: Uint8Array,
    private readonly network: Network,
    private readonly viewSecret?: Uint8Array,
  ) {}

  public static generate(viewSecret?: Uint8Array): TestSigner {
    const kp = generateKeypair();
    return new TestSigner(kp.secret_key, kp.public_key, Network.LocalNet, viewSecret);
  }

  public async getAddress(): Promise<string> {
    return toHexStr(this.publicKey);
  }
  public async getPublicKey(): Promise<Uint8Array> {
    return this.publicKey;
  }
  public async getViewSecret(): Promise<Uint8Array> {
    if (this.viewSecret === undefined) {
      throw new Error("no view secret on this test signer");
    }
    return this.viewSecret;
  }
  public async signTransaction(
    _unsignedTx: UnsignedTransactionV1,
    _sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    return [
      {
        public_key: toHexStr(this.publicKey),
        signature: { public_nonce: "00".repeat(32), signature: "00".repeat(32) },
      },
    ];
  }
  public async addStealthSignature(
    _unsignedJson: string,
    publicNonce: Uint8Array,
    sealPublicKey: Uint8Array,
    _ctx: { crypto: import("./crypto-provider").StealthCryptoProvider },
  ): Promise<TransactionSignature> {
    this.lastSealPublicKey = sealPublicKey;
    const oneTimeSpendKey = wasmStealthDhSecret(this.network, this.secretKey, publicNonce);
    const oneTimeSpendPublicKey = publicKeyFromSecretKey(oneTimeSpendKey);
    // Sign a deterministic 64-byte message that mixes in the seal pubkey (stand-in for the
    // tx hash), exercising real WASM Schnorr signing.
    const message = new Uint8Array(64);
    message.set(sealPublicKey.subarray(0, 32), 0);
    message.set(publicNonce.subarray(0, 32), 32);
    const sig = schnorrSign(oneTimeSpendKey, message);
    return {
      public_key: toHexStr(oneTimeSpendPublicKey),
      signature: { public_nonce: toHexStr(sig.public_nonce), signature: toHexStr(sig.signature) },
    };
  }
}

function stubProvider(overrides: Partial<Provider> = {}): Provider {
  const base: Provider = {
    network: () => Network.LocalNet,
    resolveInputs: vi.fn(async (inputs: SubstateRequirement[]) =>
      inputs.map((i) => ({ ...i, version: i.version ?? 0 })),
    ),
    // Default to a vault-less Component so prepare()'s vault walker doesn't NPE on the
    // revealed-source path.
    getSubstate: vi.fn(async () => ({
      address: "",
      version: 0,
      substate: { Component: { body: { state: {} } } },
      created_by_transaction: "",
    })),
    getStealthUtxo: vi.fn(),
    fetchSubstates: vi.fn(),
    getTemplateDefinition: vi.fn(),
    submitTransaction: vi.fn(),
    getTransactionResult: vi.fn(),
    listRecentTransactions: vi.fn(),
  } as unknown as Provider;
  return { ...base, ...overrides };
}

function walletWith(...signers: { addr: string; signer: TestSigner }[]): OotleWallet {
  const wallet = new OotleWallet();
  for (const { addr, signer } of signers) {
    wallet.registerKeyProvider(addr, signer);
  }
  if (signers.length > 0) {
    wallet.setDefaultSigner(signers[0].addr);
  }
  return wallet;
}

/** Build a two-stealth-input spec (with a revealed source as the fee/default signer). */
async function buildTwoInputSpec(crypto: FakeStealthCrypto, provider: Provider): Promise<StealthTransferSpec> {
  return new StealthTransfer(provider, RESOURCE, crypto)
    .spendRevealedInput(ACCOUNT, 100n)
    .spendStealthInput(ACCOUNT, COMMITMENT_A)
    .spendStealthInput(ACCOUNT, COMMITMENT_B)
    .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
    .prepare();
}

describe("WalletStealthAuthorizer.prepare (stealth inputs)", () => {
  it("fetches both UTXOs, unblinds each, aggregates masks, signs the proof, validates, patches", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const utxoB = await ownedUtxo(crypto, NONCE_B, 400n, MASK_B);
    const getStealthUtxo = vi.fn(async (_res: string, commitment: Uint8Array) =>
      toHexStr(commitment) === toHexStr(COMMITMENT_A) ? utxoA : utxoB,
    );
    const provider = stubProvider({ getStealthUtxo });
    const spec = await buildTwoInputSpec(crypto, provider);
    expect(spec.statement.balanceProof).toBeUndefined();

    const signer = TestSigner.generate(VIEW_SECRET);
    const wallet = walletWith({ addr: ACCOUNT, signer });

    const aggSpy = vi.spyOn(crypto, "aggregateInputMasks");
    const bpSpy = vi.spyOn(crypto, "generateBalanceProofSignature");
    const validateSpy = vi.spyOn(crypto, "validateTransfer");

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    const tx = await authorizer.prepare(provider);

    // Both UTXOs were fetched.
    expect(getStealthUtxo).toHaveBeenCalledTimes(2);

    // The two recovered masks were aggregated (in insertion order A, B).
    expect(aggSpy).toHaveBeenCalledTimes(1);
    const [masks] = aggSpy.mock.calls[0];
    expect(masks.map((m) => m.toHex())).toEqual([MASK_A.toHex(), MASK_B.toHex()]);

    // The balance proof was signed with the AGGREGATED input mask (not Mask.zero()).
    expect(bpSpy).toHaveBeenCalledTimes(1);
    const [inputMask] = bpSpy.mock.calls[0];
    const expectedAgg = await crypto.aggregateInputMasks([MASK_A, MASK_B]);
    expect(inputMask.toHex()).toBe(expectedAgg.toHex());
    expect(inputMask.toHex()).not.toBe("00".repeat(32));

    // validateTransfer ran and the statement was patched with the balance proof.
    expect(validateSpy).toHaveBeenCalledTimes(1);
    const hydrated = tx.getSpec();
    expect(hydrated.statement.balanceProof).toBeDefined();
    const stealth = hydrated.unsignedTx.instructions.find(isStealthTransferInstruction);
    if (stealth === undefined) throw new Error("expected a StealthTransfer instruction");
    // The patched statement is carried as the byte-exact compact JSON fragment.
    const wire = stealth.StealthTransfer.statement as unknown as { [RAW_JSON_FRAGMENT]: string };
    expect(wire[RAW_JSON_FRAGMENT]).toBe(hydrated.statement.toCompactJson());
    expect(wire[RAW_JSON_FRAGMENT]).toContain("balance_proof");
  });

  it("falls back to the wallet's default signer view secret when none is passed explicitly", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const getStealthUtxo = vi.fn(async () => utxoA);
    const provider = stubProvider({ getStealthUtxo });

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, COMMITMENT_A)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 600n, resourceAddress: RESOURCE }))
      .prepare();

    const signer = TestSigner.generate(VIEW_SECRET); // holds the view secret
    const wallet = walletWith({ addr: ACCOUNT, signer });

    // No explicit viewSecret — the authorizer must use signer.getViewSecret().
    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto });
    const tx = await authorizer.prepare(provider);
    expect(tx.getSpec().statement.balanceProof).toBeDefined();
  });

  it("throws a clear error when stealth inputs exist but no view secret is available", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const provider = stubProvider({ getStealthUtxo: vi.fn(async () => utxoA) });

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, COMMITMENT_A)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 600n, resourceAddress: RESOURCE }))
      .prepare();

    const signer = TestSigner.generate(); // NO view secret
    const wallet = walletWith({ addr: ACCOUNT, signer });

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto });
    await expect(authorizer.prepare(provider)).rejects.toThrow(/view secret|SecretKeyWallet|viewSecret/);
  });

  it("surfaces the actionable WalletError (with the signer error as cause) when the default signer's getViewSecret rejects", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const provider = stubProvider({ getStealthUtxo: vi.fn(async () => utxoA) });

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, COMMITMENT_A)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 600n, resourceAddress: RESOURCE }))
      .prepare();

    // A daemon-like default signer that DEFINES getViewSecret but always rejects (so the
    // presence-based feature-detect passes but the call fails).
    const daemonError = new SignerError("WalletDaemonSigner cannot export a view secret");
    const daemonSigner: Signer = {
      getAddress: async () => ACCOUNT,
      getPublicKey: async () => new Uint8Array(32),
      signTransaction: async (_tx: UnsignedTransactionV1, _sealPk: Uint8Array) => [],
      getViewSecret: async () => {
        throw daemonError;
      },
    };
    const wallet = new OotleWallet();
    wallet.registerKeyProvider(ACCOUNT, daemonSigner);
    wallet.setDefaultSigner(ACCOUNT);

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto });
    await expect(authorizer.prepare(provider)).rejects.toMatchObject({
      name: "WalletError",
      message: expect.stringContaining("viewSecret"),
      cause: daemonError,
    });
  });

  it("resolves stealth inputs in spec.inputs order even when later fetches complete first", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const utxoB = await ownedUtxo(crypto, NONCE_B, 400n, MASK_B);
    // Delay the FIRST input's fetch so the second resolves first — Promise.all must still
    // yield results (and thus masks) in spec.inputs order (A before B).
    const getStealthUtxo = vi.fn(async (_res: string, commitment: Uint8Array) => {
      if (toHexStr(commitment) === toHexStr(COMMITMENT_A)) {
        await new Promise((r) => setTimeout(r, 20));
        return utxoA;
      }
      return utxoB;
    });
    const provider = stubProvider({ getStealthUtxo });
    const spec = await buildTwoInputSpec(crypto, provider);

    const wallet = walletWith({ addr: ACCOUNT, signer: TestSigner.generate(VIEW_SECRET) });
    const aggSpy = vi.spyOn(crypto, "aggregateInputMasks");

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    await authorizer.prepare(provider);

    const [masks] = aggSpy.mock.calls[0];
    expect(masks.map((m) => m.toHex())).toEqual([MASK_A.toHex(), MASK_B.toHex()]);
  });

  it("throws when a stealth input UTXO is not found", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider({ getStealthUtxo: vi.fn(async () => null) });

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, COMMITMENT_A)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 600n, resourceAddress: RESOURCE }))
      .prepare();

    const wallet = walletWith({ addr: ACCOUNT, signer: TestSigner.generate(VIEW_SECRET) });
    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    await expect(authorizer.prepare(provider)).rejects.toThrow(/not found/);
  });
});

describe("AuthorizedTransfer.createAuthorizations", () => {
  it("returns one TransactionAuthorization per stealth input via addStealthSignature", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const utxoB = await ownedUtxo(crypto, NONCE_B, 400n, MASK_B);
    const getStealthUtxo = vi.fn(async (_res: string, commitment: Uint8Array) =>
      toHexStr(commitment) === toHexStr(COMMITMENT_A) ? utxoA : utxoB,
    );
    const provider = stubProvider({ getStealthUtxo });
    const spec = await buildTwoInputSpec(crypto, provider);

    const signer = TestSigner.generate(VIEW_SECRET);
    const wallet = walletWith({ addr: ACCOUNT, signer });

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    const tx = await authorizer.prepare(provider);
    const auths = await tx.createAuthorizations();

    expect(auths).toHaveLength(2);
    expect(auths.every((a) => a.signerAddress === ACCOUNT)).toBe(true);
    expect(auths.every((a) => a.signatures.length === 1)).toBe(true);
    // The signer was handed the transfer's shared seal public key and the UTXO nonces.
    expect(toHexStr(signer.lastSealPublicKey ?? new Uint8Array())).toBe(toHexStr(tx.getSealPublicKey()));
    expect(toHexStr(signer.lastSealPublicKey ?? new Uint8Array())).toBe(toHexStr(SEAL_PUBLIC_KEY));
    // The signatures carry one-time spend public keys, not zeros.
    expect(auths[0].signatures[0].public_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("memoizes: repeated calls return the SAME authorizations (no fresh-nonce re-signing)", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const utxoB = await ownedUtxo(crypto, NONCE_B, 400n, MASK_B);
    const getStealthUtxo = vi.fn(async (_res: string, commitment: Uint8Array) =>
      toHexStr(commitment) === toHexStr(COMMITMENT_A) ? utxoA : utxoB,
    );
    const provider = stubProvider({ getStealthUtxo });
    const spec = await buildTwoInputSpec(crypto, provider);

    const signer = TestSigner.generate(VIEW_SECRET);
    const wallet = walletWith({ addr: ACCOUNT, signer });

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    const tx = await authorizer.prepare(provider);

    const first = await tx.createAuthorizations();
    const second = await tx.createAuthorizations();

    // Same array instance (memoized) — never recomputed with a divergent random nonce.
    expect(second).toBe(first);
    // And byte-identical signatures (would differ if re-signed with a fresh nonce).
    expect(second[0].signatures[0].signature.public_nonce).toBe(first[0].signatures[0].signature.public_nonce);
    expect(second[1].signatures[0].signature.public_nonce).toBe(first[1].signatures[0].signature.public_nonce);
  });

  it("returns [] for a revealed-only spec", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
      .prepare();

    const wallet = walletWith({ addr: ACCOUNT, signer: TestSigner.generate(VIEW_SECRET) });
    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto });
    const tx = await authorizer.prepare(provider);
    await expect(tx.createAuthorizations()).resolves.toEqual([]);
  });

  it("throws guidance when the owner's signer cannot produce stealth signatures", async () => {
    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const provider = stubProvider({ getStealthUtxo: vi.fn(async () => utxoA) });
    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, COMMITMENT_A)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 600n, resourceAddress: RESOURCE }))
      .prepare();

    // A signer WITHOUT addStealthSignature (and no view secret needs — pass viewSecret).
    const plainSigner: Signer = {
      getAddress: async () => ACCOUNT,
      getPublicKey: async () => new Uint8Array(32),
      signTransaction: async (_tx: UnsignedTransactionV1, _sealPk: Uint8Array) => [],
    };
    const wallet = new OotleWallet();
    wallet.registerKeyProvider(ACCOUNT, plainSigner);
    wallet.setDefaultSigner(ACCOUNT);

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    const tx = await authorizer.prepare(provider);
    await expect(tx.createAuthorizations()).rejects.toThrow(/SecretKeyWallet|addStealthSignature|one-time/);
  });
});

describe("AuthorizedTransfer end-to-end (no network)", () => {
  it("prepare → createAuthorizations → addSignature → seal yields a sealed envelope, sharing one seal keypair", async () => {
    signTransactionMock.mockClear();
    sealTransactionMock.mockClear();

    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const utxoB = await ownedUtxo(crypto, NONCE_B, 400n, MASK_B);
    const getStealthUtxo = vi.fn(async (_res: string, commitment: Uint8Array) =>
      toHexStr(commitment) === toHexStr(COMMITMENT_A) ? utxoA : utxoB,
    );
    const provider = stubProvider({ getStealthUtxo });
    const spec = await buildTwoInputSpec(crypto, provider);

    const signer = TestSigner.generate(VIEW_SECRET);
    const wallet = walletWith({ addr: ACCOUNT, signer });

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    const tx = await authorizer.prepare(provider);
    const auths = await tx.createAuthorizations();
    expect(auths).toHaveLength(2);

    const envelope = await tx.seal();
    expect(envelope).toBe("SEALED_ENVELOPE");
    expect(signTransactionMock).toHaveBeenCalledTimes(1);
    expect(sealTransactionMock).toHaveBeenCalledTimes(1);

    // signTransaction was called with the SHARED seal keypair (so the seal-signature hash
    // matches the one-time authorizations' hash).
    const [signers, , seal] = signTransactionMock.mock.calls[0];
    expect(toHexStr((seal as { public_key: Uint8Array }).public_key)).toBe(toHexStr(SEAL_PUBLIC_KEY));
    // The account-key signer (the wallet) is present, plus a static signer carrying the
    // one-time authorizations.
    expect(signers).toContain(wallet);
    expect(signers.length).toBe(2);
    const staticSigner = signers.find((s) => s !== wallet);
    if (staticSigner === undefined) throw new Error("expected a static signer carrying the one-time authorizations");
    const staticSigs = await staticSigner.signTransaction(spec.unsignedTx, SEAL_PUBLIC_KEY);
    // EXACTLY one one-time signature per stealth input (2 inputs → 2), even though
    // createAuthorizations() was explicitly called before seal() — proving the memoized
    // cache prevents the seal from double-counting them (FINDING #3). No extra addSignature
    // here, so the count is purely the two one-time auths.
    expect(staticSigs).toHaveLength(2);
    // The sealed one-time signatures are byte-identical to the ones createAuthorizations()
    // returned to the caller — not re-signed with a fresh random nonce.
    const sealedNonces = staticSigs.map((s) => s.signature.public_nonce).sort();
    const authNonces = auths
      .flatMap((a) => a.signatures)
      .map((s) => s.signature.public_nonce)
      .sort();
    expect(sealedNonces).toEqual(authNonces);
  });

  it("seal() includes exactly one one-time signature per input WITHOUT a prior createAuthorizations() call", async () => {
    signTransactionMock.mockClear();
    sealTransactionMock.mockClear();

    const crypto = new FakeStealthCrypto();
    const utxoA = await ownedUtxo(crypto, NONCE_A, 600n, MASK_A);
    const utxoB = await ownedUtxo(crypto, NONCE_B, 400n, MASK_B);
    const getStealthUtxo = vi.fn(async (_res: string, commitment: Uint8Array) =>
      toHexStr(commitment) === toHexStr(COMMITMENT_A) ? utxoA : utxoB,
    );
    const provider = stubProvider({ getStealthUtxo });
    const spec = await buildTwoInputSpec(crypto, provider);

    const signer = TestSigner.generate(VIEW_SECRET);
    const wallet = walletWith({ addr: ACCOUNT, signer });

    const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { crypto, viewSecret: VIEW_SECRET });
    const tx = await authorizer.prepare(provider);

    // seal() WITHOUT a prior createAuthorizations() call — the seal must still pick up the
    // one-time authorizations exactly once each.
    await tx.seal();

    const [signers] = signTransactionMock.mock.calls[0];
    const staticSigner = signers.find((s) => s !== wallet);
    if (staticSigner === undefined) throw new Error("expected a static signer carrying the one-time authorizations");
    const staticSigs = await staticSigner.signTransaction(spec.unsignedTx, SEAL_PUBLIC_KEY);
    expect(staticSigs).toHaveLength(2);
  });
});
