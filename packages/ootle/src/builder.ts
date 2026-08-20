//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  ComponentAddress,
  MinotariBurnClaimProof,
  ClaimBurnOutputData,
  ConfidentialWithdrawProof,
  Instruction,
  InstructionArg,
  ResourceAddress,
  SubstateRequirement,
  UnsignedTransactionV1,
  PublishedTemplateAddress,
  WorkspaceOffsetId,
  AllocatableAddressType,
} from "@tari-project/ootle-ts-bindings";
import { Network } from "./network";
import { microTariLiteral } from "./helpers/amount";
import { resourceAddressLiteral } from "./helpers/cbor-literal";
import { parseWorkspaceStringKey } from "./helpers/workspace";
import { InvalidArgumentError } from "./errors";
import type { Provider } from "./provider";

/**
 * The longest validity window any network accepts, in epochs
 * (`ConsensusConstants::max_transaction_validity_epochs`, ~30 days). A transaction whose
 * `max_epoch` sits further ahead of the current epoch than this is aborted with
 * `AbortReason::ValidityWindowTooLong`.
 */
export const MAX_TRANSACTION_VALIDITY_EPOCHS = 2160;

/**
 * The validity window {@link resolveMaxEpoch} applies when the caller does not name one.
 * Ten epochs is comfortably longer than a transaction takes to finalize while still
 * letting a stuck transaction die on its own rather than lingering as a resubmittable
 * intent.
 */
export const DEFAULT_TRANSACTION_VALIDITY_EPOCHS = 10;

/**
 * Reads the chain tip and returns the `max_epoch` a transaction built now should carry:
 * `currentEpoch + leadEpochs`.
 *
 * ```ts
 * const builder = TransactionBuilder.new(provider.network(), await resolveMaxEpoch(provider));
 * ```
 *
 * @throws {InvalidArgumentError} if `leadEpochs` is not a positive integer, or exceeds
 *   {@link MAX_TRANSACTION_VALIDITY_EPOCHS} (which the network would reject with
 *   `AbortReason::ValidityWindowTooLong`).
 */
export async function resolveMaxEpoch(
  provider: Provider,
  leadEpochs: number = DEFAULT_TRANSACTION_VALIDITY_EPOCHS,
): Promise<number> {
  if (!Number.isInteger(leadEpochs) || leadEpochs < 1) {
    throw new InvalidArgumentError(`resolveMaxEpoch: leadEpochs must be a positive integer, got ${leadEpochs}`);
  }
  if (leadEpochs > MAX_TRANSACTION_VALIDITY_EPOCHS) {
    throw new InvalidArgumentError(
      `resolveMaxEpoch: leadEpochs ${leadEpochs} exceeds the network's maximum validity window of ` +
        `${MAX_TRANSACTION_VALIDITY_EPOCHS} epochs`,
    );
  }
  return (await provider.getCurrentEpoch()) + leadEpochs;
}

const U64_MAX = (1n << 64n) - 1n;

/** @throws {InvalidArgumentError} if `epoch` is not a non-negative integer. */
function assertEpoch(epoch: number, name: string): number {
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new InvalidArgumentError(`${name} must be a non-negative integer epoch, got ${epoch}`);
  }
  return epoch;
}

/**
 * Strip the `template_` prefix to the bare `Hash32` hex the `CallFunction`
 * instruction expects on the wire. A bare hash is returned unchanged.
 */
function templateAddressToHash32(address: PublishedTemplateAddress): string {
  const prefix = "template_";
  return address.startsWith(prefix) ? address.slice(prefix.length) : address;
}

/**
 * The workspace slot an instruction **allocates**, or `null` if it allocates none.
 *
 * Mirrors `Instruction::allocated_workspace_id` in the Rust `tari_transaction` crate
 * (`crates/transaction/src/v1/instruction.rs`) — keep the two in step. Exactly three
 * instructions claim a slot; everything else that mentions a workspace id *reads* one
 * (`CallMethod`'s `{ Workspace }` call target, `{ Workspace: WorkspaceOffsetId }` args,
 * `TakeFromBucket.input_bucket`, `CreateAccount.bucket_workspace_id`).
 */
function allocatedWorkspaceId(instruction: Instruction): number | null {
  if (typeof instruction !== "object" || instruction === null) {
    return null;
  }
  if ("PutLastInstructionOutputOnWorkspace" in instruction) {
    return instruction.PutLastInstructionOutputOnWorkspace.key;
  }
  if ("TakeFromBucket" in instruction) {
    return instruction.TakeFromBucket.output_bucket;
  }
  if ("AllocateAddress" in instruction) {
    return instruction.AllocateAddress.workspace_id;
  }
  return null;
}

/**
 * Name → workspace-slot allocation for ONE workspace scope.
 *
 * Mirrors the Rust `WorkspaceIds` (`crates/transaction/src/builder/workspace_ids.rs`).
 * Slots are positional, so the counter must never hand out a slot an instruction in the
 * same scope already claimed — {@link observeAllocated} is how a slot that arrived on a
 * pre-built instruction (rather than through {@link insert}) is accounted for.
 */
class WorkspaceIds {
  private nextId = 0;
  private readonly ids = new Map<string, number>();

  /** Claim the next free slot for `name`. */
  public insert(name: string): number {
    const id = this.nextId;
    this.ids.set(name, id);
    this.nextId += 1;
    return id;
  }

  public get(name: string): number | undefined {
    return this.ids.get(name);
  }

  /** The next slot {@link insert} would hand out. */
  public get next(): number {
    return this.nextId;
  }

  /**
   * Account for a slot claimed by an instruction the builder did not allocate itself
   * (`addInstruction`, `withInstructions`, or an adopted transaction). Rust does this
   * inline in `add_instruction`.
   */
  public observeAllocated(id: number): void {
    if (id + 1 > this.nextId) {
      this.nextId = id + 1;
    }
  }

  /** Forget every name and restart allocation at 0. */
  public reset(): void {
    this.nextId = 0;
    this.ids.clear();
  }

  /** Reset, then account for every slot the given instructions already claim. */
  public resetFrom(instructions: Instruction[]): void {
    this.reset();
    for (const instruction of instructions) {
      const id = allocatedWorkspaceId(instruction);
      if (id !== null) {
        this.observeAllocated(id);
      }
    }
  }
}

function workspaceNotDefinedError(name: string): InvalidArgumentError {
  return new InvalidArgumentError(
    `No workspace variable named "${name}" has been defined. ` +
      `Call builder.saveVar(${JSON.stringify(name)}) on a preceding instruction whose output you want to reference.`,
  );
}

/** A function that can be called on a published template. */
export interface TariFunctionDefinition {
  templateAddress: PublishedTemplateAddress;
  functionName: string;
  args?: NamedArg[];
}

/** A method that can be called on a component. */
export interface TariMethodDefinition {
  methodName: string;
  args?: NamedArg[];
  /** Call by component address. Mutually exclusive with `fromWorkspace`. */
  componentAddress?: ComponentAddress;
  /** Call the component stored under this workspace key. Mutually exclusive with `componentAddress`. */
  fromWorkspace?: string;
}

/**
 * A NamedArg is either:
 * - `{ Workspace: string }` — a named workspace reference resolved by the builder to a numeric ID
 * - `InstructionArg` — a fully-formed `{ Workspace: WorkspaceOffsetId }` or `{ Literal: string }`
 */
export type NamedArg = { Workspace: string } | InstructionArg;

/**
 * `UnsignedTransactionV1` with the `blobs` list: standard-base64 payloads
 * referenced from instructions by index (see {@link TransactionBuilder.publishTemplate}).
 *
 * @deprecated `blobs` is now a field of `UnsignedTransactionV1` itself (ootle-ts-bindings
 * ≥ 1.47), so this intersection adds nothing. Kept as an alias for one release; use
 * `UnsignedTransactionV1` directly.
 */
export type UnsignedTransactionWithBlobs = UnsignedTransactionV1;

/**
 * Fluent builder for constructing UnsignedTransactionV1 objects.
 *
 * Only `buildUnsignedTransaction()` is exposed — signing is handled separately
 * via the `Signer` interface and `signTransaction` flow function.
 */
export class TransactionBuilder {
  private unsignedTransaction: UnsignedTransactionV1;
  // Two INDEPENDENT workspace scopes, matching the Rust builder's separate fee builder.
  // The engine drops the whole workspace between the fee instructions and the main ones
  // (`WorkspaceAction::DropAll` in the engine's transaction processor), so a slot used by
  // a fee instruction says nothing about which slots the main instructions may use.
  private workspaceIds: WorkspaceIds;
  private feeWorkspaceIds: WorkspaceIds;

  /**
   * `maxEpoch` is required: every transaction now carries a bounded validity window
   * (`UnsignedTransactionV1.max_epoch`), so the last epoch in which it may be sequenced
   * is decided up front rather than left open. The network rejects a window longer than
   * {@link MAX_TRANSACTION_VALIDITY_EPOCHS} epochs past the current one with
   * `AbortReason::ValidityWindowTooLong`, so derive it from the chain tip — e.g.
   * `(await provider.getCurrentEpoch()) + 10`.
   *
   * @throws {InvalidArgumentError} if `maxEpoch` is not a non-negative integer.
   */
  constructor(network: Network | number, maxEpoch: number) {
    this.unsignedTransaction = {
      network: network,
      fee_instructions: [],
      instructions: [],
      inputs: [],
      min_epoch: null,
      max_epoch: assertEpoch(maxEpoch, "maxEpoch"),
      dry_run: false,
      is_seal_signer_authorized: false,
      blobs: [],
      nonce: 0,
    };
    this.workspaceIds = new WorkspaceIds();
    this.feeWorkspaceIds = new WorkspaceIds();
  }

  public static new(network: Network | number, maxEpoch: number): TransactionBuilder {
    return new TransactionBuilder(network, maxEpoch);
  }

  public callFunction<T extends TariFunctionDefinition>(func: T, args: Exclude<T["args"], undefined>): this {
    const resolvedArgs = this.resolveArgs(args);
    return this.addInstruction({
      CallFunction: {
        address: templateAddressToHash32(func.templateAddress),
        function: func.functionName,
        args: resolvedArgs,
      },
    });
  }

  /**
   * @throws {InvalidArgumentError} if `method` provides neither `componentAddress`
   *   nor `fromWorkspace`, or if `fromWorkspace` references an undefined variable.
   */
  public callMethod<T extends TariMethodDefinition>(method: T, args: Exclude<T["args"], undefined>): this {
    let call: { Address: ComponentAddress } | { Workspace: number };
    if (method.componentAddress) {
      call = { Address: method.componentAddress };
    } else if (method.fromWorkspace) {
      call = { Workspace: this.requireNamedId(method.fromWorkspace) };
    } else {
      throw new InvalidArgumentError(
        "callMethod requires either `componentAddress` or `fromWorkspace` to be set on the method definition. " +
          "Use `fromWorkspace` to call a method on a component returned by a previous saveVar; " +
          "use `componentAddress` for an on-chain component.",
      );
    }
    const resolvedArgs = this.resolveArgs(args);
    return this.addInstruction({
      CallMethod: {
        call,
        method: method.methodName,
        args: resolvedArgs,
      },
    });
  }

  public createAccount(ownerPublicKey: string, workspaceBucket?: string): this {
    const bucket_workspace_id = workspaceBucket ? this.getOffsetIdFromWorkspaceName(workspaceBucket) : null;
    return this.addInstruction({
      CreateAccount: {
        owner_public_key: ownerPublicKey,
        owner_rule: null,
        access_rules: null,
        bucket_workspace_id,
      },
    });
  }

  public createProof(account: ComponentAddress, resourceAddress: ResourceAddress): this {
    return this.addInstruction({
      CallMethod: {
        call: { Address: account },
        method: "create_proof_for_resource",
        args: [resourceAddressLiteral(resourceAddress)],
      },
    });
  }

  public claimBurn(claim: MinotariBurnClaimProof, output_data: ClaimBurnOutputData): this {
    return this.addInstruction({
      ClaimBurn: { claim, output_data },
    });
  }

  public allocateAddress(allocatableType: AllocatableAddressType, workspaceIdName: string): this {
    const workspace_id = this.addNamedId(workspaceIdName);
    return this.addInstruction({
      AllocateAddress: { allocatable_type: allocatableType, workspace_id },
    });
  }

  /**
   * Saves the last instruction output to a named workspace variable.
   * The variable can be referenced by subsequent instructions using `{ Workspace: "name" }`.
   */
  public saveVar(name: string): this {
    const key = this.addNamedId(name);
    return this.addInstruction({
      PutLastInstructionOutputOnWorkspace: { key },
    });
  }

  /**
   * Adds a fee instruction that calls `pay_fee` on the given component.
   * The component must call `vault.pay_fee` and reveal enough confidential XTR.
   */
  public feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: bigint): this {
    return this.addFeeInstruction({
      CallMethod: {
        call: { Address: componentAddress },
        method: "pay_fee",
        args: [microTariLiteral(maxFee)],
      },
    });
  }

  /**
   * NOT IMPLEMENTED — always throws. A confidential `pay_fee` needs a
   * `ConfidentialWithdrawProof` `Literal` that requires `tari_bor` struct encoding
   * the TS SDK does not yet provide. Use {@link feeTransactionPayFromComponent} for
   * revealed-fee payment.
   *
   * @throws {InvalidArgumentError} always.
   */
  public feeTransactionPayFromComponentConfidential(
    _componentAddress: ComponentAddress,
    _proof: ConfidentialWithdrawProof,
  ): this {
    throw new InvalidArgumentError(
      "feeTransactionPayFromComponentConfidential is not implemented: a ConfidentialWithdrawProof " +
        "Literal must be tari_bor-CBOR-encoded, which the TS SDK does not yet support.",
    );
  }

  public dropAllProofsInWorkspace(): this {
    return this.addInstruction("DropAllProofsInWorkspace");
  }

  /**
   * Publishes a compiled WASM template. The binary is stored as a transaction
   * blob and referenced by index from the `PublishTemplate` instruction.
   *
   * @param binaryBase64 the template WASM, standard-base64 encoded
   * @param metadataHash optional multihash of off-chain CBOR metadata
   */
  public publishTemplate(binaryBase64: string, metadataHash: string | null = null): this {
    const binary = this.unsignedTransaction.blobs.length;
    this.unsignedTransaction.blobs.push(binaryBase64);
    return this.addInstruction({
      PublishTemplate: { binary, metadata_hash: metadataHash },
    });
  }

  public addInstruction(instruction: Instruction): this {
    this.observeAllocations(this.workspaceIds, [instruction]);
    this.unsignedTransaction.instructions.push(instruction);
    return this;
  }

  public addFeeInstruction(instruction: Instruction): this {
    this.observeAllocations(this.feeWorkspaceIds, [instruction]);
    this.unsignedTransaction.fee_instructions.push(instruction);
    return this;
  }

  public withInstructions(instructions: Instruction[]): this {
    this.observeAllocations(this.workspaceIds, instructions);
    this.unsignedTransaction.instructions.push(...instructions);
    return this;
  }

  public withFeeInstructions(instructions: Instruction[]): this {
    this.observeAllocations(this.feeWorkspaceIds, instructions);
    this.unsignedTransaction.fee_instructions.push(...instructions);
    return this;
  }

  /**
   * Account for slots claimed by instructions the builder did not allocate itself, so a
   * later `saveVar` cannot re-issue one. Rust does this inline in `add_instruction`.
   */
  private observeAllocations(scope: WorkspaceIds, instructions: Instruction[]): void {
    for (const instruction of instructions) {
      const id = allocatedWorkspaceId(instruction);
      if (id !== null) {
        scope.observeAllocated(id);
      }
    }
  }

  /**
   * Build the fee instructions with a nested builder, mirroring the Rust builder's separate
   * fee-instruction builder. The nested builder gets its own workspace scope — correct,
   * because the engine clears the workspace between the fee and main instruction runs.
   *
   * Note this REPLACES any fee instructions already set, as it always has.
   */
  public withFeeInstructionsBuilder(builder: (b: TransactionBuilder) => TransactionBuilder): this {
    const inner = builder(new TransactionBuilder(this.unsignedTransaction.network, this.unsignedTransaction.max_epoch));
    this.unsignedTransaction.fee_instructions = inner.unsignedTransaction.instructions;
    // Adopt the nested builder's slot accounting so later `addFeeInstruction` calls on the
    // outer builder cannot re-issue a slot the nested one already claimed.
    this.feeWorkspaceIds.resetFrom(this.unsignedTransaction.fee_instructions);
    return this;
  }

  public addInput(input: SubstateRequirement): this {
    this.unsignedTransaction.inputs.push(input);
    return this;
  }

  public withInputs(inputs: SubstateRequirement[]): this {
    this.unsignedTransaction.inputs.push(...inputs);
    return this;
  }

  /** @throws {InvalidArgumentError} if `minEpoch` is not a non-negative integer. */
  public withMinEpoch(minEpoch: number): this {
    this.unsignedTransaction.min_epoch = assertEpoch(minEpoch, "minEpoch");
    return this;
  }

  /**
   * Overrides the validity window set at construction. See the constructor for the
   * network's cap on how far ahead of the current epoch this may sit.
   *
   * @throws {InvalidArgumentError} if `maxEpoch` is not a non-negative integer.
   */
  public withMaxEpoch(maxEpoch: number): this {
    this.unsignedTransaction.max_epoch = assertEpoch(maxEpoch, "maxEpoch");
    return this;
  }

  /**
   * Stamps the transaction nonce, which distinguishes otherwise-identical transactions.
   *
   * The transaction id excludes the seal signature's witness data, so two identical
   * bodies sealed by the same key are the *same* transaction — submitting both executes
   * once. Give each intent a distinct nonce when repeated submissions must each execute.
   * Defaults to `0`.
   *
   * @throws {InvalidArgumentError} if `nonce` is negative or overflows u64.
   */
  public withNonce(nonce: number | bigint): this {
    if (typeof nonce === "number" && !Number.isInteger(nonce)) {
      throw new InvalidArgumentError(`withNonce: nonce must be an integer, got ${nonce}`);
    }
    const value = typeof nonce === "bigint" ? nonce : BigInt(nonce);
    if (value < 0n || value > U64_MAX) {
      throw new InvalidArgumentError(`withNonce: nonce must fit an unsigned 64-bit integer, got ${nonce}`);
    }
    // Kept as a `bigint` above `Number.MAX_SAFE_INTEGER` so `serializeUnsignedTx` can emit
    // it losslessly as a JSON string; smaller values stay bare numbers, as they always were.
    this.unsignedTransaction.nonce = value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
    return this;
  }

  /**
   * Adopt an existing transaction and keep building on it.
   *
   * The adopted transaction is **copied**, not aliased: subsequent builder calls must not
   * reach back into the caller's object. The manual co-signing flow ships
   * `JSON.stringify(unsigned)` across a boundary, so mutating a transaction the caller has
   * already serialized or signed makes the two sides disagree — surfacing only at submit
   * time as the opaque engine error `"Transaction has one or more invalid signature(s)"`.
   * This mirrors the copy {@link buildUnsignedTransaction} makes on the way out.
   */
  public withUnsignedTransaction(unsignedTransaction: UnsignedTransactionV1): this {
    // `blobs` and `nonce` are required on the binding type but may still be absent on a
    // value that crossed a JSON boundary (the wire struct defaults both), so keep the
    // fallbacks. `max_epoch` has no default — a transaction without one is not valid, so
    // adopting one is a caller error rather than something to paper over.
    this.unsignedTransaction = {
      ...unsignedTransaction,
      instructions: [...unsignedTransaction.instructions],
      fee_instructions: [...unsignedTransaction.fee_instructions],
      inputs: [...unsignedTransaction.inputs],
      blobs: [...(unsignedTransaction.blobs ?? [])],
      nonce: unsignedTransaction.nonce ?? 0,
      max_epoch: assertEpoch(unsignedTransaction.max_epoch, "withUnsignedTransaction: max_epoch"),
    };
    // Workspace *names* are not recoverable from the wire form, so the name → id mapping
    // starts empty and adopted buckets stay unaddressable by name (as before). The *slots*
    // those instructions occupy are recoverable, though, and must not be handed out again:
    // workspace ids are positional, so re-issuing a live slot means the next `saveVar`
    // clobbers it and the adopted instruction reading it consumes the wrong bucket, with
    // no diagnostic. Resume allocation past the highest slot already in use.
    this.workspaceIds.resetFrom(this.unsignedTransaction.instructions);
    this.feeWorkspaceIds.resetFrom(this.unsignedTransaction.fee_instructions);
    return this;
  }

  /**
   * Resolves a workspace variable name (supporting dot-notation offsets, e.g. `"bucket.0"`)
   * to its `WorkspaceOffsetId`. The variable must have been declared by a prior `saveVar`
   * (or other allocating call). Use this when constructing an `Instruction` that takes a
   * `WorkspaceOffsetId` directly (e.g. the native `StealthTransfer` variant's
   * `revealed_input_bucket`), where the builder's automatic `{ Workspace: "name" }` arg
   * resolution does not apply.
   *
   * @throws {InvalidArgumentError} if no workspace variable with that name has been defined.
   */
  public resolveWorkspaceOffsetId(name: string): WorkspaceOffsetId {
    return this.getOffsetIdFromWorkspaceName(name);
  }

  public buildUnsignedTransaction(): UnsignedTransactionV1 {
    return {
      ...this.unsignedTransaction,
      instructions: [...this.unsignedTransaction.instructions],
      fee_instructions: [...this.unsignedTransaction.fee_instructions],
      inputs: [...this.unsignedTransaction.inputs],
      blobs: [...this.unsignedTransaction.blobs],
    };
  }

  // Internal helpers

  private addNamedId(name: string): number {
    return this.workspaceIds.insert(name);
  }

  private requireNamedId(name: string): number {
    const id = this.workspaceIds.get(name);
    if (id === undefined) throw workspaceNotDefinedError(name);
    return id;
  }

  private getOffsetIdFromWorkspaceName(name: string): WorkspaceOffsetId {
    const parsed = parseWorkspaceStringKey(name);
    return { id: this.requireNamedId(parsed.name), offset: parsed.offset };
  }

  private resolveArgs(args: NamedArg[]): InstructionArg[] {
    return args.map((arg): InstructionArg => {
      if (
        typeof arg === "object" &&
        arg !== null &&
        "Workspace" in arg &&
        typeof (arg as { Workspace: unknown }).Workspace === "string"
      ) {
        const workspaceId = this.getOffsetIdFromWorkspaceName((arg as { Workspace: string }).Workspace);
        return { Workspace: workspaceId };
      }
      return arg as InstructionArg;
    });
  }
}
