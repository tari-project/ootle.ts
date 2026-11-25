//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-backed tests for `generateOutputsStatement`: the statement it returns must balance
// under the real crypto (revealed input = ∑ stealth outputs + revealed output). The fake
// seam in wallet-helpers.send.test.ts only checks the wiring.

import { describe, expect, it } from "vitest";
import { generateOotleSecretKey, ootlePublicKeyFromSecretKey, generateOotleAddress } from "@tari-project/ootle-wasm";
import { Network } from "../network";
import { WasmStealthCrypto } from "./wasm-crypto";
import { generateOutputsStatement } from "./wallet-helpers";
import { signBalanceProof } from "./balance-proof";
import { Mask, createOutput, type Output } from "./primitives";
import { StealthTransferStatement } from "./statements";

const RESOURCE_ADDRESS = "resource_0000000000000000000000000000000000000000000000000000000000000000";

/** A throwaway recipient: its owner public key and the Ootle address derived from it. */
function makeRecipient(): { ownerPublicKey: Uint8Array; address: string } {
  const secrets = generateOotleSecretKey();
  const pub = ootlePublicKeyFromSecretKey(secrets.owner_key, secrets.view_key);
  const address = generateOotleAddress(pub.owner_key, pub.view_key, Network.LocalNet);
  return { ownerPublicKey: pub.owner_key, address };
}

function makeOutput(address: string, amount: bigint): Output {
  return createOutput({ destination: address, amount, resourceAddress: RESOURCE_ADDRESS });
}

describe("generateOutputsStatement (WASM)", () => {
  it("returns a statement that validates with no revealed output", async () => {
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const { address } = makeRecipient();

    const statement = await generateOutputsStatement(crypto, [makeOutput(address, 1_000n)], null);

    expect(statement.inputsStatement.revealedAmount).toBe(1_000n);
    await expect(crypto.validateTransfer(statement)).resolves.toBeUndefined();
  });

  it("returns a statement that validates with a revealed output", async () => {
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const recipient = makeRecipient();
    const specs = [makeOutput(recipient.address, 1_000n), makeOutput(recipient.address, 2_000n)];
    const revealed = { amount: 250n, receiver: recipient.ownerPublicKey };

    const statement = await generateOutputsStatement(crypto, specs, revealed);

    expect(statement.inputsStatement.revealedAmount).toBe(3_250n);
    await expect(crypto.validateTransfer(statement)).resolves.toBeUndefined();
  });

  it("would fail validation with a zero revealed input amount", async () => {
    // Pins the bug the helper used to have: with no stealth inputs, a zero revealed
    // input amount cannot balance a non-zero output.
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const { address } = makeRecipient();
    const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
      [makeOutput(address, 1_000n)],
      null,
    );
    const inputsStatement = await crypto.buildInputsStatement([], 0n);
    const proof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);

    const unbalanced = new StealthTransferStatement(inputsStatement, outputsStatement, proof);

    await expect(crypto.validateTransfer(unbalanced)).rejects.toThrow();
  });
});
