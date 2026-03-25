import { TemplateDef, FunctionDef, IndexerProvider } from "@tari-project/ootle-indexer";

import {
  Network,
  toHexStr,
  TransactionBuilder,
  type UnsignedTransactionV1,
  type TransactionSignature,
  sendTransaction,
} from "@tari-project/ootle";

import { getInputType, getTypeAsString } from "./components.tsx";
import { useCallback, useMemo, useState } from "react";
import { EphemeralKeySigner } from "@tari-project/ootle-secret-key-wallet";
type PublishedTemplateAddress = string; // todo export in indexer
interface TransactProps {
  provider: IndexerProvider | null;
  def?: TemplateDef | null;
  templateAddress?: PublishedTemplateAddress | null;
  selectedFunction?: FunctionDef | null;
}

export function Transact({ provider, def, selectedFunction, templateAddress }: TransactProps) {
  const s = EphemeralKeySigner?.generate();
  const b = new TransactionBuilder(Network.Esmeralda);

  const [pubKey, setPubKey] = useState<Uint8Array | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [unsignedAccTx, setUnsignedAccTx] = useState<UnsignedTransactionV1 | null>(null);
  const [signatures, setSignatures] = useState<TransactionSignature[]>([]);

  async function getSignerDetails() {
    s.getPublicKey().then((pk) => setPubKey(pk));
    s.getAddress().then((addr) => setAddress(addr));
  }
  function createAccountTX() {
    if (pubKey) {
      const accUnsignedTx = b.createAccount(pubKey).buildUnsignedTransaction();
      setUnsignedAccTx(accUnsignedTx);
    }
  }

  async function sendAccTx() {
    if (provider && unsignedAccTx) {
      const bla = await sendTransaction(provider, s, unsignedAccTx);
      console.debug(bla);
    }
  }

  return (
    <div className="tx-view">
      <h2>
        Transact with <code>EphemeralKeySigner</code>
      </h2>
      <hr />
      <div className="btn-group">
        <button className="btn-ghost small" onClick={getSignerDetails}>
          Get Signer Public Key & Address
        </button>
      </div>
      {pubKey && <div className="address-chip">{toHexStr(pubKey)}</div>}
      {address && <div className="address-chip">{address}</div>}
      <hr />
      <div className="tx-view">
        <h4>Build a transaction:</h4>
        <div className="btn-group">
          {pubKey && (
            <button className="btn-ghost small" onClick={createAccountTX} disabled={!!unsignedAccTx}>
              Create Account Tx
            </button>
          )}
          {unsignedAccTx && (
            <button className="btn-ghost small" onClick={sendAccTx} disabled={!provider || !unsignedAccTx}>
              Send Account Tx
            </button>
          )}
        </div>
        {unsignedAccTx && (
          <div style={{ maxHeight: 250 }}>
            <pre className="json-view">
              {JSON.stringify(unsignedAccTx, (key, value) => (key === "arg_type" ? getTypeAsString(value) : value), 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
