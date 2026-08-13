//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

export { IndexerProvider } from "./indexer-provider";
export type { IndexerProviderOptions } from "./indexer-provider";

// Re-export from @tari-project/indexer-client so consumers don't need a direct dependency
export { IndexerClient, transports } from "@tari-project/indexer-client";
// Re-export from @tari-project/ootle-ts-binds so consumers don't need a direct dependency.
//
// `TemplateMeta` (not `TemplateMetadata`) is the indexer template-list entry — the
// `{ name, address, binary_sha, code_size, epoch, ... }` shape returned by
// `templatesListCached`. Bindings 1.47 renamed that struct and gave the freed-up
// `TemplateMetadata` name to an unrelated off-chain *author* metadata struct with no
// `address`, so re-exporting the old name here would silently hand consumers the wrong
// type. Import `TemplateMetadata` straight from the bindings if you want author metadata.
export type { TransactionEntry, TemplateMeta, ListTemplatesResponse } from "@tari-project/ootle-ts-bindings";

export { ProviderBuilder } from "./provider-builder";
export { resolveWantInputs } from "./want-input";
export type { WantInput } from "./want-input";
export { TransactionWatcher, PendingTransaction } from "./tx-watcher";
export { openEventStream, parseSseChunk } from "./event-stream";
export type { IndexerSseEvent } from "./event-stream";
