//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Regression for PR #113 issue 04: the test fake signers must hash the SAME serialization
// the real signer + seal step use (`serializeUnsignedTx`), not `JSON.stringify`. For a
// stealth transaction the statement is carried as a raw-JSON fragment; `JSON.stringify`
// renders it as `{"__ootleRawJson":"…"}` — a string-typed statement the engine's
// `hashUnsignedTransaction` rejects — so a fake signer on the old path diverged from (and
// could not even produce) the real seal hash.

import { describe, expect, it } from "vitest";
import {
  generateKeypair,
  generateOotleAddress,
  generateOotleSecretKey,
  hashUnsignedTransaction,
  ootlePublicKeyFromSecretKey,
} from "@tari-project/ootle-wasm";
import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { Network } from "../network";
import { serializeUnsignedTx } from "../transaction";
import { WasmStealthCrypto } from "../stealth/wasm-crypto";
import { createOutput, Mask } from "../stealth/primitives";
import { StealthTransferStatement } from "../stealth/statements";
import { signBalanceProof } from "../stealth/balance-proof";
import { statementAsWire } from "../stealth/instruction";
import { InlineEphemeralSigner } from "./fake-signer";

const RESOURCE = "resource_" + "a".repeat(64);

function realDestination(): string {
  const sk = generateOotleSecretKey();
  const pk = ootlePublicKeyFromSecretKey(sk.owner_key, sk.view_key);
  return generateOotleAddress(pk.owner_key, pk.view_key, Network.LocalNet);
}

async function stealthTx(): Promise<UnsignedTransactionV1> {
  const crypto = new WasmStealthCrypto(Network.LocalNet);
  const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
    [createOutput({ destination: realDestination(), amount: 1000n, resourceAddress: RESOURCE })],
    400n,
  );
  const inputsStatement = await crypto.buildInputsStatement([], 1400n);
  const balanceProof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
  const statement = new StealthTransferStatement(inputsStatement, outputsStatement, balanceProof);
  return {
    network: Network.LocalNet,
    fee_instructions: [],
    instructions: [
      {
        StealthTransfer: {
          resource_address_ref: { Address: RESOURCE },
          statement: statementAsWire(statement),
          revealed_input_bucket: null,
        },
      },
    ],
    inputs: [],
    min_epoch: null,
    max_epoch: 100,
    dry_run: false,
    is_seal_signer_authorized: false,
    blobs: [],
    nonce: 0,
  } as UnsignedTransactionV1;
}

describe("fake signer stealth hashing (real WASM)", () => {
  it("hashes the serializeUnsignedTx form, so a stealth-fragment tx signs cleanly", async () => {
    const tx = await stealthTx();
    const sealPub = generateKeypair().public_key;

    // The fake signer signs over the same serialization the seal step hashes.
    const sigs = await InlineEphemeralSigner.generate().signTransaction(tx, sealPub);
    expect(sigs).toHaveLength(1);

    // The engine accepts the serializeUnsignedTx form (object-typed statement)...
    expect(() => hashUnsignedTransaction(serializeUnsignedTx(tx), sealPub)).not.toThrow();
    // ...and rejects the old `JSON.stringify` form (string-typed `__ootleRawJson` statement),
    // which is why hashing that diverged from the real seal hash.
    expect(() => hashUnsignedTransaction(JSON.stringify(tx), sealPub)).toThrow();
  });
});
