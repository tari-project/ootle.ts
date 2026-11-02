//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Vitest setup: lets fixtures built with `encodeForTest` through the `ootle-wasm-bor` decoders.
// See `./encoded.ts`.

import { vi } from "vitest";

vi.mock("@tari-project/ootle-wasm-bor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tari-project/ootle-wasm-bor")>();
  // Kept in step with `TEST_ENCODING_PREFIX`; a mock factory cannot import local modules.
  const prefix = "test-json:";
  const passThrough =
    (decode: (encoded: string) => string) =>
    (encoded: string): string =>
      encoded.startsWith(prefix) ? encoded.slice(prefix.length) : decode(encoded);
  return {
    ...actual,
    decodeEvent: passThrough(actual.decodeEvent),
    decodeExecuteResult: passThrough(actual.decodeExecuteResult),
    decodeResource: passThrough(actual.decodeResource),
    decodeSubstateValue: passThrough(actual.decodeSubstateValue),
    decodeTransactionReceipt: passThrough(actual.decodeTransactionReceipt),
    decodeUtxo: passThrough(actual.decodeUtxo),
  };
});
