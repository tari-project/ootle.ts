# Stealth Transfer

A minimal command-line stealth transfer with the Tari Ootle TypeScript SDK. A
simpler TypeScript take on ootle-rs's `stealth_transfer` example.

[`src/main.ts`](./src/main.ts) sends two transactions:

1. **Faucet** — create an account for a fresh sender and fill its (public)
   TARI vault from the faucet.
2. **Transfer** — withdraw 2 TARI of revealed funds from that vault and send
   them to the recipient as a **stealth UTXO**: an independent `utxo_…`
   substate holding a confidential amount that only the recipient's view key
   can decrypt. The fee is paid from the same vault.

## Prerequisites

A reachable LocalNet **indexer** with a faucet. Defaults to
`defaultIndexerUrl(Network.LocalNet)` (`http://localhost:12500`); override
with `OOTLE_INDEXER_URL`.

## Run

From the repo root:

```bash
pnpm install
pnpm --filter ootle-example-stealth-transfer start [recipient-address] [memo]
```

`recipient-address` is an `otl_loc_…` Ootle address. If omitted, a throwaway
recipient is generated (its keys are discarded, so those funds are
unspendable).

`memo` is an optional message attached to the stealth output. It is encrypted
with the output's data, so only the recipient can read it.

Example output:

```text
Sender:    otl_loc_1v6wvk…
Recipient: otl_loc_1dgfu9…
  pending faucet e6d1ef6a…
  finalized faucet e6d1ef6a…: Commit
Sender account: component_7c65776b…
  pending stealth transfer 21400bcf…
  finalized stealth transfer 21400bcf…: Commit
Recipient stealth UTXO: utxo_0101…_7c4ea1f6…
```

## Demo only — do not use with real funds

The sender's secret key lives in memory and is discarded when the script
exits.

## More

For the rest of the stealth surface (receiving and decrypting, spending
stealth inputs, revealed change), see the scripts in
[`../node/src/stealth/`](../node/src/stealth/).
