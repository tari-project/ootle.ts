---
title: Receiving stealth outputs
description: Decrypt owned confidential UTXOs with your view secret using `decryptOwnedUtxo`.
---

Detect payments to your address by trying to decrypt each candidate UTXO with your view secret. See [Stealth overview](./overview) for the broader four-step flow.

`decryptOwnedUtxo` returns the decrypted `{ value, mask, memo }` if the output is yours, or `null` if it is not (so you can scan a batch in a loop without try/catch at every call site).

```ts
import { decryptOwnedUtxo, stealthUtxoSubstateId, WasmStealthCrypto } from "@tari-project/ootle";

const crypto = new WasmStealthCrypto(provider.network());
const viewSecret = wallet.getViewOnlySecret(); // Uint8Array | null (from a SecretKeyWallet)
if (viewSecret === null) throw new Error("wallet has no view key");

const substateId = stealthUtxoSubstateId(resourceAddress, commitment);
const substate = await provider.getStealthUtxo(resourceAddress, commitment);

if (substate !== null) {
  const decrypted = await decryptOwnedUtxo(crypto, viewSecret, substate, substateId);
  if (decrypted !== null) {
    console.log("received", decrypted.value, "µTari; mask =", decrypted.mask.toHex());
  }
}
```

## Runnable example

[`examples/node/src/stealth/faucet-deposit.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/faucet-deposit.ts) is the canonical receive-side demo: faucet → confidential deposit → recipient-side `decryptOwnedUtxo` over the produced UTXO. Run it with:

```sh
pnpm --filter @tari-project/ootle-examples-node run stealth:faucet-deposit
```

Requires a running LocalNet — see [Prerequisites](../getting-started/prerequisites).
