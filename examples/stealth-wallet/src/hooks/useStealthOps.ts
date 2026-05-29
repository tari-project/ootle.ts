//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * The three actions the demo UI exposes — wrappers over the browser stealth
 * helpers (`src/lib/stealth.ts`):
 *
 *  - {@link faucetDeposit}: faucet → stealth deposit; returns the produced
 *    UTXO id + value (decrypted via the recipient's view secret).
 *  - {@link scanOwned}: for a list of UTXO substate ids, attempt to decrypt
 *    each with the view secret; reports `{ id, value, owned }`.
 *  - {@link sendTransfer}: build a {@link StealthTransfer}, run it through
 *    `WalletStealthAuthorizer`, submit + watch. Used for both
 *    "stealth → revealed" and "stealth → stealth" UX paths.
 *
 * The hook itself is stateless beyond the React-rendered output the page
 * collects from each call. The `useState`/`useEffect` lifecycle lives in
 * the page component (`App.tsx`).
 */

import { useCallback } from "react";
import { createOutput, decryptOwnedUtxo } from "@tari-project/ootle";
import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import type { IndexerProvider } from "@tari-project/ootle-indexer";
import { TARI_RESOURCE, firstNewSubstate, wait } from "@tari-project/example-common";
import { stealthCrypto } from "../lib/crypto";
import { faucetStealth, makeTransfer, sendStealth, stealthUtxoSubstate, type StealthIdentity } from "../lib/stealth";

/** Result of {@link faucetDeposit}: the produced UTXO + the decrypted value. */
export interface FaucetDepositResult {
  /** The `utxo_<resource>_<commitment>` substate id of the produced UTXO. */
  substateId: string;
  /** Decrypted µTari value (owner's view-secret decrypt). */
  value: bigint;
  /** Transaction outcome — always `"Commit"` when the call resolves successfully. */
  outcome: string;
  /**
   * The `component_…` account address the faucet created inline (the sender's
   * revealed account). Required as the revealed source for any subsequent
   * stealth send. May be `null` if the receipt diff doesn't surface one,
   * which would be a network anomaly given the on-chain `CreateAccount`
   * instruction the faucet flow emits.
   */
  senderAccount: ComponentAddress | null;
}

/** Result entry returned by {@link scanOwned} for each scanned UTXO. */
export interface ScannedUtxo {
  substateId: string;
  /** `null` when the UTXO isn't owned by `identity` (AEAD decrypt failed) or has been spent. */
  value: bigint | null;
}

/** Inputs accepted by {@link sendTransfer}. */
export interface SendTransferInput {
  /** Recipient bech32m owner address. */
  recipient: string;
  /** Confidential output amount to mint into `recipient` (µTari). */
  stealth: bigint;
  /** Revealed-change amount deposited back to the sender's revealed account (µTari). */
  revealed: bigint;
  /** Max fee (µTari) charged via `pay_fee` on the sender account. */
  fee: bigint;
  /** Sender's revealed account (the `component_…` returned by a prior faucet). */
  senderAccount: ComponentAddress;
  /** Total revealed XTR to withdraw from the sender's account (must equal `stealth + revealed`). */
  revealedInput: bigint;
}

/** Result of {@link sendTransfer}. */
export interface SendTransferResult {
  outcome: string;
  /** The recipient's produced stealth UTXO id, when the transfer emits one. */
  recipientUtxoId: string | null;
}

export interface UseStealthOps {
  /** Faucet → stealth deposit into `identity`. */
  faucetDeposit: (provider: IndexerProvider, identity: StealthIdentity, amount: bigint) => Promise<FaucetDepositResult>;
  /** Re-decrypt previously-discovered UTXOs with `identity`'s view secret. */
  scanOwned: (
    provider: IndexerProvider,
    identity: StealthIdentity,
    substateIds: readonly string[],
  ) => Promise<ScannedUtxo[]>;
  /**
   * Send a stealth transfer (revealed source → stealth output + revealed change).
   * Caller supplies the source account (returned by a prior {@link faucetDeposit}
   * — the receipt also surfaces a `component_…` substate alongside the
   * `utxo_…`). The TS validator requires
   * `revealedInput == stealth + revealed`; the fee is charged separately.
   */
  sendTransfer: (
    provider: IndexerProvider,
    identity: StealthIdentity,
    input: SendTransferInput,
  ) => Promise<SendTransferResult>;
}

export function useStealthOps(): UseStealthOps {
  const faucetDeposit = useCallback(
    async (provider: IndexerProvider, identity: StealthIdentity, amount: bigint): Promise<FaucetDepositResult> => {
      if (amount <= 0n) {
        throw new Error(`faucetDeposit: amount must be > 0, got ${amount}`);
      }
      const pending = await faucetStealth(provider, identity, identity.ownerAddress, { stealthAmount: amount });
      const outcome = await wait("faucet-stealth", pending);
      const found = await stealthUtxoSubstate(provider, pending);
      if (found === null) {
        throw new Error("faucet stealth deposit committed but no utxo_… substate appeared in the receipt diff");
      }
      const crypto = stealthCrypto();
      const decrypted = await decryptOwnedUtxo(crypto, identity.viewSecret, found.substate, found.substateId);
      if (decrypted === null) {
        throw new Error("could not decrypt the produced stealth UTXO with the recipient's view secret");
      }
      const receipt = await pending.getReceipt().catch(() => null);
      const senderAccount = receipt ? (firstNewSubstate(receipt, "component_") as ComponentAddress | null) : null;
      return {
        substateId: found.substateId,
        value: decrypted.value,
        outcome: outcome.outcome,
        senderAccount,
      };
    },
    [],
  );

  const scanOwned = useCallback(
    async (
      provider: IndexerProvider,
      identity: StealthIdentity,
      substateIds: readonly string[],
    ): Promise<ScannedUtxo[]> => {
      const crypto = stealthCrypto();
      const results: ScannedUtxo[] = [];
      for (const substateId of substateIds) {
        try {
          const substate = await provider.getSubstate(substateId);
          const decrypted = await decryptOwnedUtxo(crypto, identity.viewSecret, substate, substateId);
          results.push({ substateId, value: decrypted?.value ?? null });
        } catch {
          // The UTXO may have been spent (DOWN) — surface as not-owned rather than
          // throwing so the rest of the list is still scanned.
          results.push({ substateId, value: null });
        }
      }
      return results;
    },
    [],
  );

  const sendTransfer = useCallback(
    async (
      provider: IndexerProvider,
      identity: StealthIdentity,
      input: SendTransferInput,
    ): Promise<SendTransferResult> => {
      if (input.stealth <= 0n) throw new Error("sendTransfer: stealth amount must be > 0");
      if (input.revealed < 0n) throw new Error("sendTransfer: revealed amount must be >= 0");
      if (input.fee <= 0n) throw new Error("sendTransfer: fee must be > 0");
      if (input.revealedInput !== input.stealth + input.revealed) {
        throw new Error(
          `sendTransfer: revealedInput (${input.revealedInput}) must equal stealth (${input.stealth}) + revealed (${input.revealed})`,
        );
      }

      const transfer = makeTransfer(provider)
        .spendRevealedInput(input.senderAccount, input.revealedInput)
        .toStealthOutput(
          createOutput({ destination: input.recipient, amount: input.stealth, resourceAddress: TARI_RESOURCE }),
        );

      if (input.revealed > 0n) {
        transfer.toRevealedOutput(input.revealed);
      }
      transfer.payFeeFromRevealed(input.fee);

      const { pending } = await sendStealth(provider, identity, transfer);
      const outcome = await wait("stealth-send", pending);
      // Surface the recipient's produced UTXO id if the receipt diff has one
      // (it will when `stealth > 0`).
      const receipt = await pending.getReceipt().catch(() => null);
      const recipientUtxoId = receipt ? firstNewSubstate(receipt, "utxo_") : null;
      return { outcome: outcome.outcome, recipientUtxoId };
    },
    [],
  );

  return { faucetDeposit, scanOwned, sendTransfer };
}
