import { useState } from "react";
import { useWalletDaemon } from "./hooks/useWalletDaemon";
import "./App.css";

// The wallet daemon JRPC endpoint. Start with: ./tari_ootle_walletd --network esme
const DEFAULT_URL = "http://127.0.0.1:5100/json_rpc";

/** Shorten a hex string to start…end form, preserving enough to identify it. */
function truncate(str: string, head = 10, tail = 8): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

export function App() {
  const { status, address, publicKey, error, connect, disconnect } = useWalletDaemon();

  const [url, setUrl] = useState(DEFAULT_URL);

  const handleConnect = () => connect({ url: url.trim() });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConnect().catch((err) => console.error(err));
  };

  if (status === "connected" && address && publicKey) {
    return (
      <div className="layout">
        <div className="card">
          <div className="card-header">
            <div className="status-badge connected">
              <span className="dot" />
              Connected
            </div>
            <button className="btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          </div>

          <div className="account-icon">
            {/* deterministic color from address */}
            <div className="avatar" style={{ background: addressToGradient(address) }} />
          </div>

          <div className="fields">
            <Field label="Address" value={address} mono />
            <Field label="Public Key" value={publicKey} mono />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="card">
        <div className="card-logo">
          <TariLogo />
        </div>

        <h1 className="card-title">Connect Wallet</h1>
        <p className="card-subtitle">Connect to your Tari Wallet Daemon to view your account.</p>

        <div className="prereqs">
          <p className="prereqs-title">Before you begin</p>
          <ol className="prereqs-list">
            <li>
              Download <strong>tari_ootle_walletd</strong> from the{" "}
              <a href="https://github.com/tari-project/tari-ootle/releases" target="_blank" rel="noreferrer">
                releases page
              </a>
            </li>
            <li>
              Start it: <code>./tari_ootle_walletd --network esme</code>
            </li>
            <li>
              Fund your account via the wallet UI at{" "}
              <a href="http://localhost:5100" target="_blank" rel="noreferrer">
                localhost:5100
              </a>
            </li>
          </ol>
        </div>

        <div className="form" onKeyDown={handleKeyDown}>
          <label className="field-label" htmlFor="url">
            Daemon URL
          </label>
          <input
            id="url"
            className="input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:18103"
            disabled={status === "connecting"}
            spellCheck={false}
          />

        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <button
          className="btn-primary"
          onClick={() => void handleConnect()}
          disabled={status === "connecting" || !url}
        >
          {status === "connecting" ? (
            <>
              <Spinner /> Connecting…
            </>
          ) : (
            "Connect Wallet"
          )}
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-value-row">
        <span className={mono ? "mono value" : "value"} title={value}>
          {truncate(value)}
        </span>
        <button className="btn-copy" onClick={() => void copy()} title="Copy to clipboard">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden />;
}

function TariLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#9d4edd" opacity="0.15" />
      <circle cx="20" cy="20" r="12" fill="#9d4edd" opacity="0.3" />
      <circle cx="20" cy="20" r="5" fill="#9d4edd" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a deterministic gradient from an address string. */
function addressToGradient(address: string): string {
  let h1 = 0;
  let h2 = 120;
  for (let i = 0; i < address.length; i++) {
    h1 = (h1 * 31 + address.charCodeAt(i)) % 360;
    h2 = (h2 * 17 + address.charCodeAt(i)) % 360;
  }
  return `linear-gradient(135deg, hsl(${h1},70%,55%), hsl(${h2},70%,45%))`;
}
