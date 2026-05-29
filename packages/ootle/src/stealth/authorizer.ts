//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Send-side stealth authorizer — full spend path.
//
// {@link WalletStealthAuthorizer} is a lightweight builder around a
// `StealthTransferSpec`. Its sole produce-state method, {@link
// WalletStealthAuthorizer.prepare}, runs the full hydration pipeline and returns an {@link
// AuthorizedTransfer} that owns the post-`prepare` state (resolved inputs, hydrated spec,
// shared seal keypair, queued extra signatures, memoized one-time authorizations). Once
// `prepare()` has returned, the type system prevents calling `seal()` /
// `createAuthorizations()` on an un-prepared authorizer.
//
// Pipeline:
//   1. for each stealth input: fetch its UTXO, unblind it with the owner's view secret to
//      recover the input mask, and remember the UTXO's sender public nonce;
//   2. aggregate the input masks (`Mask.zero()` when revealed-only);
//   3. sign the real balance proof over the inputs/outputs statements with the aggregated
//      input mask + the spec's output mask;
//   4. pre-flight `validateTransfer`, then patch the hydrated statement into the unsigned
//      tx's stealth instruction;
//   5. produce one-time spend-key authorizations — Schnorr signatures by each input's
//      derived one-time spend key over the tx hash, routed through the signer's
//      `addStealthSignature` so the secret never leaves the signer;
//   6. seal the account-key signature(s) + the one-time authorizations into the envelope.
//
// A SINGLE seal keypair is generated once per `prepare()` and threaded through both the
// one-time authorizations (which hash the tx with the seal public key) and the final seal,
// so every signature is over the same hash.

import type { TransactionEnvelope, UnsignedTransactionV1, TransactionSignature } from "@tari-project/ootle-ts-bindings";
import type { Provider } from "../provider";
import { generateSealKeypair, sealTransaction, serializeUnsignedTx, signTransaction } from "../transaction";
import type { SealKeypair } from "../transaction";
import type { Signer } from "../signer";
import type { OotleWallet, TransactionAuthorization } from "../wallet";
import { fromHexStr, toHexStr } from "../helpers/hex";
import { CryptoBridgeError, InvalidArgumentError, KeyProviderNotFoundError, SignerError, WalletError } from "../errors";
import { signBalanceProof } from "./balance-proof";
import type { StealthCryptoProvider } from "./crypto-provider";
import { WasmStealthCrypto } from "./wasm-crypto";
import { Mask } from "./primitives";
import type { StealthInput } from "./statements";
import { StealthTransferStatement } from "./statements";
import { parseSubstateUtxo, stealthUtxoSubstateId } from "./substate-parse";
import { decryptInputData } from "./wallet-helpers";
import type { StealthTransferSpec } from "./transfer";
import { isStealthTransferInstruction, statementAsWire, type StealthTransferInstruction } from "./instruction";

/**
 * A stealth input resolved during {@link WalletStealthAuthorizer.prepare}: the input being
 * spent, its owner address (the one-time signer), the recovered blinding mask, and the
 * sender public nonce read from the fetched UTXO body (the DH counterparty for one-time
 * signing). Insertion-ordered, matching `spec.inputs`.
 */
interface ResolvedStealthInput {
  ownerAddr: string;
  input: StealthInput;
  mask: Mask;
  /** The fetched UTXO's sender public nonce (`OutputBody.public_nonce`), raw bytes. */
  publicNonce: Uint8Array;
}

/** Options for {@link WalletStealthAuthorizer.fromSpec}. */
export interface WalletStealthAuthorizerOptions {
  /**
   * The owner/recipient 32-byte view secret, needed to unblind stealth inputs. **Optional**:
   * the revealed-only path never uses it; for stealth-input transfers it is taken here first,
   * else falls back to the wallet's default signer `getViewSecret?.()` (only `SecretKeyWallet`
   * supplies one). If neither is available and there are stealth inputs, `prepare` throws.
   */
  viewSecret?: Uint8Array;
  /**
   * Whether to append the account-key Schnorr signature when sealing. Defaults to `true`.
   * Set `false` to omit it (e.g. the account already authorized out-of-band).
   */
  mustSignWithAccountKey?: boolean;
  /**
   * Injectable crypto seam; defaults to {@link WasmStealthCrypto}. Tests pass a
   * {@link FakeStealthCrypto}.
   */
  crypto?: StealthCryptoProvider;
}

/**
 * Authorizes a {@link StealthTransferSpec} produced by {@link StealthTransfer}: unblinds any
 * stealth inputs, signs the balance proof, hydrates + patches the statement, then returns an
 * {@link AuthorizedTransfer} that produces one-time spend-key authorizations and seals the
 * envelope. Handles both the revealed-only path and the full stealth-input spend path.
 */
export class WalletStealthAuthorizer {
  private constructor(
    private readonly wallet: OotleWallet,
    private readonly spec: StealthTransferSpec,
    private readonly crypto: StealthCryptoProvider,
    private readonly mustSignWithAccountKey: boolean,
    private readonly viewSecret?: Uint8Array,
  ) {}

  /**
   * Build an authorizer from a builder spec.
   *
   * @param wallet - The multi-signer wallet (supplies the account-key + one-time signatures).
   * @param spec - The spec from {@link StealthTransfer.prepare}.
   * @param options - Optional `viewSecret`, account-signature toggle, crypto seam.
   */
  public static fromSpec(
    wallet: OotleWallet,
    spec: StealthTransferSpec,
    options: WalletStealthAuthorizerOptions = {},
  ): WalletStealthAuthorizer {
    const crypto = options.crypto ?? new WasmStealthCrypto();
    const mustSign = options.mustSignWithAccountKey ?? true;
    return new WalletStealthAuthorizer(wallet, spec, crypto, mustSign, options.viewSecret);
  }

  /**
   * Hydrate + sign the transfer:
   * 1. resolve each stealth input — fetch its UTXO, unblind it to recover the mask, and
   *    remember the sender public nonce (revealed-only → no inputs, no fetch);
   * 2. aggregate the input masks (`Mask.zero()` when there are no stealth inputs);
   * 3. sign the balance proof over the (already-canonical) inputs/outputs statement JSONs;
   * 4. build the complete (hydrated) statement and pre-flight `validateTransfer`;
   * 5. patch the unsigned tx's sole stealth instruction with the hydrated statement.
   *
   * Returns an {@link AuthorizedTransfer} that owns the hydrated state and can produce
   * one-time spend-key authorizations or seal the envelope. The authorizer is not mutated.
   *
   * @param provider - Read-only chain access (fetches the input UTXOs).
   */
  public async prepare(provider: Provider): Promise<AuthorizedTransfer> {
    // 1. Resolve stealth inputs (fetch + unblind), preserving insertion order. Empty for
    //    the revealed-only path.
    const resolvedInputs = await this.resolveStealthInputs(provider);

    // 2. Aggregate the recovered input masks (`Mask.zero()` when there are none — the
    //    crypto interface requires a non-empty list, so the empty case short-circuits here).
    const inputMask =
      resolvedInputs.length === 0
        ? Mask.zero()
        : await this.crypto.aggregateInputMasks(resolvedInputs.map((r) => r.mask));

    // 3. Balance proof over the inputs/outputs statements. The output mask is non-zero
    //    (there is ≥1 stealth output), so this is a real proof, not the omitted all-zeros
    //    case (which is only for a fully-revealed transfer this builder never produces).
    const balanceProof = await signBalanceProof(
      this.crypto,
      inputMask,
      this.spec.outputMask,
      this.spec.statement.inputsStatement,
      this.spec.statement.outputsStatement,
    );

    // 4. Hydrate: a complete statement with the balance proof filled in. Pre-flight validate
    //    (the engine is authoritative at submission; this catches obvious errors early).
    const hydrated = new StealthTransferStatement(
      this.spec.statement.inputsStatement,
      this.spec.statement.outputsStatement,
      balanceProof,
    );
    await this.crypto.validateTransfer(hydrated);

    // 5. Patch the hydrated statement into the unsigned tx's stealth instruction.
    const unsignedTx = patchStealthStatement(this.spec.unsignedTx, hydrated);
    const hydratedSpec: StealthTransferSpec = { ...this.spec, unsignedTx, statement: hydrated };

    return new AuthorizedTransfer({
      wallet: this.wallet,
      crypto: this.crypto,
      spec: hydratedSpec,
      resolvedInputs,
      mustSignWithAccountKey: this.mustSignWithAccountKey,
      sealKeypair: generateSealKeypair(),
    });
  }

  /**
   * Resolve the view secret used to unblind stealth inputs: prefer the explicit one passed
   * to {@link fromSpec}; else fall back to the wallet's default signer `getViewSecret?.()`.
   *
   * @throws {WalletError} a clear, actionable error when neither is available **and**
   *   there are stealth inputs to unblind (the revealed-only path never needs it).
   */
  private async resolveViewSecret(): Promise<Uint8Array> {
    if (this.viewSecret !== undefined) {
      return this.viewSecret;
    }
    const signer = this.wallet.getKeyProvider(await this.safeDefaultAddress());
    if (signer?.getViewSecret !== undefined) {
      // Presence of `getViewSecret` does not mean it can deliver one — `WalletDaemonSigner`
      // defines the method but always rejects (daemon stealth is server-side). On rejection,
      // surface the actionable `{ viewSecret }` guidance, preserving the signer's reason as `cause`.
      try {
        return await signer.getViewSecret();
      } catch (cause) {
        throw new WalletError(
          "WalletStealthAuthorizer: spending stealth inputs needs a view secret to unblind them, but the " +
            "wallet's default signer could not provide one. Pass `fromSpec(wallet, spec, { viewSecret })` or use a " +
            "SecretKeyWallet (created with a view key) as the default signer.",
          { cause },
        );
      }
    }
    throw new WalletError(
      "WalletStealthAuthorizer: spending stealth inputs needs a view secret to unblind them, but none was " +
        "supplied and the wallet's default signer cannot provide one. Pass `fromSpec(wallet, spec, { viewSecret })` " +
        "or use a SecretKeyWallet (created with a view key) as the default signer.",
    );
  }

  /** The wallet's default signer address, or `""` if none is set (so view-secret resolution fails clearly). */
  private async safeDefaultAddress(): Promise<string> {
    try {
      return await this.wallet.getAddress();
    } catch {
      return "";
    }
  }

  /**
   * Fetch + unblind each stealth input, in `spec.inputs` order.
   *
   * For each input: `getStealthUtxo` → `parseSubstateUtxo` (commitment + body) →
   * `decryptInputData(..., { senderPublicNonce, viewSecret, skipMemo: true })` to recover
   * the mask. The sender public nonce is read from the **fetched UTXO body**, not the spec
   * (the spec only carries the commitment), and kept for one-time signing.
   *
   * `skipMemo: true` — spending only needs the mask + value, not the memo (vs the
   * receive-side `decryptOwnedUtxo`, which decrypts the memo).
   */
  private async resolveStealthInputs(provider: Provider): Promise<ResolvedStealthInput[]> {
    if (this.spec.inputs.length === 0) {
      return [];
    }
    const viewSecret = await this.resolveViewSecret();
    const resource = this.spec.state.resource;

    // Iterations are independent (each reads only its own `spec.inputs` element plus the
    // loop-invariant `viewSecret`/`resource`/`this.crypto`); `Promise.all(map(...))` resolves
    // in source-array order, preserving the `spec.inputs` ordering contract.
    return Promise.all(
      this.spec.inputs.map(async ({ input, owner }): Promise<ResolvedStealthInput> => {
        const key = toHexStr(input.commitment);
        const substate = await provider.getStealthUtxo(resource, input.commitment);
        if (substate === null) {
          throw new WalletError(
            `WalletStealthAuthorizer.prepare: stealth input UTXO not found (spent or never created) for ${key}`,
          );
        }
        // The substate id `parseSubstateUtxo` reads the commitment from must match the UTXO we
        // fetched — recompose it from the resource + commitment (the provider used the same id).
        const parsed = parseSubstateUtxo(substate, stealthUtxoSubstateId(resource, input.commitment));
        if (parsed === null) {
          throw new WalletError(`WalletStealthAuthorizer.prepare: stealth input ${key} is not a live, spendable UTXO`);
        }

        const publicNonce = fromHexStr(parsed.body.public_nonce);
        let decrypted;
        try {
          decrypted = await decryptInputData(this.crypto, parsed.commitment, fromHexStr(parsed.body.encrypted_data), {
            senderPublicNonce: publicNonce,
            viewSecret,
            skipMemo: true,
          });
        } catch (cause) {
          // `decryptInputData` → `unblindOutput` throws a raw "AEAD decryption failed" when the
          // resolved view secret does not own this input (e.g. a multi-owner spend where only the
          // default signer's view secret was resolved). Surface an actionable message naming the
          // failing input, preserving the original error as `cause`.
          throw new CryptoBridgeError(
            `WalletStealthAuthorizer.prepare: failed to decrypt stealth input with commitment ` +
              `${toHexStr(input.commitment)} (owner ${owner}). This usually means the supplied view secret ` +
              `does not own this UTXO. Pass the correct \`viewSecret\` via \`fromSpec(wallet, spec, { viewSecret })\`, ` +
              `or use the owning SecretKeyWallet (with its view key) as the default signer. Note: a single view ` +
              `secret is resolved for all inputs — spending UTXOs owned by distinct view keys in one transfer is ` +
              `not supported.`,
            { cause, context: "unblindOutput" },
          );
        }

        return { ownerAddr: owner, input, mask: decrypted.mask, publicNonce };
      }),
    );
  }
}

/**
 * Parameters for the {@link AuthorizedTransfer} constructor. Kept internal — the only
 * construction path is via {@link WalletStealthAuthorizer.prepare}.
 */
interface AuthorizedTransferParams {
  wallet: OotleWallet;
  crypto: StealthCryptoProvider;
  spec: StealthTransferSpec;
  resolvedInputs: ResolvedStealthInput[];
  mustSignWithAccountKey: boolean;
  sealKeypair: SealKeypair;
}

/**
 * The post-{@link WalletStealthAuthorizer.prepare} handle.
 *
 * Owns the hydrated spec, the resolved stealth inputs, and the single seal keypair shared
 * across one-time authorizations and the seal signature. Constructed only via
 * {@link WalletStealthAuthorizer.prepare} — there is no way to obtain one without preparing
 * first, so {@link seal} / {@link createAuthorizations} no longer need a `prepared` guard.
 */
export class AuthorizedTransfer {
  private readonly wallet: OotleWallet;
  private readonly crypto: StealthCryptoProvider;
  private readonly spec: StealthTransferSpec;
  private readonly resolvedInputs: ResolvedStealthInput[];
  private readonly mustSignWithAccountKey: boolean;
  /**
   * The single seal keypair, generated once and shared across the one-time spend-key
   * authorizations (which hash the tx with its public key) and the final {@link seal}. Every
   * signature must be over the same tx hash, which depends on this exact seal public key.
   */
  private readonly sealKeypair: SealKeypair;
  /** Extra signatures appended via {@link addSignature} before sealing. */
  private readonly extraSignatures: TransactionSignature[] = [];
  /**
   * Memoized one-time spend-key authorizations — see {@link createAuthorizations} for the
   * lifecycle and why memoization (not recomputation) is required.
   */
  private cachedAuthorizations?: TransactionAuthorization[];

  public constructor(params: AuthorizedTransferParams) {
    this.wallet = params.wallet;
    this.crypto = params.crypto;
    this.spec = params.spec;
    this.resolvedInputs = params.resolvedInputs;
    this.mustSignWithAccountKey = params.mustSignWithAccountKey;
    this.sealKeypair = params.sealKeypair;
  }

  /** The shared seal signer public key (fixed for this transfer's lifetime). */
  public getSealPublicKey(): Uint8Array {
    return this.sealKeypair.public_key;
  }

  /** The hydrated, post-`prepare` spec (balance proof filled, instruction patched). */
  public getSpec(): StealthTransferSpec {
    return this.spec;
  }

  /**
   * Produce the one-time spend-key authorizations for the stealth inputs (empty for a
   * revealed-only transfer).
   *
   * For each resolved input, picks the owner's signer from the wallet and calls its
   * `addStealthSignature(unsignedJson, publicNonce, sealPublicKey, { crypto })` — which
   * derives the one-time spend scalar via `stealthDhSecret` and signs the tx hash. The
   * secret stays in the signer (never pulled into the transfer).
   *
   * Uses this transfer's shared seal public key ({@link getSealPublicKey}) — the same one
   * {@link seal} uses — so every signature is over the same tx hash. The tx hashed is
   * `spec.unsignedTx` (already resolved by the builder); {@link seal} does not re-resolve,
   * so the hashes match.
   *
   * **Memoized.** The authorizations are computed on the first call and cached; every
   * subsequent call — including the internal one from {@link seal} — returns the *same*
   * array, never re-signing with a fresh random nonce. Calling this before {@link seal}
   * cannot double-count, because {@link seal} reuses the cache. Callers therefore must
   * **not** feed these one-time authorizations to {@link addSignature} — they are
   * auto-included exactly once at seal time.
   *
   * @throws {KeyProviderNotFoundError} if a stealth-input owner has no signer registered.
   * @throws {SignerError} if a stealth-input owner's signer cannot produce one-time
   *   stealth signatures (lacks `addStealthSignature`).
   */
  public async createAuthorizations(): Promise<TransactionAuthorization[]> {
    if (this.cachedAuthorizations === undefined) {
      this.cachedAuthorizations = await this.computeAuthorizations();
    }
    return this.cachedAuthorizations;
  }

  /**
   * Sign each resolved stealth input with its owner's one-time spend key (fresh random
   * nonce per signature). Called **once** via {@link createAuthorizations}'s memoization —
   * never directly — so the random-nonce signatures are produced a single time.
   */
  private async computeAuthorizations(): Promise<TransactionAuthorization[]> {
    if (this.resolvedInputs.length === 0) {
      return [];
    }
    const unsignedJson = serializeUnsignedTx(this.spec.unsignedTx);
    const sealPublicKey = this.sealKeypair.public_key;

    const authorizations: TransactionAuthorization[] = [];
    for (const resolved of this.resolvedInputs) {
      const signer = this.wallet.getKeyProvider(resolved.ownerAddr);
      if (signer === undefined) {
        throw new KeyProviderNotFoundError(
          `AuthorizedTransfer.createAuthorizations: no signer registered for stealth-input owner ` +
            `${resolved.ownerAddr}. Register it via wallet.registerKeyProvider(owner, signer).`,
          { address: resolved.ownerAddr },
        );
      }
      if (signer.addStealthSignature === undefined) {
        throw new SignerError(
          `AuthorizedTransfer.createAuthorizations: signer for ${resolved.ownerAddr} cannot produce ` +
            `one-time stealth signatures. Use a SecretKeyWallet (which holds the owner secret).`,
        );
      }
      const signature = await signer.addStealthSignature(unsignedJson, resolved.publicNonce, sealPublicKey, {
        crypto: this.crypto,
      });
      authorizations.push({ signerAddress: resolved.ownerAddr, signatures: [signature] });
    }
    return authorizations;
  }

  /**
   * Append an extra signature for a **genuine external co-signer** to be included when
   * sealing. The account-key signature is added automatically at {@link seal} unless
   * `mustSignWithAccountKey` is `false`.
   *
   * Do **NOT** pass the per-input one-time spend-key authorizations here — they are
   * produced (memoized) by {@link createAuthorizations} and auto-included by {@link seal}
   * exactly once. Re-adding them via this method would double-count them in the sealed tx,
   * which the engine rejects.
   */
  public addSignature(signature: TransactionSignature): this {
    this.extraSignatures.push(signature);
    return this;
  }

  /**
   * Sign and seal the (prepared) transfer into a `TransactionEnvelope`.
   *
   * Composes, over a SINGLE shared seal keypair:
   * - the account-key signature (unless `mustSignWithAccountKey` is `false`);
   * - the per-input **one-time spend-key authorizations** — included **exactly once** per
   *   stealth input via {@link createAuthorizations}'s memoized cache, whether or not the
   *   caller invoked {@link createAuthorizations} first; callers must NOT also re-add them
   *   via {@link addSignature};
   * - any {@link addSignature} extras (e.g. genuine external co-signers).
   *
   * All of these — and the seal signature itself — hash the tx with the same seal public
   * key, so every signature verifies against the same hash. The tx is **not** re-resolved
   * here (the builder already resolved it in `prepare()`); re-resolving could change the
   * hash and invalidate the already-computed one-time authorizations.
   *
   * @throws {KeyProviderNotFoundError} when a stealth-input owner has no signer registered.
   * @throws {SignerError} when a stealth-input signer cannot produce one-time signatures.
   */
  public async seal(): Promise<TransactionEnvelope> {
    // One-time spend-key authorizations (empty for the revealed-only path). Hashed with the
    // same seal public key the final seal uses. `createAuthorizations` is memoized, so this
    // returns the SAME signatures already produced if the caller called it first — each
    // one-time signature is included exactly once, never re-signed with a divergent nonce.
    const authorizations = await this.createAuthorizations();
    const oneTimeSignatures = authorizations.flatMap((a) => a.signatures);

    // Collect signers: the account key (unless skipped) plus a tiny in-line signer that
    // contributes the one-time authorizations and any queued extras (so they flow through
    // the same `signTransaction` collection path, hashed with the shared seal public key).
    const signers: Signer[] = [];
    if (this.mustSignWithAccountKey) {
      signers.push(this.wallet);
    }
    const staticSignatures = [...oneTimeSignatures, ...this.extraSignatures];
    if (staticSignatures.length > 0) {
      signers.push(new StaticSignatureSigner(staticSignatures));
    }

    // Reuse the shared seal keypair so the seal signature's hash matches the one the
    // one-time authorizations were signed over (the CRITICAL coordination invariant).
    const signed = await signTransaction(signers, this.spec.unsignedTx, this.sealKeypair);
    return sealTransaction(signed);
  }
}

/**
 * Patch the single stealth instruction in `unsignedTx` with a (hydrated) statement.
 *
 * Locates the sole `StealthTransfer` instruction (throws if there is not exactly one) and
 * replaces its `statement` field with the byte-exact compact JSON of `statement` (via the
 * single encoding seam in `instruction.ts`). Returns a new `UnsignedTransactionV1` — the
 * input is not mutated.
 *
 * @throws {InvalidArgumentError} when there is no StealthTransfer instruction (not a
 *   stealth tx) or more than one (malformed).
 */
export function patchStealthStatement(
  unsignedTx: UnsignedTransactionV1,
  statement: StealthTransferStatement,
): UnsignedTransactionV1 {
  const idx = unsignedTx.instructions.findIndex(isStealthTransferInstruction);
  if (idx < 0) {
    throw new InvalidArgumentError(
      "patchStealthStatement: expected exactly one StealthTransfer instruction, found 0 (not a stealth tx)",
    );
  }
  const extra = unsignedTx.instructions.slice(idx + 1).findIndex(isStealthTransferInstruction);
  if (extra >= 0) {
    throw new InvalidArgumentError(
      "patchStealthStatement: expected exactly one StealthTransfer instruction, found more than one (malformed)",
    );
  }
  // The type guard already matched at this index, but the array element type is the wider
  // Instruction union — re-narrow in-place to access `StealthTransfer`.
  const target = unsignedTx.instructions[idx] as StealthTransferInstruction;
  const patched = {
    StealthTransfer: {
      ...target.StealthTransfer,
      statement: statementAsWire(statement),
    },
  };
  const instructions = [...unsignedTx.instructions];
  instructions[idx] = patched;
  return { ...unsignedTx, instructions };
}

/**
 * A trivial {@link Signer} that contributes a fixed set of pre-computed signatures (and no
 * usable address/public key). Used internally to route {@link AuthorizedTransfer}'s queued
 * extra signatures through the shared `signTransaction` collection path.
 */
class StaticSignatureSigner implements Signer {
  public constructor(private readonly signatures: TransactionSignature[]) {}

  public async getAddress(): Promise<string> {
    throw new SignerError("StaticSignatureSigner has no address");
  }

  public async getPublicKey(): Promise<Uint8Array> {
    throw new SignerError("StaticSignatureSigner has no public key");
  }

  public async signTransaction(
    _unsignedTx: UnsignedTransactionV1,
    _sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    return this.signatures;
  }
}
