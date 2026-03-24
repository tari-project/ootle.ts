import { useState, useCallback } from "react";
import {
  WalletDaemonSigner,
  type WalletDaemonSignerOptions,
  type AuthOptions,
} from "@tari-project/ootle-wallet-daemon-signer";

export type WalletStatus = "disconnected" | "connecting" | "connected";

export interface WalletState {
  status: WalletStatus;
  signer: WalletDaemonSigner | null;
  address: string | null;
  publicKey: string | null;
  error: string | null;
}

export type ConnectOptions = WalletDaemonSignerOptions & AuthOptions;

export interface UseWalletDaemon extends WalletState {
  connect: (options: ConnectOptions) => Promise<void>;
  disconnect: () => void;
}

const INITIAL: WalletState = {
  status: "disconnected",
  signer: null,
  address: null,
  publicKey: null,
  error: null,
};

/**
 * Manages a connection to a Tari Wallet Daemon.
 *
 * The wallet daemon holds the user's secret key and returns the account
 * address + public key on connect. The key never touches JavaScript memory.
 *
 * Authentication is handled automatically — if the daemon requires WebAuthn,
 * the browser's passkey flow is triggered during `connect()`.
 *
 * Usage:
 *   const { status, address, connect, disconnect } = useWalletDaemon()
 *   await connect({ url: "http://localhost:5100/json_rpc" })
 */
export function useWalletDaemon(): UseWalletDaemon {
  const [state, setState] = useState<WalletState>(INITIAL);

  const connect = useCallback(async (options: ConnectOptions) => {
    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const signer = await WalletDaemonSigner.connect(options);
      const [address, publicKeyBytes] = await Promise.all([signer.getAddress(), signer.getPublicKey()]);
      const publicKey = Array.from(publicKeyBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      setState({ status: "connected", signer, address, publicKey, error: null });
    } catch (err) {
      console.debug(`err =`, err);
      const message = err instanceof Error ? err.message : "Connection failed";
      setState({ ...INITIAL, error: message });
    }
  }, []);

  const disconnect = useCallback(() => {
    setState(INITIAL);
  }, []);

  return { ...state, connect, disconnect };
}
