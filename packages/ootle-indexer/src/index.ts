//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

export { IndexerProvider } from "./indexer-provider";
export type { IndexerProviderOptions } from "./indexer-provider";

// Re-export from @tari-project/indexer-client so consumers don't need a direct dependency
export { IndexerClient, transports } from "@tari-project/indexer-client";
// Re-export from @tari-project/ootle-ts-binds so consumers don't need a direct dependency
export type {
  TransactionEntry,
  TemplateMetadata,
  GetTemplateDefinitionResponse,
  TemplateDef,
  FunctionDef,
} from "@tari-project/ootle-ts-bindings";

export { ProviderBuilder } from "./provider-builder";
export { resolveWantInputs } from "./want-input";
export type { WantInput } from "./want-input";
export { TransactionWatcher, PendingTransaction } from "./tx-watcher";
export { parseSseChunk } from "./event-stream";
export type { IndexerSseEvent } from "./event-stream";
