//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Real-WASM test pinning the load-bearing statement-encoding decision in `instruction.ts`.
//
// The native `StealthTransfer` instruction's `statement` field must be a STRUCTURED OBJECT
// (not a string) for the engine to deserialise the transaction. This test builds a real
// WASM-backed `StealthTransferStatement`, encodes the instruction via `statementAsWire`,
// embeds it in a minimal `UnsignedTransactionV1`, and proves the engine's
// `hashUnsignedTransaction` deserialiser accepts it. A string-typed statement is rejected
// (asserted here too) — that is exactly why `statementAsWire` parses the compact JSON into
// an object at its single seam.

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
import { WasmStealthCrypto } from "./wasm-crypto";
import { createOutput } from "./primitives";
import { Mask } from "./primitives";
import { StealthTransferStatement } from "./statements";
import { signBalanceProof } from "./balance-proof";
import { statementAsWire } from "./instruction";

const RESOURCE = "resource_" + "a".repeat(64);

function realDestination(): string {
  const sk = generateOotleSecretKey();
  const pk = ootlePublicKeyFromSecretKey(sk.owner_key, sk.view_key);
  return generateOotleAddress(pk.owner_key, pk.view_key, Network.LocalNet);
}

async function realStatement(): Promise<StealthTransferStatement> {
  const crypto = new WasmStealthCrypto(Network.LocalNet);
  const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
    [createOutput({ destination: realDestination(), amount: 1000n, resourceAddress: RESOURCE })],
    400n,
  );
  const inputsStatement = await crypto.buildInputsStatement([], 1400n);
  const balanceProof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
  return new StealthTransferStatement(inputsStatement, outputsStatement, balanceProof);
}

/** Minimal tx carrying only the stealth instruction (no un-parseable resource Literals). */
function txWithStatement(statement: unknown): UnsignedTransactionV1 {
  return {
    network: Network.LocalNet,
    fee_instructions: [],
    instructions: [
      {
        StealthTransfer: {
          resource_address_ref: { Address: RESOURCE },
          // `unknown` cast: this test deliberately exercises both the object and string forms.
          statement: statement as never,
          revealed_input_bucket: { id: 0, offset: null },
        },
      },
    ],
    inputs: [],
    min_epoch: null,
    max_epoch: null,
    dry_run: false,
    is_seal_signer_authorized: false,
  };
}

describe("stealth instruction statement encoding (real WASM)", () => {
  it("statementAsWire produces a structured object the engine deserialises", async () => {
    const statement = await realStatement();
    const wire = statementAsWire(statement);

    // It is a structured object, byte-exact to the canonical compact JSON.
    expect(typeof wire).toBe("object");
    expect(wire).toEqual(JSON.parse(statement.toCompactJson()));

    // The engine's tx deserialiser accepts it.
    const kp = generateKeypair();
    const tx = txWithStatement(wire);
    const hash = hashUnsignedTransaction(JSON.stringify(tx), kp.public_key);
    expect(hash).toHaveLength(64);
  });

  it("a string-typed statement is rejected by the engine (why we encode an object)", async () => {
    const statement = await realStatement();
    const kp = generateKeypair();
    // Embed the compact JSON STRING directly (the legacy stub's shape) — must throw.
    const tx = txWithStatement(statement.toCompactJson());
    expect(() => hashUnsignedTransaction(JSON.stringify(tx), kp.public_key)).toThrow();
  });
});
