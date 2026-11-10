//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Typed error hierarchy. Every throw site in the SDK uses one of these classes;
// callers can `try/catch` on a structured type rather than parsing message strings.
//
// `OotleError` is `abstract` so callers cannot throw the base directly. The
// runtime `instanceof` check still works for the abstract base — each subclass
// reports its own class name via `this.name = new.target.name`.

import type { RejectReason } from "@tari-project/ootle-ts-bindings";

/** Base class for every exception thrown by the Ootle SDK. */
export abstract class OotleError extends Error {
  static readonly errorName?: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    const target = new.target as typeof OotleError;
    this.name = Object.prototype.hasOwnProperty.call(target, "errorName") && target.errorName
      ? target.errorName
      : new.target.name;
  }
}

/**
 * Raised when the indexer transport fails or returns a non-success response.
 *
 * `status` is the HTTP status if the request reached the indexer (else `undefined`,
 * e.g. a connection-layer failure). `body` is the raw response body when
 * available, and `url` is the request URL. The original transport error chains via
 * `cause`.
 */
export class IndexerClientError extends OotleError {
  static override readonly errorName = "IndexerClientError";
  readonly status?: number;
  readonly body?: string;
  readonly url?: string;

  constructor(message: string, options?: ErrorOptions & { status?: number; body?: string; url?: string }) {
    super(message, options);
    this.status = options?.status;
    this.body = options?.body;
    this.url = options?.url;
  }
}

/**
 * Raised when consensus rejects a transaction.
 *
 * `txId` is the rejected transaction's identifier; `reason` is the human-readable
 * reason (the indexer's `abort_details` string or a `JSON.stringify` of the abort
 * variant when no string was supplied). `rejectReason` is the structured engine
 * reject reason if available — currently optional because the indexer's
 * `Decision.Abort` carries the lighter `AbortReason` shape, not the full
 * `RejectReason`. Callers should branch on `reason` (string) for most cases.
 */
export class TransactionRejectedError extends OotleError {
  static override readonly errorName = "TransactionRejectedError";
  readonly txId: string;
  readonly reason: string;
  readonly rejectReason?: RejectReason;

  constructor(message: string, options: ErrorOptions & { txId: string; reason: string; rejectReason?: RejectReason }) {
    super(message, options);
    this.txId = options.txId;
    this.reason = options.reason;
    this.rejectReason = options.rejectReason;
  }
}

/** Raised when polling / SSE both timed out before the transaction finalized. */
export class TransactionTimeoutError extends OotleError {
  static override readonly errorName = "TransactionTimeoutError";
  readonly txId: string;

  constructor(message: string, options: ErrorOptions & { txId: string }) {
    super(message, options);
    this.txId = options.txId;
  }
}

/** Base class for errors raised by {@link OotleWallet} operations. */
export class WalletError extends OotleError {
  static override readonly errorName: string = "WalletError";
}

/**
 * The wallet has no signer registered for the given address.
 *
 * `address` is intentionally typed as `unknown`: the wallet may register key
 * providers under any keying shape (a `ComponentAddress`, a `ResourceAddress`, …),
 * and the typed error should not pollute the consumer's downstream signature.
 */
export class KeyProviderNotFoundError extends WalletError {
  static override readonly errorName = "KeyProviderNotFoundError";
  readonly address: unknown;

  constructor(message: string, options: ErrorOptions & { address: unknown }) {
    super(message, options);
    this.address = options.address;
  }
}

/** The wallet has no default signer to sign / seal with. */
export class DefaultSignerNotSetError extends WalletError {
  static override readonly errorName = "DefaultSignerNotSetError";
}

/** Raised when a {@link Signer} fails to sign, seal, or expose required material. */
export class SignerError extends OotleError {
  static override readonly errorName = "SignerError";
}

/**
 * Raised when the WASM crypto bridge fails (AEAD decryption, balance-proof
 * verification, scalar parsing, …). `context` is a short label identifying which
 * bridge call failed; the original bridge error chains via `cause`.
 */
export class CryptoBridgeError extends OotleError {
  static override readonly errorName = "CryptoBridgeError";
  readonly context?: string;

  constructor(message: string, options?: ErrorOptions & { context?: string }) {
    super(message, options);
    this.context = options?.context;
  }
}

/** Raised when builder / helper inputs fail TS-side validation or state-machine checks. */
export class InvalidArgumentError extends OotleError {
  static override readonly errorName = "InvalidArgumentError";
}

/** Raised when an in-flight operation was cancelled by the caller. */
export class OperationCancelledError extends OotleError {
  static override readonly errorName = "OperationCancelledError";
}

/**
 * Standard TypeScript exhaustiveness helper. Use at the bottom of a `switch` over
 * a discriminated union (or any branch the type system has narrowed to `never`)
 * to assert at compile-time that every case is handled — and throw at runtime if
 * an unhandled value sneaks past the type checker.
 */
export function assertUnreachable(x: never, hint?: string): never {
  throw new InvalidArgumentError(`assertUnreachable${hint ? ` (${hint})` : ""}: ${JSON.stringify(x)}`);
}
