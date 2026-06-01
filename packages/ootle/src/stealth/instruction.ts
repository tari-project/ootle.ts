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
// struct, not a string. Its u64 amounts are BARE JSON numbers that routinely
// exceed 2^53, so `JSON.parse`ing the byte-exact `toCompactJson()` would round
// them and break the signed proofs. We therefore carry the statement as a raw
// JSON fragment ({@link RawJsonFragment}) and let {@link serializeUnsignedTx}
// splice it into the serialized transaction verbatim — never round-tripping it
// through a JS number.

import type {
  Instruction,
  ResourceAddress,
  StealthTransferStatement as StealthTransferStatementWire,
  WorkspaceOffsetId,
} from "@tari-project/ootle-ts-bindings";
import type { StealthTransferStatement } from "./statements";

/**
 * Marker key carrying a pre-encoded, byte-exact JSON fragment that must be spliced
 * verbatim into the serialized transaction (never `JSON.parse`-d). See
 * {@link serializeUnsignedTx}.
 */
export const RAW_JSON_FRAGMENT = "__ootleRawJson";

/** A carrier object holding a byte-exact JSON fragment under {@link RAW_JSON_FRAGMENT}. */
export interface RawJsonFragment {
  [RAW_JSON_FRAGMENT]: string;
}

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
 * Carry a {@link StealthTransferStatement} into an instruction as a byte-exact raw JSON
 * fragment.
 *
 * The statement's u64 amounts are bare JSON numbers that routinely exceed 2^53; `JSON.parse`
 * would round them and break the signed proofs. We therefore embed the canonical
 * {@link StealthTransferStatement.toCompactJson} string verbatim under {@link RAW_JSON_FRAGMENT}
 * and let {@link serializeUnsignedTx} splice it into the serialized transaction at signing /
 * sealing / hashing time — never round-tripping it through a JS number. The engine still
 * deserialises `statement` as a struct (not a string); the splice produces exactly that.
 *
 * Nothing reads the statement object structurally after it is set (the serializers stringify
 * it wholesale and {@link patchStealthStatement} replaces the whole field), so the documented
 * cast to the binding's structured type is sound.
 */
export function statementAsWire(statement: StealthTransferStatement): StealthTransferStatementWire {
  return { [RAW_JSON_FRAGMENT]: statement.toCompactJson() } as unknown as StealthTransferStatementWire;
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
