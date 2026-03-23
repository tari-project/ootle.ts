import { useCallback, useEffect, useState } from "react";
import { Network, defaultIndexerUrl } from "@tari-project/ootle";
import type { TransactionEntry } from "@tari-project/ootle-indexer";
import { useIndexer } from "./hooks/useIndexer";
import "./App.css";
import React from "react";

// Public Esmeralda testnet indexer — no local setup required.
// Swap for http://localhost:18300 (with Network.LocalNet) when using a local indexer.
const DEFAULT_NETWORK = Network.Esmeralda;
const DEFAULT_URL = defaultIndexerUrl(DEFAULT_NETWORK);

const NETWORKS: { label: string; value: Network }[] = [
  { label: "Esmeralda testnet (public)", value: Network.Esmeralda },
  { label: "LocalNet", value: Network.LocalNet },
  { label: "StageNet", value: Network.StageNet },
  { label: "NextNet", value: Network.NextNet },
  { label: "MainNet", value: Network.MainNet },
];

export function App() {
  const { status, error, connect, disconnect, getSubstate, getRecentTransactions } = useIndexer();

  // Connection form state
  const [url, setUrl] = useState(DEFAULT_URL);
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);

  // Substate lookup state
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<unknown>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [txList, setTxList] = useState<TransactionEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const handleConnect = () => {
    void connect(url, network);
  };

  const handleLookup = async () => {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const result = await getSubstate(lookupId.trim());
      setLookupResult(result);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleTransactions = useCallback(() => {
    setListLoading(true);
    getRecentTransactions()
      .then((txs) => {
        setTxList(txs);
      })
      .catch((err) => {
        console.error(err);
        setListError(err instanceof Error ? err.message : "Failed to fetch recent transactions");
      })
      .finally(() => {
        setListLoading(false);
      });
  }, [getRecentTransactions]);

  useEffect(() => {
    if (status !== "connected" || txList?.length > 0) return;
    handleTransactions();
  }, [handleTransactions, status, txList?.length]);

  // ── Connect screen ──────────────────────────────────────────────────────────
  if (status !== "connected") {
    return (
      <div className="layout centered">
        <div className="card">
          <div className="card-logo">
            <TariLogo />
          </div>
          <h1 className="card-title">Indexer Explorer</h1>
          <p className="card-subtitle">
            Browse on-chain substates. The public Esmeralda testnet indexer is pre-filled — no local setup required.
          </p>

          <div className="testnet-notice">
            <span className="testnet-dot" />
            Esmeralda testnet is live · public indexer pre-configured
          </div>

          <div className="form">
            <label className="field-label" htmlFor="url">
              Indexer URL
            </label>
            <input
              id="url"
              className="input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="http://localhost:18300"
              disabled={status === "connecting"}
              spellCheck={false}
            />

            <label className="field-label" htmlFor="network">
              Network
            </label>
            <select
              id="network"
              className="input select"
              value={network}
              onChange={(e) => setNetwork(Number(e.target.value) as Network)}
              disabled={status === "connecting"}
            >
              {NETWORKS.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <button className="btn-primary" onClick={handleConnect} disabled={status === "connecting" || !url}>
            {status === "connecting" ? (
              <>
                <Spinner /> Connecting…
              </>
            ) : (
              "Connect to Indexer"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Explorer screen ─────────────────────────────────────────────────────────
  return (
    <div className="layout explorer">
      <header className="topbar">
        <div className="topbar-left">
          <TariLogo size={28} />
          <span className="topbar-title">Indexer Explorer</span>
          <div className="status-badge connected">
            <span className="dot" />
            {url}
          </div>
        </div>
        <button className="btn-ghost" onClick={disconnect}>
          Disconnect
        </button>
      </header>

      <main className="explorer-body">
        {/* Substate lookup */}
        <section className="panel">
          <h2 className="panel-title">Look Up Substate</h2>
          <div className="lookup-row">
            <input
              className="input flex-1"
              type="text"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleLookup()}
              placeholder="component_0xabc123… or resource_0x…"
              spellCheck={false}
            />
            <button
              className="btn-secondary"
              onClick={() => void handleLookup()}
              disabled={lookupLoading || !lookupId.trim()}
            >
              {lookupLoading ? <Spinner /> : "Look Up"}
            </button>
          </div>

          {lookupError && (
            <div className="error-banner" role="alert">
              {lookupError}
            </div>
          )}

          {lookupResult !== null && <pre className="json-view">{JSON.stringify(lookupResult, null, 2)}</pre>}
        </section>

        {/* Recent transactions */}
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Recent Transactions</h2>
            <button className="btn-ghost small" disabled={listLoading} onClick={handleTransactions}>
              {listLoading ? <Spinner /> : "Refresh"}
            </button>
          </div>

          {txList?.map((tx) => (
            <React.Fragment key={tx.transaction_id}>
              <TransactionRow transaction={tx} onSelect={setLookupId} />
            </React.Fragment>
          ))}

          {listError && (
            <div className="error-banner" role="alert">
              {listError}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TransactionRow({ transaction, onSelect }: { transaction: TransactionEntry; onSelect: (id: string) => void }) {
  const substates = transaction.transaction.V1.body.transaction.inputs;
  return (
    <>
      <div className="substate-row">
        <div className="substate-left">
          <span className="substate-id mono" title={transaction.transaction_id}>
            Transaction ID: {truncate(transaction.transaction_id, 12, 10)}
          </span>
        </div>
        <div className="substate-right">
          <span className="timestamp">{formatTime(transaction.created_at)}</span>
        </div>
      </div>
      <p>
        <b>Substates from the Transaction Inputs</b>
      </p>
      <div className="substate-list">
        {substates?.length > 0
          ? substates.map((s) => {
              return (
                <span key={s.substate_id} className="mono substate-id" onClick={() => onSelect(s.substate_id)}>
                  <b>substate_id:</b> {s.substate_id}
                </span>
              );
            })
          : null}
      </div>
      <hr />
    </>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden />;
}

function TariLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#9d4edd" opacity="0.15" />
      <circle cx="20" cy="20" r="12" fill="#9d4edd" opacity="0.3" />
      <circle cx="20" cy="20" r="5" fill="#9d4edd" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(str: string, head = 10, tail = 8): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}
