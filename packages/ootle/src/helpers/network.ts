//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { Network } from "../network";
import { InvalidArgumentError } from "../errors";

const DEFAULT_INDEXER_URLS: Partial<Record<Network, string>> = {
  [Network.LocalNet]: "http://localhost:12500",
  [Network.Esmeralda]: "https://ootle-indexer-a.tari.com",
};

/**
 * Returns a known default indexer URL for the given network.
 * Mirrors `default_indexer_url()` from the Rust ootle-rs crate.
 *
 * @throws {InvalidArgumentError} for networks where no default URL is configured.
 */
export function defaultIndexerUrl(network: Network): string {
  const url = DEFAULT_INDEXER_URLS[network];
  if (url !== undefined) return url;
  throw new InvalidArgumentError(
    `No default indexer URL is configured for ${Network[network]}. ` +
      `Pass an explicit URL via ProviderBuilder.withUrl(...) or ` +
      `IndexerProvider.connect({ url, network: Network.${Network[network]} }).`,
  );
}
