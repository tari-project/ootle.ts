//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import { Field } from "./Field";

export interface SendCardProps {
  canSend: boolean;
  loading: boolean;
  senderAccount: ComponentAddress | null;
  recipient: string;
  setRecipient: (v: string) => void;
  stealthTari: string;
  setStealthTari: (v: string) => void;
  revealedTari: string;
  setRevealedTari: (v: string) => void;
  feeMicroTari: string;
  setFeeMicroTari: (v: string) => void;
  onSend: () => void;
  message: string | null;
  error: string | null;
}

export function SendCard({
  canSend,
  loading,
  senderAccount,
  recipient,
  setRecipient,
  stealthTari,
  setStealthTari,
  revealedTari,
  setRevealedTari,
  feeMicroTari,
  setFeeMicroTari,
  onSend,
  message,
  error,
}: SendCardProps) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>3. Send</h2>
      </header>

      <p className="card-subtitle">
        Spend revealed TARI from the account the faucet just created. The TS validator requires{" "}
        <code>revealed_input == stealth_out + revealed_out</code>; the fee is charged separately.
      </p>

      {senderAccount === null ? (
        <p className="hint">Run a faucet stealth deposit first — it creates the revealed source account.</p>
      ) : (
        <Field label="Source account" value={senderAccount} mono />
      )}

      <div className="form">
        <label className="field-label" htmlFor="send-recipient">
          Recipient owner address
        </label>
        <input
          id="send-recipient"
          className="input"
          type="text"
          placeholder="otl_loc_…"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          spellCheck={false}
        />

        <div className="grid-3">
          <div>
            <label className="field-label" htmlFor="send-stealth">
              Stealth (TARI)
            </label>
            <input
              id="send-stealth"
              className="input"
              type="number"
              min="1"
              value={stealthTari}
              onChange={(e) => setStealthTari(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="send-revealed">
              Revealed (TARI)
            </label>
            <input
              id="send-revealed"
              className="input"
              type="number"
              min="0"
              value={revealedTari}
              onChange={(e) => setRevealedTari(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="send-fee">
              Fee (µTari)
            </label>
            <input
              id="send-fee"
              className="input"
              type="number"
              min="1"
              value={feeMicroTari}
              onChange={(e) => setFeeMicroTari(e.target.value)}
            />
          </div>
        </div>

        <button className="btn-primary" onClick={onSend} disabled={!canSend}>
          {loading ? "Sending…" : "Send stealth transfer"}
        </button>

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {message !== null && <p className="success-banner">{message}</p>}
      </div>
    </section>
  );
}
