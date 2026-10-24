---
title: External Key Signer
description: Sign with a key held in an HSM, MPC vault or hardware wallet.
---

`ExternalKeySigner` implements the `Signer` interface for a key that lives outside JavaScript: an HSM, an MPC vault or a hardware wallet. The SDK hashes the transaction and passes the 64-byte hash to your `sign` callback. The callback returns a raw 64-byte signature, and the SDK verifies it before using it.

## Signature scheme

`sign` must return `R ‖ s`, a Ristretto255 Schnorr signature as produced by `tari_crypto`'s `RistrettoSchnorr`:

- `R = k·G` is a compressed Ristretto point, and `s = k + e·x` is a canonical little-endian scalar.
- `e` is the 64-byte Blake2b digest of `"com.tari.schnorr_signature.v1.challenge" ‖ R ‖ P ‖ hash`, reduced mod ℓ. Each item is prefixed with its length as a little-endian u64.

Ed25519 and sr25519 signatures have the same length but do not verify. A signature that fails verification throws a `SignerError`.

## Use

```ts
import { ExternalKeySigner, Network, sendTransaction } from "@tari-project/ootle";

const signer = new ExternalKeySigner({
  publicKey, // 32 bytes: the external key's public key
  viewPublicKey, // 32 bytes: with publicKey, forms the Ootle address
  network: Network.Esmeralda,
  sign: (hash) => vault.sign(keyId, hash), // resolves to a 64-byte Uint8Array
});

const address = await signer.getAddress();
await sendTransaction(provider, signer, unsignedTx);
```

The signer authorizes the transaction. The SDK seals it with a throwaway key, as it does for every other signer, so the external key signs once per transaction.
