//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Mirrors the helpers of the same name in `@tari-project/ootle-ts-bindings`. They are defined here, not
// re-exported, because the bindings package is not loadable as a Node ES module (no `"type": "module"`,
// extensionless re-exports), so a runtime import of it breaks every Node consumer of this package.

/** A transaction enum value: one key naming its schema (`V1`, `V2`, ...), all sharing one body type. */
type SchemaVersioned<B> = { V1: B } | { V2: B };

/**
 * The body of a schema-versioned transaction value (`Transaction`, `UnsignedTransaction`,
 * `UnsealedTransaction` or `PrunedTransaction`), whatever its schema.
 */
export function transactionBody<B>(transaction: SchemaVersioned<B>): B;
export function transactionBody<B>(transaction: SchemaVersioned<B> | null | undefined): B | undefined;
export function transactionBody<B>(transaction: SchemaVersioned<B> | null | undefined): B | undefined {
  if (!transaction) {
    return undefined;
  }
  return "V2" in transaction ? transaction.V2 : transaction.V1;
}

/** The schema version of a schema-versioned transaction value. */
export function transactionSchemaVersion(transaction: SchemaVersioned<unknown>): number {
  return "V2" in transaction ? 2 : 1;
}
