//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Manual co-signing example: wallet A drives the transaction, wallet B
 * signs independently without access to A's seal secret.
 *
 * The pattern underpins hardware wallets, HSMs, and human-approval
 * flows: a remote party produces just its `TransactionSignature[]`
 * blob, and the orchestrating wallet combines its own signatures
 * with the remote blob before sealing and submitting.
 *
 * Key idea: both signers must commit to the SAME seal public key. The
 * orchestrator pre-generates a seal keypair via `generateSealKeypair`,
 * shares the public part with the remote signer, and threads the
 * same keypair into the SDK's `signTransaction` at the end.
 *
 * The "remote" boundary is simulated in-process with explicit comments
 * marking where the wire goes. The recipient is a single fresh address;
 * wallet B's role is purely to co-authorise — its vault is not touched.
 */

import {
  TransactionBuilder,
  generateSealKeypair,
  getVaultIdsForAccount,
  sealTransaction,
  signTransaction,
} from "@tari-project/ootle";
import type { Signer } from "@tari-project/ootle";
import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import type { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
  appendPublicTransferToNew,
  faucetAndWait,
  getAccountBalance,
  indexerUrl,
  newRecipient,
  newWallet,
  runScript,
  tari,
  wait,
} from "./_common/index.js";

const TRANSFER_FEE = 3_000n;

/**
 * Returns wallet B's `TransactionSignature[]` blob for the remote-signer
 * side of the hand-off. Takes the JSON-serialised unsigned tx and the
 * orchestrator's seal public key — nothing else.
 *
 * In a real deployment this function would live behind a JRPC / HSM
 * call. Here it's invoked in-process; the JSON round-trip via
 * `JSON.parse` is the boundary marker.
 */
async function remoteCoSign(
  unsignedJson: string,
  sealPublicKey: Uint8Array,
  signer: SecretKeyWallet,
): Promise<TransactionSignature[]> {
  const unsigned = JSON.parse(unsignedJson) as UnsignedTransactionV1;
  return signer.signTransaction(unsigned, sealPublicKey);
}

/**
 * `Signer`-shaped shim that returns pre-computed signatures. Used to
 * feed the remote signer's blob through the SDK's `signTransaction`
 * alongside the live local signer. The `getAddress` / `getPublicKey`
 * methods throw because the SDK only calls `signTransaction` on the
 * signers list; surfacing the bogus call would be safer than returning
 * a placeholder.
 */
class PrecomputedSigner implements Signer {
  constructor(private readonly sigs: TransactionSignature[]) {}
  async signTransaction(_unsigned: UnsignedTransactionV1, _sealPk: Uint8Array): Promise<TransactionSignature[]> {
    return this.sigs;
  }
  async getPublicKey(): Promise<Uint8Array> {
    throw new Error("PrecomputedSigner.getPublicKey is not used in this flow");
  }
  async getAddress(): Promise<string> {
    throw new Error("PrecomputedSigner.getAddress is not used in this flow");
  }
}

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const walletA = await newWallet();
  const walletB = await newWallet();
  const recipient = await newRecipient();
  console.log(`Wallet A owner: ${walletA.ownerAddress}`);
  console.log(`Wallet B owner: ${walletB.ownerAddress}`);
  console.log(`Recipient:      ${recipient.ownerAddress}`);

  const { account: senderAccount } = await faucetAndWait(provider, walletA);
  console.log(`Sender account: ${senderAccount}`);

  const senderVaults = await getVaultIdsForAccount(provider, senderAccount);
  const builder = new TransactionBuilder(NETWORK)
    .withInputs([
      { substate_id: senderAccount, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(senderAccount, TRANSFER_FEE);
  appendPublicTransferToNew(builder, senderAccount, TARI_RESOURCE, tari(1n), recipient.ownerPublicKeyHex, "bucket");
  const unsigned = builder.buildUnsignedTransaction();

  // Generating the seal keypair UP FRONT is the critical step — without it the
  // SDK's `signTransaction` would generate a fresh keypair internally, and B's
  // signatures (computed against a different public key) would fail to verify.
  const sealKeypair = generateSealKeypair();

  // === WALLET A → WALLET B BOUNDARY ===
  // A ships the JSON-serialised unsigned tx + seal public key to B.
  const unsignedJson = JSON.stringify(unsigned);
  console.log("\n-> Shipping unsigned tx + seal_pk to remote co-signer ...");

  // === WALLET B SIDE ===
  // B rehydrates, signs, returns a signature blob. B never sees A's secret
  // key or the seal secret.
  const remoteSignatures = await remoteCoSign(unsignedJson, sealKeypair.public_key, walletB.secret);
  console.log(`<- Received ${remoteSignatures.length} signature(s) from remote co-signer.`);

  // === WALLET B → WALLET A BOUNDARY ===
  // A wraps B's signatures in a shim signer, combines with its own live
  // signer, and runs the SDK's signTransaction with the SAME seal keypair B
  // already committed to.
  const fakeRemote = new PrecomputedSigner(remoteSignatures);
  const signed = await signTransaction([walletA.secret, fakeRemote], unsigned, sealKeypair);
  console.log(`Combined signatures: ${signed.transaction.V1.body.signatures.length} (A live + B pre-computed).`);

  const envelope = sealTransaction(signed);
  const { transaction_id } = await provider.submitTransaction(envelope);
  const pending = provider.watchTransactionSSE(transaction_id);
  await wait("co-signed-transfer", pending);

  const senderBalance = await getAccountBalance(provider, senderAccount, TARI_RESOURCE);
  console.log(`\nSender TARI balance after transfer: ${senderBalance}`);
  console.log(`Transaction id: ${transaction_id}`);

  return { provider };
});
