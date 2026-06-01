//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Regression for the seal-OUTPUT u64 precision bug (PR #113, issue 01).
//
// A confidential output's `minimum_value_promise` is emitted by the engine as a BARE JSON
// number and routinely exceeds 2^53. `serializeUnsignedTx` already preserves it on the
// INPUT side; this test pins the OUTPUT side: `signTransaction` must expose the byte-exact
// `sealedJson` from WASM, and `sealTransaction` must BOR-encode that string directly — never
// a `JSON.parse` → `JSON.stringify` round-trip, which silently rounds the amount and would
// produce an envelope the engine rejects with "invalid signature(s)".

import { describe, expect, it } from "vitest";
import {
  borEncodeTransaction,
  generateOotleAddress,
  generateOotleSecretKey,
  ootlePublicKeyFromSecretKey,
} from "@tari-project/ootle-wasm";
import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { Network } from "./network";
import { sealTransaction, signTransaction } from "./transaction";
import { WasmStealthCrypto } from "./stealth/wasm-crypto";
import { createOutput, Mask } from "./stealth/primitives";
import { StealthTransferStatement } from "./stealth/statements";
import { signBalanceProof } from "./stealth/balance-proof";
import { statementAsWire } from "./stealth/instruction";

const RESOURCE = "resource_" + "a".repeat(64);
// 2^53 + 1: the smallest integer a JS `number` cannot represent exactly. A
// `JSON.parse`/`JSON.stringify` round-trip rounds it down to 2^53 (…992).
const BIG = 9_007_199_254_740_993n;
const ROUNDED = "9007199254740992";

function realDestination(): string {
  const sk = generateOotleSecretKey();
  const pk = ootlePublicKeyFromSecretKey(sk.owner_key, sk.view_key);
  return generateOotleAddress(pk.owner_key, pk.view_key, Network.LocalNet);
}

/** A real WASM statement whose output carries a `minimum_value_promise` above 2^53. */
async function statementWithLargeMvp(): Promise<StealthTransferStatement> {
  const crypto = new WasmStealthCrypto(Network.LocalNet);
  const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
    [createOutput({ destination: realDestination(), amount: BIG + 1000n, resourceAddress: RESOURCE, minimumValuePromise: BIG })],
    400n,
  );
  const inputsStatement = await crypto.buildInputsStatement([], BIG + 1400n);
  const balanceProof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
  return new StealthTransferStatement(inputsStatement, outputsStatement, balanceProof);
}

function txWithStatement(statement: unknown): UnsignedTransactionV1 {
  return {
    network: Network.LocalNet,
    fee_instructions: [],
    instructions: [
      {
        StealthTransfer: {
          resource_address_ref: { Address: RESOURCE },
          statement: statement as never,
          revealed_input_bucket: null,
        },
      },
    ],
    inputs: [],
    min_epoch: null,
    max_epoch: null,
    dry_run: false,
    is_seal_signer_authorized: false,
  } as UnsignedTransactionV1;
}

describe("seal-output u64 precision (real WASM)", () => {
  it("seals a u64 > 2^53 byte-exact, never via the lossy parsed view", async () => {
    const statement = await statementWithLargeMvp();
    expect(statement.toCompactJson(), "the statement must carry the bare u64 verbatim").toContain(BIG.toString());

    const tx = txWithStatement(statementAsWire(statement));
    // No body signers: this test pins the seal OUTPUT bytes, not signature collection. The
    // seal step appends only the seal signature and does not verify body signatures, so an
    // empty signer set is sufficient (and sidesteps the stealth-aware signer path).
    const signed = await signTransaction([], tx);

    // The canonical sealed JSON preserves the large amount byte-exact...
    expect(signed.sealedJson).toContain(BIG.toString());
    expect(signed.sealedJson).not.toContain(ROUNDED);
    // ...whereas the parsed convenience view has already rounded it — which is exactly why
    // re-serialising `transaction` for submission is forbidden.
    expect(JSON.stringify(signed.transaction)).toContain(ROUNDED);
    expect(JSON.stringify(signed.transaction)).not.toContain(BIG.toString());

    // sealTransaction must encode the byte-exact JSON, not the rounded parsed object.
    const envelope = sealTransaction(signed);
    expect(envelope).toBe(borEncodeTransaction(signed.sealedJson));
    expect(envelope).not.toBe(borEncodeTransaction(JSON.stringify(signed.transaction)));
  });
});
