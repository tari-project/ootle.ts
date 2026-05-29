//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ScannedUtxo } from "../hooks/useStealthOps";
import { formatTari, truncate } from "../lib/format";

export interface ReceiveCardProps {
  canFaucet: boolean;
  canScan: boolean;
  loading: boolean;
  scanning: boolean;
  onFaucet: () => void;
  onScan: () => void;
  utxos: ScannedUtxo[] | null;
  message: string | null;
  error: string | null;
  scanError: string | null;
}

export function ReceiveCard({
  canFaucet,
  canScan,
  loading,
  scanning,
  onFaucet,
  onScan,
  utxos,
  message,
  error,
  scanError,
}: ReceiveCardProps) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>2. Receive</h2>
      </header>

      <p className="card-subtitle">
        Click <em>Faucet stealth deposit</em> to mint a confidential 2 TARI UTXO to your own address. The view secret
        decrypts the produced UTXO to prove ownership without scanning the chain for a balance.
      </p>

      <div className="button-row">
        <button className="btn-primary" onClick={onFaucet} disabled={!canFaucet}>
          {loading ? "Depositing…" : "Faucet stealth deposit (2 TARI)"}
        </button>
        <button className="btn-secondary" onClick={onScan} disabled={!canScan}>
          {scanning ? "Scanning…" : "Re-scan owned"}
        </button>
      </div>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {scanError && (
        <p className="error-banner" role="alert">
          {scanError}
        </p>
      )}
      {message !== null && <p className="success-banner">{message}</p>}

      {utxos !== null && utxos.length > 0 && (
        <div className="utxo-list">
          {utxos.map((u) => (
            <div key={u.substateId} className={`utxo ${u.value === null ? "utxo-unowned" : ""}`}>
              <span className="mono utxo-id" title={u.substateId}>
                {truncate(u.substateId, 14, 10)}
              </span>
              <span className="utxo-value">{u.value === null ? "not owned" : formatTari(u.value)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
