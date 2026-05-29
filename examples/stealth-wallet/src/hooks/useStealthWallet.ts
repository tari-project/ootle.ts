//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { useCallback, useState } from "react";
import { createIdentity } from "../lib/identity";
import type { StealthIdentity } from "../lib/stealth";

export type WalletStatus = "uninitialized" | "ready";

export interface WalletState {
  status: WalletStatus;
  identity: StealthIdentity | null;
  error: string | null;
}

export interface UseStealthWallet extends WalletState {
  /** Generate a fresh `SecretKeyWallet.randomWithViewKey(...)` identity. */
  create: () => void;
  /** Discard the in-memory keys. */
  reset: () => void;
}

const INITIAL: WalletState = {
  status: "uninitialized",
  identity: null,
  error: null,
};

/**
 * Wraps the in-memory stealth identity (owner + view keypair, `SecretKeyWallet`,
 * `OotleWallet`). Mirrors the `useWalletDaemon` shape in `connect-button` but
 * is synchronous — the keys live in this React tree and are discarded on
 * reset or page refresh.
 *
 * Demo only: never deploy this pattern with real funds; the secret key sits
 * in JS memory for the lifetime of the page.
 */
export function useStealthWallet(): UseStealthWallet {
  const [state, setState] = useState<WalletState>(INITIAL);

  const create = useCallback(() => {
    try {
      const identity = createIdentity();
      setState({ status: "ready", identity, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create wallet";
      setState({ ...INITIAL, error: message });
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  return { ...state, create, reset };
}
