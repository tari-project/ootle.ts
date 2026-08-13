//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-backed coverage for the top-level orchestration entry points —
// `submitTransaction`, `sendTransaction` and `sendDryRun`.
//
// `sendTransaction` is the SDK's headline API: it chains resolve → sign → seal →
// submit → watch in one call. The individual steps each have their own tests; what
// is asserted HERE is the wiring between them, which no other test exercises:
//   - the transaction that reaches the SIGNER carries the resolved inputs, not the
//     caller's unversioned ones
//   - the id watched is the id the submit call returned
//   - `sendDryRun` sets `dry_run` on the signed transaction without mutating the
//     caller's object
//
// Assertions are made on the transaction handed to the signer rather than on the
// sealed envelope: `signTransaction` generates a fresh random seal keypair per call,
// so two envelopes for the same transaction never compare equal and any assertion
// over them would pass vacuously.
//
// Real signing (not a stub) so the chain runs through genuine WASM; the network is
// faked at the `Provider` seam.

import { describe, expect, it, vi } from "vitest";
import type {
  IndexerGetTransactionResultResponse,
  IndexerSubmitTransactionResponse,
  SubstateRequirement,
  TransactionSignature,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import type { Signer } from "./signer";
import { sendDryRun, sendTransaction, submitTransaction } from "./transaction";
import { fakeProvider } from "./test/fake-provider";
import { InlineEphemeralSigner } from "./test/fake-signer";
import { trivialUnsignedTx } from "./test/tx-builders";
import { TEST_ACCOUNT_ADDRESS } from "./test/fixtures";

/** A finalized Commit result — the shape `watchTransaction` accepts as terminal. */
function committed(): IndexerGetTransactionResultResponse {
  return {
    result: {
      Finalized: {
        final_decision: "Commit",
        execution_result: null,
        abort_details: null,
        finalized_time: { secs: 0, nanos: 0 },
        execution_time: { secs: 0, nanos: 0 },
      },
    },
  } as unknown as IndexerGetTransactionResultResponse;
}

/**
 * A real `InlineEphemeralSigner` that also records the transaction it was asked to
 * sign. This is the observation point for "what did the chain actually sign?" —
 * the sealed envelope cannot answer that, because the seal keypair is random.
 */
class RecordingSigner implements Signer {
  public readonly signed: UnsignedTransactionV1[] = [];
  private readonly inner = InlineEphemeralSigner.generate();

  public getAddress(): Promise<string> {
    return this.inner.getAddress();
  }

  public getPublicKey(): Promise<Uint8Array> {
    return this.inner.getPublicKey();
  }

  public signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    this.signed.push(unsignedTx);
    return this.inner.signTransaction(unsignedTx, sealPublicKey);
  }
}

const FAST = { pollIntervalMs: 1, timeoutMs: 5_000 };

/**
 * A `submitTransaction` stub returning `transactionId`. The envelope parameter is
 * declared so callers can read it back off `.mock.calls`, and the `result` field of
 * the real response is irrelevant to the send path — nothing downstream reads it.
 */
function submitStub(transactionId: string) {
  return vi.fn(
    async (_envelope: string) => ({ transaction_id: transactionId }) as unknown as IndexerSubmitTransactionResponse,
  );
}

describe("submitTransaction", () => {
  it("returns the transaction_id from the provider response", async () => {
    const submit = submitStub("tx_submitted");
    const provider = fakeProvider({ submitTransaction: submit });

    const id = await submitTransaction(provider, "sealed-envelope");

    expect(id).toBe("tx_submitted");
    expect(submit).toHaveBeenCalledExactlyOnceWith("sealed-envelope");
  });
});

describe("sendTransaction (WASM)", () => {
  it("signs the RESOLVED transaction and watches the id submit returned", async () => {
    // A real substate id: this test signs with real WASM, whose deserializer rejects
    // the placeholder ids the non-WASM transaction tests can get away with.
    const resolved: SubstateRequirement[] = [{ substate_id: TEST_ACCOUNT_ADDRESS, version: 9 }];
    const finalResult = committed();

    const resolveInputs = vi.fn(async () => resolved);
    const submit = submitStub("tx_chained");
    const getTransactionResult = vi.fn(async () => finalResult);
    const provider = fakeProvider({ resolveInputs, submitTransaction: submit, getTransactionResult });

    const signer = new RecordingSigner();
    const tx = trivialUnsignedTx();
    tx.inputs = [{ substate_id: TEST_ACCOUNT_ADDRESS, version: null }];

    const out = await sendTransaction(provider, signer, tx, FAST);

    // The caller's unversioned inputs went to the resolver...
    expect(resolveInputs).toHaveBeenCalledExactlyOnceWith(tx.inputs);

    // ...and the signer received the resolver's OUTPUT, not the caller's input.
    // A chain that skipped the resolve step would sign `version: null` here.
    expect(signer.signed).toHaveLength(1);
    expect(signer.signed[0].inputs).toEqual(resolved);
    expect(signer.signed[0].inputs[0].version).toBe(9);

    // Something was submitted, and the id watched is the one submit returned —
    // not the caller's, and not a fresh one.
    expect(submit).toHaveBeenCalledTimes(1);
    expect(typeof submit.mock.calls[0][0]).toBe("string");
    expect(getTransactionResult).toHaveBeenCalledWith("tx_chained");
    expect(out).toBe(finalResult);
  });

  it("accepts a single signer and an array of signers interchangeably", async () => {
    const provider = () =>
      fakeProvider({
        submitTransaction: submitStub("tx_1"),
        getTransactionResult: vi.fn(async () => committed()),
      });
    const signer = InlineEphemeralSigner.generate();

    await expect(sendTransaction(provider(), signer, trivialUnsignedTx(), FAST)).resolves.toBeDefined();
    await expect(sendTransaction(provider(), [signer], trivialUnsignedTx(), FAST)).resolves.toBeDefined();
  });

  it("propagates a submit failure instead of proceeding to watch", async () => {
    const getTransactionResult = vi.fn();
    const provider = fakeProvider({
      submitTransaction: vi.fn(async () => {
        throw new Error("submit exploded");
      }),
      getTransactionResult,
    });

    await expect(sendTransaction(provider, InlineEphemeralSigner.generate(), trivialUnsignedTx())).rejects.toThrow(
      "submit exploded",
    );
    expect(getTransactionResult).not.toHaveBeenCalled();
  });
});

describe("sendDryRun (WASM)", () => {
  it("signs with dry_run = true without mutating the caller's transaction", async () => {
    const provider = fakeProvider({
      submitTransaction: submitStub("tx_dry"),
      getTransactionResult: vi.fn(async () => committed()),
    });

    const signer = new RecordingSigner();
    const tx = trivialUnsignedTx();
    expect(tx.dry_run).toBe(false);

    await sendDryRun(provider, signer, tx, FAST);

    // The flag is set on what actually got signed and sealed...
    expect(signer.signed).toHaveLength(1);
    expect(signer.signed[0].dry_run).toBe(true);

    // ...and the caller's object is untouched — `sendDryRun` spreads into a copy.
    expect(tx.dry_run).toBe(false);
  });

  it("leaves dry_run false on the normal sendTransaction path", async () => {
    const provider = fakeProvider({
      submitTransaction: submitStub("tx_wet"),
      getTransactionResult: vi.fn(async () => committed()),
    });

    const signer = new RecordingSigner();
    await sendTransaction(provider, signer, trivialUnsignedTx(), FAST);

    expect(signer.signed[0].dry_run).toBe(false);
  });
});
