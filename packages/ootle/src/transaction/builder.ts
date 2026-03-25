//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  Amount,
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
  Transaction,
  UnsignedTransaction,
  TransactionSignature,
} from "@tari-project/ootle-ts-bindings";
import { Network } from "../network";
import { parseWorkspaceStringKey, toHexStr } from "../helpers";
import { TransactionRequest } from "./request";

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
 * Wraps a literal value as an InstructionArg. The string representation is the
 * canonical format accepted by the Tari runtime; for complex types use the WASM
 * encoder to produce a properly BOR-encoded literal.
 */
export function literalArg(value: Amount | string): InstructionArg {
  return { Literal: String(value) };
}

/**
 * This interface defines the constructor for a Transaction object.
 * It is used to create a new signed Transaction instance from an UnsignedTransaction and an array of TransactionSignatures.
 * The constructor takes an UnsignedTransaction and an array of TransactionSignatures as parameters.
 * @public
 */

export interface TransactionConstructor {
  /**
   * Creates a new {@link Transaction} instance.
   *
   * @param unsignedTransaction - The UnsignedTransaction to create the Transaction from.
   * @param signatures - An array of {@link TransactionSignature} objects, each containing:
   *   - `public_key`: A string representing a valid 32-byte Ristretto255 public key.
   *   - `signature`: An object containing:
   *       - `public_nonce`: A string representing the public nonce part of the Schnorr signature.
   *         - **NOTE:** Must be a valid 32-byte Ristretto255 public key, serialized as a hex string.
   *       - `signature`: A string representing the actual Schnorr signature scalar.
   *         - **NOTE:** Must be a valid 32-byte Schnorr signature scalar, serialized as a hex string.
   *
   * All fields must be validly encoded, canonical Ristretto255 public keys or Schnorr signature components in the correct format and length.
   * Any deviation (e.g., wrong length, invalid encoding) will result in errors or failed signature verification.
   *
   * @returns A new Transaction instance.
   */
  new (unsignedTransaction: UnsignedTransaction, signatures: TransactionSignature[]): Transaction;
}

export interface Builder {
  /**
   * Adds a function call to the transaction, allowing the developer to invoke a function on a published template. This implements {@link TariFunctionDefinition}
   * @param func - The function definition to call, which includes the function name, arguments, and template address.
   * @param args - The arguments to pass to the function. These should be provided as an array of {@link NamedArg} objects. Optional.
   * @returns The current instance of the Builder, allowing for method chaining.
   */
  callFunction<T extends TariFunctionDefinition>(func: T, args: Exclude<T["args"], undefined>): this;

  /**
   * Adds a method call to the transaction, allowing the developer to invoke a method on a component. This implements {@link TariMethodDefinition}
   * @param method - The method definition to call, which includes the method name, arguments, and component address.
   * @param args - The arguments to pass to the method. These should be provided as an array of {@link NamedArg} objects. Optional.
   * @returns The current instance of the Builder, allowing for method chaining.
   */
  callMethod<T extends TariMethodDefinition>(method: T, args: Exclude<T["args"], undefined>): this;

  /**
   * Adds an instruction to create a new account in the Tari Network to the transaction.
   * @param ownerPublicKey - The public key of the account owner, represented as a 64-character hexadecimal string.
   * @param workspaceBucket - An optional workspace bucket name to associate with the account. If provided, it will be used to create a workspace for the account. Allows for referencing the account elsewhere in the transaction without requiring it's address.
   * @returns The current instance of the Builder, allowing for method chaining.
   * @example
   */
  createAccount(ownerPublicKey: Uint8Array, workspaceBucket?: string): this;

  /**
   * Creates an internal proof that can be used to prove ownership of a resource in a component's account.
   * @param account - The address of the component account that owns the resource. represented as a 64-character hexadecimal string, prepended with "component_".
   * @param resourceAddress - The address of the resource to create a proof for, represented as a 64-character hexadecimal string, prepended with "resource_".
   * @returns The current instance of the Builder, allowing for method chaining.
   */
  createProof(account: ComponentAddress, resourceAddress: ResourceAddress): this;

  /**
   * Creates a variable in the workspace to store the output of the last instruction, which can be used later in the transaction.
   * @param key - The name of the variable to save the last instruction's output to.
   * @returns The current instance of the Builder, allowing for method chaining.
   * @remarks
   * Must be used after an instruction that produces an output, such as a function call or method call, and before any subsequent instructions that may use the saved variable.
   */
  saveVar(key: string): this;

  /**
   * Calls a method to remove all proofs in the current workspace.
   * @returns The current instance of the Builder, allowing for method chaining.
   * @remarks
   * Any proof references saved in the workspace via saveVar will be removed, invalidating any subsequent instructions that call on the variable.
   */
  dropAllProofsInWorkspace(): this;

  /**
   * Adds a `ClaimBurn` instruction to the transaction, allowing the user to claim a previously burned confidential output.
   *
   * @param claim - A {@link MinotariBurnClaimProof} object containing cryptographic proofs that authorize the claim. This includes the burn output address, ownership proof, range proof, and optional withdraw proof.
   * @param output_data
   * @returns The current instance of the Builder, enabling method chaining.
   * @remarks
   * - The `MinotariBurnClaimProof` must be constructed off-chain using valid cryptographic data.
   * - If `withdraw_proof` is required by the burn process, it must be included.
   * - This method should be used only when recovering burned confidential resources.
   */
  claimBurn(claim: MinotariBurnClaimProof, output_data: ClaimBurnOutputData): this;

  addInput(inputObject: SubstateRequirement): this;
  addSignatures(signatures: TransactionSignature[]): this;

  /** Adds a raw instruction to the transaction.
   *
   * @param instruction - A fully-formed {@link Instruction} object, such as `CreateAccount`, `CallMethod`, `ClaimBurn`, etc.
   *
   * @returns The current instance of the Builder for method chaining.
   *
   * @remarks
   * This method allows advanced or low-level access to the instruction set used in the Tari transaction engine.
   * It should typically be used when:
   * - A specific instruction is not exposed via a dedicated builder method (e.g. `EmitLog`, `ClaimValidatorFees`)
   * - You need to construct instructions dynamically at runtime (e.g. from config files or user input)
   * - You require more control over optional fields not exposed in convenience methods (e.g. custom `owner_rule`)
   * - You are working with experimental or less-common instructions
   *
   * For common operations like creating accounts or calling methods, prefer high-level builder methods
   * such as `createAccount()` or `callMethod()` for better readability and type safety.
   */
  addInstruction(instruction: Instruction): this;

  addFeeInstruction(instruction: Instruction): this;

  /**
   * Allows for the addition of a condition to the transaction that requires the minimum epoch in which the transaction can be executed. Transaction fails if executed before this epoch.
   * @param minEpoch - The minimum epoch in which the transaction can be executed. If not set, the transaction can be executed in any epoch.
   * @returns The current instance of the Builder, allowing for method chaining.
   */
  withMinEpoch(minEpoch: number): this;

  /**
   * Allows for the addition of a condition to the transaction that requires the maximum epoch in which the transaction can be executed. Transaction fails if executed after this epoch.
   * @param maxEpoch - The maximum epoch in which the transaction can be executed. If not set, the transaction can be executed in any epoch.
   * @returns The current instance of the Builder, allowing for method chaining.
   */
  withMaxEpoch(maxEpoch: number): this;

  /**
   * Adds a substate requirement to the transaction, which is used to specify the inputs required for the transaction.
   * @param inputs - An array of {@link SubstateRequirement} objects that define the inputs required for the transaction, consisting of substate IDs and optional versions. Typically, null version is used to indicate that any version of the substate is acceptable.
   * @returns The current instance of the Builder, allowing for method
   */

  withInputs(inputs: SubstateRequirement[]): this;

  /**
   * Similar to {@link addInstruction}, but allows for adding multiple instructions at once.
   * @param instructions - An array of {@link Instruction} objects to add to the transaction. These instructions will be executed in the order they are added.
   * @returns The current instance of the Builder, allowing for method chaining.
   */

  withInstructions(instructions: Instruction[]): this;

  /**
   * Similar to {@link addFeeInstruction}, but allows for adding multiple fee instructions at once.
   * This is useful for complex transactions that require multiple fee instructions.
   * @param instructions - An array of {@link Instruction} objects to add as fee instructions. These instructions will be executed in the order they are added.
   * @returns The current instance of the Builder, allowing for method chaining.
   */
  withFeeInstructions(instructions: Instruction[]): this;

  withFeeInstructionsBuilder(builder: (builder: TransactionBuilder) => this): this;

  /**
   * Allows for setting an existing unsigned transaction to build upon. This is useful for modifying or extending an existing unsigned transaction.
   * @param unsignedTransaction - An {@link UnsignedTransactionV1} object representing the base transaction to build upon.
   * @returns The current instance of the Builder, allowing for method chaining.
   * @remarks
   * Using withUnsignedTransaction() overwrites the builder’s current unsigned transaction state with the provided one.
   * Useful in cases where the unsigned transaction has been (partially) constructed already.
   */
  withUnsignedTransaction(unsignedTransaction: UnsignedTransactionV1): this;

  /**
   * Adds a method for specifying the component (typically an Account) that pays the transaction fee.
   *
   * @param componentAddress
   * @param maxFee
   * @remarks
   * - The component must have a method `pay_fee` that calls `vault.pay_fee` with enough revealed confidential XTR.
   * - Calls to vault.pay_fee lock up the `maxFee` amount for the duration of the transaction.
   */
  feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: Amount): this;

  /**
   * Similar to {@link feeTransactionPayFromComponent}, but allows for paying the transaction fee using a confidential withdraw proof.
   *
   * @param componentAddress -  The address of the component from which to pay the fee, represented as a 64-character hexadecimal string, optionally prefixed by "component_".
   * @param proof - A {@link ConfidentialWithdrawProof} object containing the necessary cryptographic proofs to authorize the fee payment.
   */
  feeTransactionPayFromComponentConfidential(
    componentAddress: ComponentAddress,
    proof: ConfidentialWithdrawProof,
  ): this;

  buildUnsignedTransaction(): UnsignedTransactionV1;

  build(): Transaction;
}

/**
 * Fluent builder for constructing UnsignedTransactionV1 objects.
 *
 * Only `buildUnsignedTransaction()` is exposed — signing is handled separately
 * via the `Signer` interface and `signTransaction` flow function.
 */
export class TransactionBuilder implements Builder {
  private unsignedTransaction: UnsignedTransactionV1;
  private readonly signatures: TransactionSignature[];
  private allocatedIds: Map<string, number>;
  private currentId: number;

  constructor(network: Network | number) {
    this.unsignedTransaction = {
      network,
      fee_instructions: [],
      instructions: [],
      inputs: [],
      min_epoch: null,
      max_epoch: null,
      dry_run: false,
      is_seal_signer_authorized: false,
    };
    this.signatures = [];
    this.allocatedIds = new Map();
    this.currentId = 0;
  }

  public static new(network: Network | number): TransactionBuilder {
    return new TransactionBuilder(network);
  }

  public addSignatures(signatures: TransactionSignature[]): this {
    this.signatures.push(...signatures);
    return this;
  }
  public callFunction<T extends TariFunctionDefinition>(func: T, args: Exclude<T["args"], undefined>): this {
    const resolvedArgs = this.resolveArgs(args);
    return this.addInstruction({
      CallFunction: {
        address: func.templateAddress,
        function: func.functionName,
        args: resolvedArgs,
      },
    });
  }

  public callMethod<T extends TariMethodDefinition>(method: T, args: Exclude<T["args"], undefined>): this {
    if (!method.componentAddress && !method.fromWorkspace) {
      throw new Error("callMethod requires either componentAddress or fromWorkspace");
    }
    const call = method.componentAddress
      ? { Address: method.componentAddress }
      : { Workspace: this.requireNamedId(method.fromWorkspace) };
    const resolvedArgs = this.resolveArgs(args);
    return this.addInstruction({
      CallMethod: {
        call,
        method: method.methodName,
        args: resolvedArgs,
      },
    });
  }

  public createAccount(ownerPublicKey: Uint8Array, workspaceBucket?: string): this {
    const bucket_workspace_id = workspaceBucket ? this.getOffsetIdFromWorkspaceName(workspaceBucket) : null;
    return this.addInstruction({
      CreateAccount: {
        owner_public_key: toHexStr(ownerPublicKey),
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
        args: [{ Literal: resourceAddress }],
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
  public feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: Amount): this {
    return this.addFeeInstruction({
      CallMethod: {
        call: { Address: componentAddress },
        method: "pay_fee",
        args: [{ Literal: String(maxFee) }],
      },
    });
  }

  /**
   * Like `feeTransactionPayFromComponent` but uses a confidential withdraw proof.
   */
  public feeTransactionPayFromComponentConfidential(
    componentAddress: ComponentAddress,
    proof: ConfidentialWithdrawProof,
  ): this {
    return this.addFeeInstruction({
      CallMethod: {
        call: { Address: componentAddress },
        method: "pay_fee_confidential",
        args: [{ Literal: JSON.stringify(proof) }],
      },
    });
  }

  public dropAllProofsInWorkspace(): this {
    return this.addInstruction("DropAllProofsInWorkspace");
  }

  public addInstruction(instruction: Instruction): this {
    this.unsignedTransaction.instructions.push(instruction);
    return this;
  }

  public addFeeInstruction(instruction: Instruction): this {
    this.unsignedTransaction.fee_instructions.push(instruction);
    return this;
  }

  public withInstructions(instructions: Instruction[]): this {
    this.unsignedTransaction.instructions.push(...instructions);
    return this;
  }

  public withFeeInstructions(instructions: Instruction[]): this {
    this.unsignedTransaction.fee_instructions.push(...instructions);
    return this;
  }

  public withFeeInstructionsBuilder(builder: (b: TransactionBuilder) => TransactionBuilder): this {
    const inner = builder(new TransactionBuilder(this.unsignedTransaction.network));
    this.unsignedTransaction.fee_instructions = inner.unsignedTransaction.instructions;
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

  public withMinEpoch(minEpoch: number): this {
    this.unsignedTransaction.min_epoch = minEpoch;
    return this;
  }

  public withMaxEpoch(maxEpoch: number): this {
    this.unsignedTransaction.max_epoch = maxEpoch;
    return this;
  }

  public withUnsignedTransaction(unsignedTransaction: UnsignedTransactionV1): this {
    this.unsignedTransaction = unsignedTransaction;
    // Reset Workspace State
    this.allocatedIds = new Map();
    this.currentId = 0;
    return this;
  }

  public buildUnsignedTransaction(): UnsignedTransactionV1 {
    return {
      ...this.unsignedTransaction,
      instructions: [...this.unsignedTransaction.instructions],
      fee_instructions: [...this.unsignedTransaction.fee_instructions],
      inputs: [...this.unsignedTransaction.inputs],
    };
  }

  public build(): Transaction {
    return new TransactionRequest(this.buildUnsignedTransaction(), this.signatures);
  }

  // Internal helpers

  private addNamedId(name: string): number {
    const id = this.currentId;
    this.allocatedIds.set(name, id);
    this.currentId += 1;
    return id;
  }

  private getNamedId(name: string): number | undefined {
    return this.allocatedIds.get(name);
  }

  private requireNamedId(name?: string): number {
    if (name === undefined) {
      throw new Error(`Workspace name is required for this operation.`);
    }
    const id = this.allocatedIds.get(name);
    if (id === undefined) {
      throw new Error(`No workspace variable named "${name}" has been defined`);
    }
    return id;
  }

  private getOffsetIdFromWorkspaceName(name: string): WorkspaceOffsetId {
    const parsed = parseWorkspaceStringKey(name);
    const id = this.getNamedId(parsed.name);
    if (id === undefined) {
      throw new Error(`No workspace variable named "${parsed.name}" has been defined`);
    }
    return { id, offset: parsed.offset };
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
