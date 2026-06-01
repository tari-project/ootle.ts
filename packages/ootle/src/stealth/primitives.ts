//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ResourceAddress } from "@tari-project/ootle-ts-bindings";
import { assertByteLength } from "../helpers/bytes";
import { fromHexStr, toHexStr } from "../helpers/hex";
import { InvalidArgumentError } from "../errors";

/** Length, in bytes, of a raw scalar / commitment / nonce on the Ootle curve. */
export const SCALAR_LENGTH = 32;

/**
 * Internal base for 32-byte stealth-domain carriers (`Mask`, `StealthInput`).
 * Asserts the 32-byte length at construction and defensively copies on the way
 * in; subclasses inherit `toBytes()` / `toHex()` which return fresh copies.
 *
 * Exported for cross-file extension by `StealthInput` in `./statements`; not
 * part of the public package surface (not re-exported from `./types`).
 */
export abstract class Bytes32 {
  private readonly bytes: Uint8Array;

  protected constructor(bytes: Uint8Array, fieldName: string) {
    this.bytes = new Uint8Array(assertByteLength(bytes, SCALAR_LENGTH, fieldName));
  }

  public toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  public toHex(): string {
    return toHexStr(this.bytes);
  }
}

/**
 * A 32-byte blinding factor (Pedersen-commitment mask).
 *
 * Use {@link Mask.zero} for the faucet / revealed-only path (an all-zero scalar).
 */
export class Mask extends Bytes32 {
  public constructor(bytes: Uint8Array) {
    super(bytes, "Mask");
  }

  /** All-zero 32-byte mask, for the faucet / revealed-only path. */
  public static zero(): Mask {
    return new Mask(new Uint8Array(SCALAR_LENGTH));
  }

  /** Wrap raw 32 bytes into a `Mask` (validates length, defensive copy in the ctor). */
  public static fromBytes(bytes: Uint8Array): Mask {
    return new Mask(bytes);
  }

  /** Parse a 64-char hex string into a `Mask` (validates length). */
  public static fromHex(hex: string): Mask {
    return new Mask(fromHexStr(hex));
  }
}

/**
 * Opaque carrier for an output's ciphertext bytes (the AEAD-encrypted value/mask/memo
 * payload). Treated as opaque here: the stealth module never inspects the plaintext
 * structure, only carries the bytes across the JSON boundary.
 */
export class EncryptedData {
  private readonly bytes: Uint8Array;

  public constructor(bytes: Uint8Array) {
    this.bytes = new Uint8Array(bytes);
  }

  /** Parse a hex string into `EncryptedData` (variable length). */
  public static fromHex(hex: string): EncryptedData {
    return new EncryptedData(fromHexStr(hex));
  }

  /** Raw ciphertext bytes (defensive copy). */
  public toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  /** Hex encoding. */
  public toHex(): string {
    return toHexStr(this.bytes);
  }
}

/**
 * The result of decrypting an owned output via the AEAD path (`unblindOutput`).
 *
 * Maps from the WASM `DecryptedOutputResult { mask: Uint8Array, value: bigint,
 * memo_json: string | undefined }`. Per the verified 0.32 ABI, `memo` is the
 * **JSON-encoded `Memo` string** (`U256` / `Message` / `Bytes` / `PayRefAndBytes`),
 * not raw bytes — callers parse it if needed.
 */
export interface DecryptedData {
  /** Recovered output blinding factor. */
  mask: Mask;
  /** Recovered µTari amount. */
  value: bigint;
  /** The JSON-encoded `Memo` string, if present. */
  memo?: string;
}

/**
 * Default `payTo` for a stealth output: a one-time stealth spend public key.
 *
 * Frozen at runtime (and its nested object): every default output shares this single
 * reference, so `Readonly<>` — a compile-time-only annotation — is not enough. The freeze
 * makes an accidental mutation throw (strict mode) instead of silently corrupting the spend
 * condition of every other default output in the process.
 */
export const DEFAULT_PAY_TO: Readonly<Record<string, unknown>> = Object.freeze({
  StealthPublicKey: Object.freeze({}),
});

/**
 * A stealth output to create.
 *
 * Use {@link createOutput} to construct one with the conventional defaults
 * (`payTo = { StealthPublicKey: {} }`, `minimumValuePromise = 0n`) and
 * validation (rejects `amount <= 0n`).
 */
export interface Output {
  /** Destination account address (a string component/account address). */
  destination: string;
  /** µTari amount to send (must be `> 0n`). */
  amount: bigint;
  /** Resource being transferred. */
  resourceAddress: ResourceAddress;
  /** Resource view key — set only for resources with a viewable balance. */
  resourceViewKey?: Uint8Array;
  /** Optional structured memo attached to the output. */
  memo?: object;
  /** Spend condition for the output; defaults to `{ StealthPublicKey: {} }`. */
  payTo: object;
  /** Minimum value promise (range-proof lower bound); defaults to `0n`. */
  minimumValuePromise: bigint;
}

/** Fields callers supply to {@link createOutput}; `payTo` and `minimumValuePromise` are defaulted. */
export interface OutputInit {
  destination: string;
  amount: bigint;
  resourceAddress: ResourceAddress;
  resourceViewKey?: Uint8Array;
  memo?: object;
  payTo?: object;
  minimumValuePromise?: bigint;
}

/**
 * Construct an {@link Output}, applying the conventional defaults and validating
 * the amount.
 *
 * @throws {InvalidArgumentError} if `amount <= 0n`.
 */
export function createOutput(init: OutputInit): Output {
  if (init.amount <= 0n) {
    throw new InvalidArgumentError(`Output amount must be > 0, got ${init.amount}`);
  }
  return {
    destination: init.destination,
    amount: init.amount,
    resourceAddress: init.resourceAddress,
    // Defensively copy the view key (when present) so a caller mutating the source
    // array can't alter the stored output key — matching Mask/EncryptedData/StealthInput.
    resourceViewKey: init.resourceViewKey !== undefined ? new Uint8Array(init.resourceViewKey) : undefined,
    memo: init.memo,
    payTo: init.payTo ?? DEFAULT_PAY_TO,
    minimumValuePromise: init.minimumValuePromise ?? 0n,
  };
}
