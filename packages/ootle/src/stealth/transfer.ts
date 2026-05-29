//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Send-side stealth transfer builder.
//
// A fluent, multi-input / multi-output builder that turns a set of
// revealed/stealth inputs and stealth/revealed outputs into an
// `UnsignedTransactionV1` carrying the on-chain stealth instruction plus an
// (incomplete) `StealthTransferStatement`. The authorizer (`authorizer.ts`)
// then signs the balance proof, hydrates the statement, and seals.

import type { ComponentAddress, ResourceAddress, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "../builder";
import type { Provider } from "../provider";
import { resolveTransaction } from "../transaction";
import { amountLiteral, resourceAddressLiteral } from "../helpers/cbor-literal";
import { toHexStr } from "../helpers/hex";
import { getVaultIdsForAccount } from "../helpers/vault-walker";
import { InvalidArgumentError } from "../errors";
import { WasmStealthCrypto } from "./wasm-crypto";
import type { StealthCryptoProvider } from "./crypto-provider";
import type { Mask, Output } from "./primitives";
import { StealthInput, StealthTransferStatement } from "./statements";
import { stealthUtxoSubstateId } from "./substate-parse";
import { STEALTH_INPUT_BUCKET, STEALTH_REVEALED_CHANGE_BUCKET, stealthTransferInstruction } from "./instruction";

/** Mutable internal state accumulated by a {@link StealthTransfer} builder. */
export interface StealthTransferState {
  resource: ResourceAddress;
  /**
   * The revealed-source account and the total amount withdrawn from it, or `null` for a
   * stealth-input-only spend. Coupling the source and amount in one tagged field encodes the
   * invariant — a revealed input always has a source — in the type system, so consumers can
   * narrow without "unreachable" guards.
   */
  revealedInput: { source: ComponentAddress; amount: bigint } | null;
  /**
   * Stealth UTXOs to spend, keyed by their **commitment hex alone** (insertion-ordered,
   * duplicates rejected). A commitment uniquely identifies a UTXO within the builder's
   * single resource, and a UTXO has exactly one owner — so keying by commitment (not
   * owner+commitment) prevents the same UTXO being registered twice under different owner
   * labels, which the engine would reject as a self-double-spend. Each value carries the
   * input alongside its owner address (the one-time spend signer). The `Map` preserves
   * insertion order so the masks aggregate and the inputs statement is built in the
   * **same** order — required for the balance proof to verify.
   */
  inputsToSpend: Map<string, { input: StealthInput; owner: string }>;
  outputs: Output[];
  revealedOutputAmount: bigint;
}

/**
 * The output of {@link StealthTransfer.prepare}: an unsigned transaction carrying the
 * on-chain stealth instruction and an **incomplete** statement (`balanceProof:
 * undefined`), plus the metadata the authorizer needs to finish it.
 */
export interface StealthTransferSpec {
  /** The unsigned transaction with substate versions resolved. */
  unsignedTx: UnsignedTransactionV1;
  /** The (incomplete) transfer statement; the authorizer fills `balanceProof`. */
  statement: StealthTransferStatement;
  /** The aggregated output blinding mask, needed to sign the balance proof. */
  outputMask: Mask;
  /** The builder state (resource, inputs, amounts) — consumed by the authorizer. */
  state: StealthTransferState;
  /**
   * Addresses that must authorize the transaction. The revealed source account (when there
   * is revealed input) is required first, followed by each distinct stealth-input owner
   * (in first-seen order) — those owners supply the one-time spend-key authorizations.
   */
  requiredSigners: string[];
  /**
   * Ordered list of stealth inputs being spent, each paired with its owner address. Order
   * matches the order `spendStealthInput` was called — required for the input-mask
   * aggregation and inputs-statement build to agree on ordering.
   */
  inputs: Array<{ input: StealthInput; owner: string }>;
}

/**
 * Fluent builder for a confidential (stealth) transfer.
 *
 * Supports the full input/output matrix: spend revealed input (withdraw from a vault)
 * and/or one or more confidential UTXOs ({@link spendStealthInput}), emit one or more
 * stealth outputs (+ optional revealed change), and a fee. The balance equation
 * (revealed-in + stealth-in == stealth-out + revealed-out) must hold; the stealth-input
 * value is carried by each input's mask, recovered by the authorizer.
 *
 * @example
 * ```ts
 * const spec = await new StealthTransfer(provider, resourceAddress)
 *   .spendRevealedInput(account, 5n * TARI)
 *   .toStealthOutput(createOutput({ destination, amount: 3n * TARI, resourceAddress }))
 *   .toRevealedOutput(1n * TARI)   // revealed change back to `account`
 *   .payFeeFromRevealed(1n * TARI)
 *   .prepare();
 * ```
 */
export class StealthTransfer {
  private readonly provider: Provider;
  private readonly crypto: StealthCryptoProvider;
  private builder: TransactionBuilder;
  private readonly state: StealthTransferState;
  /** Guards against a second {@link prepare} re-emitting instructions into the same builder. */
  private prepared = false;

  /**
   * @param provider - Read-only chain access (used by {@link prepare} to resolve inputs).
   * @param resourceAddress - The resource being transferred.
   * @param crypto - Injectable crypto seam; defaults to {@link WasmStealthCrypto}. Tests
   *   pass a {@link FakeStealthCrypto} for WASM-free runs.
   */
  public constructor(
    provider: Provider,
    resourceAddress: ResourceAddress,
    crypto: StealthCryptoProvider = new WasmStealthCrypto(provider.network()),
  ) {
    this.provider = provider;
    this.crypto = crypto;
    this.builder = TransactionBuilder.new(provider.network());
    this.state = {
      resource: resourceAddress,
      revealedInput: null,
      inputsToSpend: new Map(),
      outputs: [],
      revealedOutputAmount: 0n,
    };
  }

  /**
   * Withdraw `amount` of the transfer's resource from `account`'s revealed vault.
   *
   * All revealed input must come from a single account (the fee/change source). Calling
   * this more than once accumulates the amount but the account must be the same.
   *
   * @throws {InvalidArgumentError} if `amount` is not `> 0`, or a different source
   *   account is supplied on a second call.
   */
  public spendRevealedInput(account: ComponentAddress, amount: bigint): this {
    if (amount <= 0n) {
      throw new InvalidArgumentError(`spendRevealedInput amount must be > 0, got ${amount}`);
    }
    const existing = this.state.revealedInput;
    if (existing !== null && existing.source !== account) {
      throw new InvalidArgumentError(
        `spendRevealedInput: all revealed input must come from one account ` +
          `(${existing.source} != ${account})`,
      );
    }
    this.state.revealedInput = { source: account, amount: (existing?.amount ?? 0n) + amount };
    return this;
  }

  /** Add a stealth output to create (repeatable). */
  public toStealthOutput(spec: Output): this {
    this.state.outputs.push(spec);
    return this;
  }

  /**
   * Add revealed (un-confidential) change, returned to the revealed source account.
   *
   * @throws {InvalidArgumentError} if `amount` is not `> 0`.
   */
  public toRevealedOutput(amount: bigint): this {
    if (amount <= 0n) {
      throw new InvalidArgumentError(`toRevealedOutput amount must be > 0, got ${amount}`);
    }
    this.state.revealedOutputAmount += amount;
    return this;
  }

  /**
   * Pay the transaction fee from the revealed source account (max `amount`).
   *
   * @throws {InvalidArgumentError} if no source account is set, or `amount` is not `> 0`.
   */
  public payFeeFromRevealed(amount: bigint): this {
    if (this.state.revealedInput === null) {
      throw new InvalidArgumentError("payFeeFromRevealed: call spendRevealedInput first to set the source account");
    }
    if (amount <= 0n) {
      throw new InvalidArgumentError(`payFeeFromRevealed amount must be > 0, got ${amount}`);
    }
    this.builder.feeTransactionPayFromComponent(this.state.revealedInput.source, amount);
    return this;
  }

  /** Escape hatch over the inner {@link TransactionBuilder} (e.g. extra instructions). */
  public withBuilder(fn: (b: TransactionBuilder) => TransactionBuilder): this {
    this.builder = fn(this.builder);
    return this;
  }

  /**
   * Spend a confidential UTXO owned by `ownerAddr`, identified by its 32-byte
   * `commitment`.
   *
   * Repeatable: each call adds another stealth input. Inputs are keyed by their
   * **commitment hex alone** and de-duplicated — a second call with the same commitment
   * throws, **regardless of the owner label**. A commitment uniquely identifies a UTXO
   * within the builder's single resource and a UTXO has exactly one owner, so the same
   * commitment under two different owner labels is still the same UTXO; accepting it twice
   * would register the substate id twice and emit the commitment twice in the inputs
   * statement — a self-double-spend the engine rejects. The owner address is recorded
   * alongside the input so the authorizer can pick the one-time spend signer for each.
   *
   * The input's value contributes to the balance equation via its **mask** (recovered by
   * the authorizer when it unblinds the UTXO), so the builder does not need the amount
   * here — only the commitment.
   *
   * @throws {InvalidArgumentError} if `commitment` is not 32 bytes, or the same
   *   commitment is added twice (under any owner).
   */
  public spendStealthInput(ownerAddr: string, commitment: Uint8Array): this {
    // Constructing the StealthInput validates the 32-byte length and defensively copies.
    const input = new StealthInput(commitment);
    const key = toHexStr(input.commitment);
    const existing = this.state.inputsToSpend.get(key);
    if (existing !== undefined) {
      throw new InvalidArgumentError(
        `spendStealthInput: duplicate commitment ${key} — each commitment is one UTXO and may be spent ` +
          `once (already added for owner ${existing.owner}). A commitment uniquely identifies a UTXO; ` +
          `adding it again (even under a different owner) would self-double-spend.`,
      );
    }
    this.state.inputsToSpend.set(key, { input, owner: ownerAddr });
    return this;
  }

  /**
   * Assemble the unsigned transaction and the (incomplete) transfer statement.
   *
   * 1. validate (≥1 input, ≥1 stealth output);
   * 2. generate the outputs statement (+ aggregated output mask) via the crypto seam;
   * 3. build the inputs statement (concatenated commitments + revealed input
   *    amount) and assemble an incomplete {@link StealthTransferStatement}
   *    (`balanceProof: undefined`);
   * 4. emit instructions: revealed `withdraw` → `saveVar` → the native
   *    `StealthTransfer` instruction (+ deposit the revealed-change bucket);
   * 5. register the revealed source account + every vault it references as tx
   *    inputs (otherwise the engine rejects `withdraw` / `pay_fee` with
   *    `SubstateNotFound`);
   * 6. register each stealth input's UTXO substate id as a tx input so it is
   *    resolved / locked alongside the revealed inputs;
   * 7. resolve substate versions via the provider;
   * 8. return the {@link StealthTransferSpec}.
   *
   * Stealth-input **values** are carried by their masks (recovered later by the
   * authorizer), not as amounts — there is no balance-equation check here when stealth
   * inputs are present, because the builder does not know their values; the balance proof
   * (which the authorizer signs over the recovered masks) is the authoritative check.
   *
   * @throws {InvalidArgumentError} if the builder is invalid (no inputs, no outputs,
   *   no stealth output, unbalanced revealed-only transfer, or revealed change without
   *   a revealed source) or `prepare` has already been called once.
   */
  public async prepare(): Promise<StealthTransferSpec> {
    if (this.prepared) {
      throw new InvalidArgumentError(
        "StealthTransfer.prepare: already prepared — create a new StealthTransfer to build again",
      );
    }
    this.validate();
    // Mark prepared only after validation passes, so a failed-validation builder can be
    // corrected and retried; this guards only against a successful second emit.
    this.prepared = true;

    // 2. Outputs statement (+ aggregated output mask) from the crypto seam.
    const { statement: outputsStatement, outputMask } = await this.crypto.generateOutputsStatement(
      this.state.outputs,
      this.state.revealedOutputAmount,
    );

    // 3. Inputs statement: the stealth input commitments + the revealed input
    //    amount, insertion-ordered (the `Map` preserves it). For the
    //    revealed-only path the input list is empty. No balance proof yet —
    //    the authorizer fills it once it has unblinded the inputs.
    const inputsStatement = await this.crypto.buildInputsStatement(
      [...this.state.inputsToSpend.values()].map((v) => v.input),
      this.state.revealedInput?.amount ?? 0n,
    );
    const statement = new StealthTransferStatement(inputsStatement, outputsStatement, undefined);

    // 4. Emit instructions.
    this.emitInstructions(statement);

    const declaredInputs = new Set<string>();

    // 5. Register the revealed source account + every vault it touches as tx inputs —
    //    the engine rejects `withdraw` / `pay_fee` with `SubstateNotFound` otherwise.
    if (this.state.revealedInput !== null) {
      const account = this.state.revealedInput.source;
      this.builder.addInput({ substate_id: account, version: null });
      declaredInputs.add(account);
      const vaultIds = await getVaultIdsForAccount(this.provider, account);
      for (const vaultId of vaultIds) {
        if (!declaredInputs.has(vaultId)) {
          this.builder.addInput({ substate_id: vaultId, version: null });
          declaredInputs.add(vaultId);
        }
      }
    }

    // 6. Register each stealth input's UTXO as a tx input (unversioned — resolved below).
    //    The engine reads the commitments from the inputs statement and consumes these UTXOs.
    for (const { input } of this.state.inputsToSpend.values()) {
      const id = stealthUtxoSubstateId(this.state.resource, input.commitment);
      if (!declaredInputs.has(id)) {
        this.builder.addInput({ substate_id: id, version: null });
        declaredInputs.add(id);
      }
    }

    // 7. Resolve substate versions.
    const unsignedTx = await resolveTransaction(this.provider, this.builder.buildUnsignedTransaction());

    // 8. Project each stealth input with its owner (insertion-ordered) so the authorizer
    //    consumes a ready-made list. The map already pairs input + owner.
    const inputs: Array<{ input: StealthInput; owner: string }> = [...this.state.inputsToSpend.values()];

    // 9. Required signers: the revealed source account (when there is revealed input),
    //    followed by each distinct stealth-input owner (first-seen order) — those owners
    //    supply the one-time spend-key authorizations.
    const requiredSigners = this.collectRequiredSigners(inputs);

    return { unsignedTx, statement, outputMask, state: this.state, requiredSigners, inputs };
  }

  /**
   * Build the ordered, de-duplicated list of addresses that must authorize the tx: the
   * revealed source account first (if any), then each distinct stealth-input owner in the
   * order it was first added.
   */
  private collectRequiredSigners(inputs: Array<{ owner: string }>): string[] {
    const signers: string[] = [];
    const seen = new Set<string>();
    if (this.state.revealedInput !== null) {
      signers.push(this.state.revealedInput.source);
      seen.add(this.state.revealedInput.source);
    }
    for (const { owner } of inputs) {
      if (!seen.has(owner)) {
        signers.push(owner);
        seen.add(owner);
      }
    }
    return signers;
  }

  /**
   * Validate the builder before assembly: at least one input (revealed and/or stealth) and
   * at least one stealth output, plus — for the revealed-only path — the balance equation
   * `revealedInput.amount == stealthOut + revealedOut`.
   *
   * The fee is withdrawn separately by the fee instruction, not from the transferred
   * amount. When stealth inputs are present, the per-input values are unknown to the builder
   * (carried by masks), so the arithmetic check is **skipped** — the balance proof the
   * authorizer signs is authoritative. We still surface obvious wiring mistakes early.
   */
  private validate(): void {
    const hasStealthInputs = this.state.inputsToSpend.size > 0;
    const revealedAmount = this.state.revealedInput?.amount ?? 0n;
    const hasInput = revealedAmount > 0n || hasStealthInputs;
    if (!hasInput) {
      throw new InvalidArgumentError(
        "StealthTransfer.prepare: no inputs — call spendRevealedInput or spendStealthInput first",
      );
    }
    if (this.state.outputs.length === 0 && this.state.revealedOutputAmount === 0n) {
      throw new InvalidArgumentError(
        "StealthTransfer.prepare: no outputs — call toStealthOutput or toRevealedOutput first",
      );
    }
    if (this.state.outputs.length === 0) {
      // A stealth transfer must create at least one confidential output (a fully-revealed
      // transfer is a plain public transfer, not this builder's job).
      throw new InvalidArgumentError("StealthTransfer.prepare: at least one stealth output is required");
    }
    if (this.state.revealedOutputAmount > 0n && this.state.revealedInput === null) {
      // Revealed change needs an account to deposit back into — without a revealed source,
      // there is no destination for the change bucket the StealthTransfer instruction emits.
      throw new InvalidArgumentError(
        "StealthTransfer.prepare: revealed change requires a revealed source account to deposit into",
      );
    }

    // Only the pure revealed-only path has a known closed-form balance equation. With
    // stealth inputs the input values live in masks the builder can't see, so we defer to
    // the on-chain balance proof.
    if (!hasStealthInputs) {
      const stealthOut = this.state.outputs.reduce((sum, o) => sum + o.amount, 0n);
      const totalOut = stealthOut + this.state.revealedOutputAmount;
      const totalIn = revealedAmount;
      if (totalIn !== totalOut) {
        throw new InvalidArgumentError(
          `StealthTransfer.prepare: unbalanced transfer — revealed input ${totalIn} != ` +
            `stealth out ${stealthOut} + revealed out ${this.state.revealedOutputAmount} (= ${totalOut})`,
        );
      }
    }
  }

  /**
   * Emit the instruction sequence into the inner builder:
   * (revealed `withdraw` → `saveVar`)? → native `StealthTransfer` → deposit revealed change?
   *
   * The revealed `withdraw` and the `revealed_input_bucket` are emitted **only** when there
   * is a revealed input amount; a stealth-input-only transfer passes a `null` bucket. The
   * fee instruction (if any) was already added by {@link payFeeFromRevealed}.
   */
  private emitInstructions(statement: StealthTransferStatement): void {
    const revealed = this.state.revealedInput;

    // Revealed withdraw → bucket (only when there is a revealed input). Mirrors
    // `AccountInvokeBuilder.publicTransfer`.
    let revealedInputBucket: string | null = null;
    if (revealed !== null) {
      this.builder
        .callMethod({ componentAddress: revealed.source, methodName: "withdraw" }, [
          resourceAddressLiteral(this.state.resource),
          amountLiteral(revealed.amount),
        ])
        .saveVar(STEALTH_INPUT_BUCKET);
      revealedInputBucket = STEALTH_INPUT_BUCKET;
    }

    // The native StealthTransfer instruction consumes the revealed-input bucket (or null for
    // a stealth-input-only spend) and carries the (incomplete) statement byte-exact. See
    // `instruction.ts` for the shape + evidence. The bucket's `WorkspaceOffsetId` is
    // resolved against the builder's name → id map.
    this.builder.addInstruction(
      stealthTransferInstruction(
        {
          resourceAddress: this.state.resource,
          revealedInputBucket,
          statement,
        },
        (name) => this.builder.resolveWorkspaceOffsetId(name),
      ),
    );

    // When there is revealed change, the StealthTransfer instruction outputs a bucket for
    // it (`revealed_output_amount > 0`); save it and deposit back to the source account.
    // `validate()` enforces the source-present invariant before we get here.
    if (this.state.revealedOutputAmount > 0n && revealed !== null) {
      this.builder
        .saveVar(STEALTH_REVEALED_CHANGE_BUCKET)
        .callMethod({ componentAddress: revealed.source, methodName: "deposit" }, [
          { Workspace: STEALTH_REVEALED_CHANGE_BUCKET },
        ]);
    }
  }
}
