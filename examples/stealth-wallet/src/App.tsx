//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { useCallback, useState } from "react";
import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import { toHexStr } from "@tari-project/ootle";
import { tari } from "@tari-project/example-common";
import { ReceiveCard } from "./components/ReceiveCard";
import { SendCard } from "./components/SendCard";
import { SetupCard } from "./components/SetupCard";
import { TariLogo } from "./components/TariLogo";
import { useAsyncAction } from "./hooks/useAsyncAction";
import { useIndexer } from "./hooks/useIndexer";
import { useStealthOps, type ScannedUtxo } from "./hooks/useStealthOps";
import { useStealthWallet } from "./hooks/useStealthWallet";
import { formatTari, truncate } from "./lib/format";
import "./App.css";

export function App() {
  return (
    <div className="page">
      <header className="page-header">
        <div className="logo">
          <TariLogo />
          <h1>Stealth Wallet</h1>
        </div>
        <p className="page-subtitle">
          A browser demo of the Tari Ootle TypeScript SDK's stealth (confidential transfer) surface.
        </p>
      </header>

      <main className="page-main">
        <DemoFlow />
      </main>

      <footer className="page-footer">
        <p>
          See <code>examples/node/src/stealth/</code> for the headless equivalents.
        </p>
      </footer>
    </div>
  );
}

function DemoFlow() {
  const wallet = useStealthWallet();
  const indexer = useIndexer();
  const { faucetDeposit, scanOwned, sendTransfer } = useStealthOps();

  // UTXOs the user has discovered via `Faucet stealth deposit`.
  const [ownedUtxos, setOwnedUtxos] = useState<string[]>([]);
  const [scanResults, setScanResults] = useState<ScannedUtxo[] | null>(null);

  // The most recent sender `component_…` account (created inline by the faucet).
  const [senderAccount, setSenderAccount] = useState<ComponentAddress | null>(null);

  // Send-card inputs.
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendStealthTari, setSendStealthTari] = useState("1");
  const [sendRevealedTari, setSendRevealedTari] = useState("2");
  const [sendFeeMicroTari, setSendFeeMicroTari] = useState("1000");

  const faucetFn = useCallback(async () => {
    if (indexer.provider === null || wallet.identity === null) {
      throw new Error("No provider or wallet");
    }
    const result = await faucetDeposit(indexer.provider, wallet.identity, tari(2));
    setOwnedUtxos((prev) => [...prev, result.substateId]);
    setScanResults((prev) => [...(prev ?? []), { substateId: result.substateId, value: result.value }]);
    if (result.senderAccount !== null) {
      setSenderAccount(result.senderAccount);
    }
    return `Deposited ${formatTari(result.value)} — UTXO ${truncate(result.substateId)}`;
  }, [indexer.provider, wallet.identity, faucetDeposit]);

  const scanFn = useCallback(async () => {
    if (indexer.provider === null || wallet.identity === null) {
      throw new Error("No provider or wallet");
    }
    const result = await scanOwned(indexer.provider, wallet.identity, ownedUtxos);
    setScanResults(result);
  }, [indexer.provider, wallet.identity, ownedUtxos, scanOwned]);

  const sendFn = useCallback(async () => {
    if (indexer.provider === null || wallet.identity === null) {
      throw new Error("No provider or wallet");
    }
    if (sendRecipient.trim() === "") {
      throw new Error("Recipient address is required");
    }
    if (senderAccount === null) {
      throw new Error("No revealed source account — run a faucet deposit first to create one.");
    }
    const stealth = tari(BigInt(sendStealthTari));
    const revealed = tari(BigInt(sendRevealedTari));
    const fee = BigInt(sendFeeMicroTari);
    const result = await sendTransfer(indexer.provider, wallet.identity, {
      recipient: sendRecipient.trim(),
      stealth,
      revealed,
      fee,
      senderAccount,
      revealedInput: stealth + revealed,
    });
    const utxoSuffix = result.recipientUtxoId !== null ? ` — UTXO ${truncate(result.recipientUtxoId)}` : "";
    return `Sent ${formatTari(stealth)} stealth + ${formatTari(revealed)} revealed change${utxoSuffix}`;
  }, [
    indexer.provider,
    wallet.identity,
    sendRecipient,
    sendStealthTari,
    sendRevealedTari,
    sendFeeMicroTari,
    senderAccount,
    sendTransfer,
  ]);

  const faucet = useAsyncAction(faucetFn, "Faucet deposit failed");
  const scan = useAsyncAction(scanFn, "Scan failed");
  const send = useAsyncAction(sendFn, "Send failed");

  const resetSession = useCallback(() => {
    wallet.reset();
    indexer.disconnect();
    setOwnedUtxos([]);
    setScanResults(null);
    setSenderAccount(null);
    faucet.reset();
    scan.reset();
    send.reset();
  }, [wallet, indexer, faucet, scan, send]);

  const handleConnectIndexer = (url: string) =>
    indexer.connect(url.trim()).catch((err) => {
      console.error(err);
    });

  // Short hex tag for the view secret — shown so the user can tell sessions apart
  // visually. NOT the view public key (the SDK doesn't surface that here). This
  // is the secret itself, but kept short + behind a copy button so it's only ever
  // exposed when the user asks for it.
  const viewSecretHex = wallet.identity !== null ? toHexStr(wallet.identity.viewSecret) : null;

  const ready = wallet.status === "ready" && indexer.status === "connected";

  return (
    <>
      <SetupCard
        wallet={wallet}
        indexer={indexer}
        onConnect={handleConnectIndexer}
        onReset={resetSession}
        viewSecretHex={viewSecretHex}
      />

      <ReceiveCard
        canFaucet={ready && !faucet.loading}
        canScan={ready && !scan.loading && ownedUtxos.length > 0}
        loading={faucet.loading}
        scanning={scan.loading}
        onFaucet={() => void faucet.run()}
        onScan={() => void scan.run()}
        utxos={scanResults}
        message={faucet.result}
        error={faucet.error}
        scanError={scan.error}
      />

      <SendCard
        canSend={ready && senderAccount !== null && !send.loading}
        loading={send.loading}
        senderAccount={senderAccount}
        recipient={sendRecipient}
        setRecipient={setSendRecipient}
        stealthTari={sendStealthTari}
        setStealthTari={setSendStealthTari}
        revealedTari={sendRevealedTari}
        setRevealedTari={setSendRevealedTari}
        feeMicroTari={sendFeeMicroTari}
        setFeeMicroTari={setSendFeeMicroTari}
        onSend={() => void send.run()}
        message={send.result}
        error={send.error}
      />
    </>
  );
}
