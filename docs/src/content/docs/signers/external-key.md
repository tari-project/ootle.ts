---
title: External Key Signer
description: Sign with a key held in an HSM, MPC vault or hardware wallet.
---

`ExternalKeySigner` implements the `Signer` interface for a key that lives outside JavaScript: an HSM, an MPC vault or a hardware wallet. The SDK hashes the transaction and passes the 64-byte hash to your `sign` callback. The callback returns a raw 64-byte signature, and the SDK verifies it before using it.

## Signature scheme

`sign` must return a standard sr25519 (schnorrkel) signature over the 64 bytes exactly as given, under the default `substrate` signing context, with the sr25519 marker bit set in its last byte. Any sr25519 signer produces this form, such as `@scure/sr25519` or a Polkadot signing library.

A signer that hashes, prefixes or wraps the message (for example in `<Bytes>…</Bytes>`) produces a signature that does not verify. Ed25519 and Ristretto Schnorr signatures have the same length but do not verify either. A signature that fails verification throws a `SignerError`.

## Key isolation

Every Ootle authorization is a `substrate`-context sr25519 signature over a 64-byte message. If anything else can ask the same key to sign arbitrary bytes under `substrate` (a "sign message" endpoint, a login challenge, a raw-signing API another service can call), it can be handed an Ootle transaction hash, and the signature it returns authorizes that transaction.

- Give each Ootle account its own key or derivation path, used by no Substrate chain and no other application.
- Let only the component that builds Ootle transactions request signatures from that key.

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
