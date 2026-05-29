//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { useState } from "react";
import type { UseIndexer } from "../hooks/useIndexer";
import { DEFAULT_INDEXER_URL } from "../hooks/useIndexer";
import type { UseStealthWallet } from "../hooks/useStealthWallet";
import { Field } from "./Field";
import { StatusBadge } from "./StatusBadge";

export interface SetupCardProps {
  wallet: UseStealthWallet;
  indexer: UseIndexer;
  onConnect: (url: string) => void;
  onReset: () => void;
  viewSecretHex: string | null;
}

export function SetupCard({ wallet, indexer, onConnect, onReset, viewSecretHex }: SetupCardProps) {
  const [url, setUrl] = useState(DEFAULT_INDEXER_URL);
  const ready = wallet.status === "ready" && indexer.status === "connected";

  return (
    <section className="card">
      <header className="card-header">
        <h2>1. Setup</h2>
        <StatusBadge
          color={ready ? "success" : "muted"}
          label={ready ? "Ready" : indexer.status === "connecting" ? "Connecting…" : "Not connected"}
        />
      </header>

      <p className="card-subtitle">
        Generate a fresh stealth-ready wallet and point it at a LocalNet indexer. The secret key is held in browser
        memory and discarded on refresh.
      </p>

      <div className="prereqs">
        <p className="prereqs-title">Demo only</p>
        <p className="prereqs-text">
          Never use this with real funds. The secret key lives in JS memory for the lifetime of this page.
        </p>
      </div>

      <div className="form">
        <label className="field-label" htmlFor="indexer-url">
          Indexer URL
        </label>
        <input
          id="indexer-url"
          className="input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          disabled={indexer.status === "connecting"}
        />
        <div className="button-row">
          <button
            className="btn-primary"
            onClick={() => onConnect(url)}
            disabled={indexer.status === "connecting" || !url.trim()}
          >
            {indexer.status === "connecting" ? "Connecting…" : indexer.status === "connected" ? "Reconnect" : "Connect"}
          </button>
          {wallet.status === "uninitialized" ? (
            <button className="btn-secondary" onClick={wallet.create}>
              Create wallet
            </button>
          ) : (
            <button className="btn-ghost" onClick={onReset}>
              Reset session
            </button>
          )}
        </div>
        {indexer.error && (
          <p className="error-banner" role="alert">
            {indexer.error}
          </p>
        )}
        {wallet.error && (
          <p className="error-banner" role="alert">
            {wallet.error}
          </p>
        )}
      </div>

      {wallet.identity !== null && (
        <div className="fields">
          <Field label="Owner address" value={wallet.identity.ownerAddress} mono />
          {viewSecretHex !== null && <Field label="View secret (hex)" value={viewSecretHex} mono />}
        </div>
      )}
    </section>
  );
}
