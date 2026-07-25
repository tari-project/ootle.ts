//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { microTariString } from "../helpers/amount";
import { assertByteLength } from "../helpers/bytes";
import { fromHexStr, toHexStr } from "../helpers/hex";
import { InvalidArgumentError } from "../errors";
import { Bytes32, SCALAR_LENGTH } from "./primitives";

/**
 * Parse a decimal µTari amount string to `bigint`, rejecting empty/whitespace input.
 *
 * `BigInt("")` and `BigInt("   ")` both return `0n` silently — a footgun for amounts
 * decoded off the wire. Guard so a malformed amount throws instead of being read as
 * zero (which would corrupt balance checks on-chain).
 */
function decodeAmount(value: string, field: string): bigint {
  if (value.trim() === "") {
    throw new InvalidArgumentError(`${field} must be a non-empty decimal string`);
  }
  return BigInt(value);
}

/**
 * Assert that a JSON fragment string is shaped like a JSON object (starts with `{`,
 * ends with `}`). The fragments concatenated into the signed wire form must each be
 * a JSON object — otherwise the resulting envelope is silently malformed.
 *
 * We don't `JSON.parse` here: u64 µTari amounts can exceed `Number.MAX_SAFE_INTEGER`
 * and a parse → number → re-stringify round-trip would silently corrupt them.
 */
function assertJsonObject(fragment: string, field: string): void {
  const trimmed = fragment.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new InvalidArgumentError(
      `StealthTransferStatement.toCompactJson: ${field} fragment is not a JSON object ` +
        `(got: ${fragment.slice(0, 60)}...)`,
    );
  }
}

// JSON wire shapes. Component statement JSONs are produced by WASM and
// carried opaquely; only the TS-assembled envelope and leaf types have
// hand-defined wire shapes.

/** Wire shape of a {@link StealthInput}. */
export interface StealthInputJson {
  commitment: string;
}

/** Wire shape of a {@link BalanceProofSignature}. */
export interface BalanceProofSignatureJson {
  public_nonce: string;
  signature: string;
}

/**
 * A stealth input being spent, identified by its 32-byte Pedersen commitment.
 */
export class StealthInput extends Bytes32 {
  public constructor(commitment: Uint8Array) {
    super(commitment, "StealthInput.commitment");
  }

  /** 32-byte commitment (defensive copy). */
  public get commitment(): Uint8Array {
    return this.toBytes();
  }

  public toJSON(): StealthInputJson {
    return { commitment: this.toHex() };
  }

  public static fromJSON(json: StealthInputJson): StealthInput {
    return new StealthInput(fromHexStr(json.commitment));
  }
}

/**
 * The balance-proof Schnorr signature `(public_nonce, signature)`. For a
 * fully-revealed transfer this pair is normally omitted on the envelope.
 */
export class BalanceProofSignature {
  private readonly _publicNonce: Uint8Array;
  private readonly _signature: Uint8Array;

  public constructor(publicNonce: Uint8Array, signature: Uint8Array) {
    this._publicNonce = new Uint8Array(
      assertByteLength(publicNonce, SCALAR_LENGTH, "BalanceProofSignature.publicNonce"),
    );
    this._signature = new Uint8Array(assertByteLength(signature, SCALAR_LENGTH, "BalanceProofSignature.signature"));
  }

  /** 32-byte public nonce (defensive copy). */
  public get publicNonce(): Uint8Array {
    return new Uint8Array(this._publicNonce);
  }

  /** 32-byte signature scalar (defensive copy). */
  public get signature(): Uint8Array {
    return new Uint8Array(this._signature);
  }

  public toJSON(): BalanceProofSignatureJson {
    return {
      public_nonce: toHexStr(this._publicNonce),
      signature: toHexStr(this._signature),
    };
  }

  public static fromJSON(json: BalanceProofSignatureJson): BalanceProofSignature {
    return new BalanceProofSignature(fromHexStr(json.public_nonce), fromHexStr(json.signature));
  }
}


/**
 * The inputs side of a stealth transfer: the commitments being spent plus the
 * revealed (un-confidential) input amount.
 *
 * **The signed/wire JSON is produced by WASM**, not hand-rolled. This type
 * carries `(inputs, revealedAmount)` plus an optional cached `statementJson`
 * (the WASM-produced wire string). Its `toJSON()` is a **debug/structural**
 * view only — it is NOT the signed wire payload; the crypto seam fills and
 * reads `statementJson` for that.
 */
export class StealthInputsStatement {
  public readonly inputs: StealthInput[];
  public readonly revealedAmount: bigint;
  /** Cached WASM-produced wire JSON (the canonical signed payload), once computed. */
  public statementJson?: string;

  public constructor(inputs: StealthInput[], revealedAmount: bigint, statementJson?: string) {
    this.inputs = inputs;
    this.revealedAmount = revealedAmount;
    this.statementJson = statementJson;
  }

  /** Revealed-only inputs statement (no confidential inputs). */
  public static revealedOnly(amount: bigint): StealthInputsStatement {
    return new StealthInputsStatement([], amount);
  }

  /**
   * Structural view (NOT the signed wire payload — see class docs). Amounts are
   * decimal strings to keep `bigint` out of JSON.
   */
  public toJSON(): { inputs: StealthInputJson[]; revealed_amount: string } {
    return {
      inputs: this.inputs.map((i) => i.toJSON()),
      revealed_amount: microTariString(this.revealedAmount),
    };
  }

  public static fromJSON(json: { inputs: StealthInputJson[]; revealed_amount: string }): StealthInputsStatement {
    return new StealthInputsStatement(
      json.inputs.map(StealthInput.fromJSON),
      decodeAmount(json.revealed_amount, "revealed_amount"),
    );
  }
}

/**
 * The outputs side of a stealth transfer.
 *
 * Carries the **WASM-produced** wire payload verbatim. The internal field
 * names of that JSON are owned by the engine and are not modelled here.
 */
export class StealthOutputsStatement {
  /** The canonical, WASM-produced outputs-statement wire JSON. */
  public readonly statementJson: string;

  public constructor(statementJson: string) {
    this.statementJson = statementJson;
  }

  /** Parse the carried JSON into a plain object view (the engine owns the shape). */
  public parsed(): unknown {
    return JSON.parse(this.statementJson);
  }

  /** The carried wire JSON string is already canonical. */
  public toJSON(): string {
    return this.statementJson;
  }

  /** Reconstruct from a wire JSON string. */
  public static fromJSON(statementJson: string): StealthOutputsStatement {
    return new StealthOutputsStatement(statementJson);
  }
}

/**
 * Structural wire shape of a {@link StealthTransferStatement} envelope.
 *
 * This is the **debug / round-trip** shape produced by `toJSON()` and consumed by
 * `fromJSON()` — it is symmetric and lossless for a TS-only envelope. It is **NOT**
 * the signed wire form: see {@link StealthTransferStatement.toCompactJson}.
 *
 * - `inputs` is the structural inputs-statement view (`{ inputs, revealed_amount }`).
 * - `outputs` is the **raw `StealthOutputsStatement` wire string** (carried verbatim),
 *   never a parsed object — parsing-then-restringifying WASM u64 amounts is lossy.
 */
export interface StealthTransferStatementJson {
  inputs: { inputs: StealthInputJson[]; revealed_amount: string };
  outputs: string;
  balance_proof?: BalanceProofSignatureJson;
}

/**
 * The top-level stealth-transfer envelope assembled **in TS**.
 *
 * Combines the WASM-produced inputs/outputs statement JSONs with the balance-proof
 * `(public_nonce, signature)`. `balanceProof` is `undefined` until the authorizer
 * fills it in.
 *
 * Two distinct serialisations, intentionally separate:
 *
 * 1. **{@link toJSON} / {@link fromJSON}** — a purely *structural*, symmetric,
 *    lossless round-trip used by tests and any TS-only persistence. It does NOT
 *    re-parse WASM statement strings into JS numbers; the outputs side is carried as
 *    its raw wire string.
 * 2. **{@link toCompactJson}** — the *signed wire form*. It embeds the
 *    WASM-produced statement strings **byte-exact** by string concatenation of raw
 *    canonical fragments — it **never** `JSON.parse`s a WASM string (raw u64 µTari
 *    amounts routinely exceed 2^53, so parse→number→re-stringify silently corrupts
 *    them and breaks the signature). This is the form fed to
 *    `validateStealthTransfer` and any hashing/signing path.
 *
 * The **byte-exactness of the WASM fragments** in {@link toCompactJson} is
 * non-negotiable: the engine validates against the exact bytes signed.
 */
export class StealthTransferStatement {
  public readonly inputsStatement: StealthInputsStatement;
  public readonly outputsStatement: StealthOutputsStatement;
  public balanceProof?: BalanceProofSignature;

  public constructor(
    inputsStatement: StealthInputsStatement,
    outputsStatement: StealthOutputsStatement,
    balanceProof?: BalanceProofSignature,
  ) {
    this.inputsStatement = inputsStatement;
    this.outputsStatement = outputsStatement;
    this.balanceProof = balanceProof;
  }

  /**
   * Structural view of the envelope (debug / lossless round-trip — NOT the signed
   * wire form; see {@link toCompactJson}). The inputs side is the inputs statement's
   * structural `toJSON()`; the outputs side is its **raw wire string**, carried
   * verbatim (never parsed). `balance_proof` is omitted when undefined.
   */
  public toJSON(): StealthTransferStatementJson {
    const json: StealthTransferStatementJson = {
      inputs: this.inputsStatement.toJSON(),
      outputs: this.outputsStatement.toJSON(),
    };
    if (this.balanceProof !== undefined) {
      json.balance_proof = this.balanceProof.toJSON();
    }
    return json;
  }

  /**
   * The **signed wire form**: a single canonical compact JSON string in which the
   * WASM-produced statement fragments are embedded byte-exact.
   *
   * Built by concatenating raw canonical fragments — it never `JSON.parse`s a WASM
   * statement string, so raw u64 µTari amounts (which can exceed 2^53) survive
   * uncorrupted. The inputs fragment prefers the cached WASM `statementJson` (the
   * canonical signed bytes); it falls back to `JSON.stringify` of the structural
   * inputs view only when no WASM string is present (the revealed-only / test case).
   * The outputs fragment is always the raw WASM `statementJson` string. The
   * balance-proof object is small, all-hex (no large integers), so it routes through
   * `JSON.stringify` safely.
   *
   * @throws {InvalidArgumentError} if either statement fragment is not a JSON object.
   */
  public toCompactJson(): string {
    const inputsFragment = this.inputsStatement.statementJson ?? JSON.stringify(this.inputsStatement.toJSON());
    const outputsFragment = this.outputsStatement.statementJson; // raw WASM canonical string, carried verbatim
    assertJsonObject(inputsFragment, "inputs_statement");
    assertJsonObject(outputsFragment, "outputs_statement");
    // Top-level keys are `inputs_statement` / `outputs_statement` / `balance_proof` /
    // `covenant_claims`, verified against the ootle-wasm@0.32 engine: `validateStealthTransfer`
    // rejects an envelope keyed `inputs`/`outputs` with "missing field `inputs_statement`". (The
    // structural debug `toJSON()` keeps the shorter `inputs`/`outputs` keys — it is not
    // the signed wire form.)
    //
    // `covenant_claims` (TIP-0006, added to the protocol's `StealthTransferStatement` struct
    // after this SDK's own snapshot) is a required field on the current wire struct -- omitting
    // it entirely, as this used to, makes the WHOLE transaction fail server-side deserialization
    // with a generic "did not match any variant of untagged enum TransactionInput" (the missing-
    // field error on this deeply-nested struct isn't surfaced directly; it just fails every
    // variant of the untagged wrapper enum). This builder never spends an input gated by a
    // `Script` spend condition, so an empty array is always the correct value here — see
    // tari-project/tari-ootle PR #2260's own description: "only the engine test tooling sets"
    // a Script condition today, wallet/SDK population of claims is explicitly out of scope there.
    let s = `{"inputs_statement":${inputsFragment},"outputs_statement":${outputsFragment},"covenant_claims":[]`;
    if (this.balanceProof !== undefined) {
      s += `,"balance_proof":${JSON.stringify(this.balanceProof.toJSON())}`;
    }
    return s + "}";
  }

  /** Reconstruct from the structural {@link toJSON} shape. Symmetric and lossless. */
  public static fromJSON(json: StealthTransferStatementJson): StealthTransferStatement {
    const inputsStatement = StealthInputsStatement.fromJSON(json.inputs);
    const outputsStatement = StealthOutputsStatement.fromJSON(json.outputs);
    const balanceProof =
      json.balance_proof !== undefined ? BalanceProofSignature.fromJSON(json.balance_proof) : undefined;
    return new StealthTransferStatement(inputsStatement, outputsStatement, balanceProof);
  }
}
