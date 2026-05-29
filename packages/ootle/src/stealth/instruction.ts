//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// The on-chain stealth instruction shape — encoded in exactly one place.
//
// The instruction is a NATIVE `Instruction::StealthTransfer` variant, NOT a
// `CallMethod`:
//
//   { StealthTransfer: {
//       resource_address_ref: ResourceAddressRef,       // { Address } | { Workspace }
//       statement: StealthTransferStatement,            // { inputs_statement, outputs_statement, balance_proof }
//       revealed_input_bucket: WorkspaceOffsetId | null // the revealed withdraw bucket
//   } }
//
// The statement is embedded as a STRUCTURED OBJECT (verified against the real
// WASM `hashUnsignedTransaction`): the engine deserialises the field as a
// struct, not a string. We parse once from the byte-exact `toCompactJson()`;
// `JSON.parse` is lossless here because every amount in the statement JSON is a
// quoted decimal string (commitments / nonces / range proofs are hex strings).

import type {
  Instruction,
  ResourceAddress,
  StealthTransferStatement as StealthTransferStatementWire,
  WorkspaceOffsetId,
} from "@tari-project/ootle-ts-bindings";
import type { StealthTransferStatement } from "./statements";

/** Workspace var name for the revealed-input bucket consumed by the stealth instruction. */
export const STEALTH_INPUT_BUCKET = "stealth_revealed_input";

/** Workspace var name for the revealed-change bucket the stealth instruction outputs. */
export const STEALTH_REVEALED_CHANGE_BUCKET = "stealth_revealed_change";

/** Inputs to {@link stealthTransferInstruction}. */
export interface StealthTransferInstructionInit {
  /** The resource being transferred. */
  resourceAddress: ResourceAddress;
  /**
   * Workspace var name of the revealed-input bucket (from the `withdraw` + `saveVar`), or
   * `null`/omitted for a stealth-input-only transfer.
   */
  revealedInputBucket: string | null;
  /** The transfer statement (may be incomplete — `balanceProof` undefined — at build time). */
  statement: StealthTransferStatement;
}

/**
 * Encode the native `StealthTransfer` instruction. See the file header for the on-chain
 * contract and the (probe-verified) statement-encoding rationale.
 *
 * The `revealed_input_bucket` references the saved withdraw bucket by name; the builder
 * declared that name via `saveVar`, so the {@link WorkspaceOffsetId} `{ id, offset: null }`
 * is resolved here against the same name → numeric id mapping the builder uses.
 *
 * @param init - The resource, revealed-input bucket name, and statement.
 * @param resolveBucket - Maps a workspace var name to its {@link WorkspaceOffsetId}. The
 *   builder owns the name → id mapping; pass a resolver so this seam stays builder-agnostic.
 */
export function stealthTransferInstruction(
  init: StealthTransferInstructionInit,
  resolveBucket: (name: string) => WorkspaceOffsetId,
): Instruction {
  const revealedInputBucket = init.revealedInputBucket === null ? null : resolveBucket(init.revealedInputBucket);
  return {
    StealthTransfer: {
      resource_address_ref: { Address: init.resourceAddress },
      statement: statementAsWire(init.statement),
      revealed_input_bucket: revealedInputBucket,
    },
  };
}

/**
 * Carry a {@link StealthTransferStatement} into an instruction as the binding's structured
 * `StealthTransferStatement` object.
 *
 * Produces the canonical byte-exact compact JSON via {@link StealthTransferStatement.toCompactJson}
 * (the single canonical encoder) then `JSON.parse`s it ONCE into the struct the engine
 * deserialises. This is the SINGLE encoding seam — see the file header for the probe
 * evidence (a string-typed statement is rejected by the engine) and why the parse is
 * lossless (all amounts are quoted strings).
 */
export function statementAsWire(statement: StealthTransferStatement): StealthTransferStatementWire {
  return JSON.parse(statement.toCompactJson()) as StealthTransferStatementWire;
}

/** The narrowed shape of the native `StealthTransfer` instruction variant. */
export type StealthTransferInstruction = Extract<Instruction, { StealthTransfer: unknown }>;

/**
 * Type guard for the native `StealthTransfer` {@link Instruction} variant. Used by the
 * authorizer to locate the single stealth instruction it must patch.
 */
export function isStealthTransferInstruction(instruction: Instruction): instruction is StealthTransferInstruction {
  return typeof instruction === "object" && instruction !== null && "StealthTransfer" in instruction;
}
