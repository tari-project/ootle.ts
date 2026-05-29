//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { useCallback, useEffect, useState } from "react";
import { defaultIndexerUrl } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import { NETWORK } from "@tari-project/example-common";

export type IndexerStatus = "disconnected" | "connecting" | "connected";

export interface IndexerState {
  status: IndexerStatus;
  provider: IndexerProvider | null;
  url: string;
  error: string | null;
}

export interface UseIndexer extends IndexerState {
  connect: (url: string) => Promise<void>;
  disconnect: () => void;
}

export const DEFAULT_INDEXER_URL = defaultIndexerUrl(NETWORK);

const INITIAL: IndexerState = {
  status: "disconnected",
  provider: null,
  url: DEFAULT_INDEXER_URL,
  error: null,
};

/**
 * Manages the read-write IndexerProvider connection. Mirrors the URL-input
 * pattern in `connect-button`'s `useWalletDaemon` but for an `IndexerProvider`
 * (no auth — just construct + ping).
 */
export function useIndexer(): UseIndexer {
  const [state, setState] = useState<IndexerState>(INITIAL);

  const connect = useCallback(async (url: string) => {
    setState((s) => ({ ...s, status: "connecting", url, error: null }));
    try {
      const provider = await IndexerProvider.connect({ url, network: NETWORK });
      setState({ status: "connected", provider, url, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect to indexer";
      setState({ ...INITIAL, url, error: message });
    }
  }, []);

  const disconnect = useCallback(() => {
    state.provider?.stopWatcher();
    setState((s) => ({ ...INITIAL, url: s.url }));
  }, [state.provider]);

  // Stop the SSE watcher if the component unmounts (page navigation, hot reload).
  useEffect(() => {
    const provider = state.provider;
    if (provider === null) return;
    return () => {
      provider.stopWatcher();
    };
  }, [state.provider]);

  return { ...state, connect, disconnect };
}
