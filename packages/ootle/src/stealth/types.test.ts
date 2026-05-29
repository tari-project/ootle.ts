//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { describe, expect, it } from "vitest";
import {
  BalanceProofSignature,
  createOutput,
  DEFAULT_PAY_TO,
  EncryptedData,
  Mask,
  SCALAR_LENGTH,
  StealthInput,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
} from "./types";

/** Deterministic n-byte buffer for tests. */
function bytes(n: number, fill = 1): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (fill + i) & 0xff;
  return a;
}

describe("Mask", () => {
  it("round-trips via fromHex/toHex", () => {
    const m = new Mask(bytes(SCALAR_LENGTH, 7));
    expect(Mask.fromHex(m.toHex()).toHex()).toBe(m.toHex());
  });

  it("zero() is 32 zero bytes", () => {
    const z = Mask.zero();
    expect(z.toBytes()).toEqual(new Uint8Array(SCALAR_LENGTH));
    expect(z.toHex()).toBe("00".repeat(SCALAR_LENGTH));
  });

  it("rejects non-32-byte input in constructor and fromHex with a field-named message", () => {
    expect(() => new Mask(bytes(31))).toThrow(/Mask must be 32 bytes, got 31/);
    expect(() => new Mask(bytes(33))).toThrow(/Mask must be 32 bytes, got 33/);
    expect(() => Mask.fromHex("ab".repeat(31))).toThrow(/Mask must be 32 bytes/);
  });

  it("defensively copies its bytes", () => {
    const src = bytes(SCALAR_LENGTH, 3);
    const m = new Mask(src);
    src[0] = 0xff;
    expect(m.toBytes()[0]).not.toBe(0xff);
    const out = m.toBytes();
    out[0] = 0xff;
    expect(m.toBytes()[0]).not.toBe(0xff);
  });
});

describe("EncryptedData", () => {
  it("round-trips variable-length bytes via hex", () => {
    const e = new EncryptedData(bytes(48, 2));
    expect(EncryptedData.fromHex(e.toHex()).toHex()).toBe(e.toHex());
  });
});

describe("createOutput", () => {
  it("applies defaults for payTo and minimumValuePromise", () => {
    const o = createOutput({ destination: "account_abc", amount: 100n, resourceAddress: "resource_xyz" });
    expect(o.payTo).toEqual(DEFAULT_PAY_TO);
    expect(o.payTo).toEqual({ StealthPublicKey: {} });
    expect(o.minimumValuePromise).toBe(0n);
  });

  it("preserves explicit payTo and minimumValuePromise", () => {
    const payTo = { AccessRule: { foo: "bar" } };
    const o = createOutput({
      destination: "account_abc",
      amount: 100n,
      resourceAddress: "resource_xyz",
      payTo,
      minimumValuePromise: 50n,
    });
    expect(o.payTo).toBe(payTo);
    expect(o.minimumValuePromise).toBe(50n);
  });

  it("rejects amount <= 0n", () => {
    expect(() => createOutput({ destination: "a", amount: 0n, resourceAddress: "r" })).toThrow();
    expect(() => createOutput({ destination: "a", amount: -1n, resourceAddress: "r" })).toThrow();
  });

  it("defensively copies resourceViewKey so source mutation can't alter the output", () => {
    const viewKey = bytes(SCALAR_LENGTH, 4);
    const o = createOutput({ destination: "a", amount: 1n, resourceAddress: "r", resourceViewKey: viewKey });
    viewKey[0] = 0xff;
    expect(o.resourceViewKey?.[0]).not.toBe(0xff);
  });

  it("leaves resourceViewKey undefined when not supplied", () => {
    const o = createOutput({ destination: "a", amount: 1n, resourceAddress: "r" });
    expect(o.resourceViewKey).toBeUndefined();
  });
});

describe("StealthInput", () => {
  it("round-trips toJSON/fromJSON", () => {
    const input = new StealthInput(bytes(SCALAR_LENGTH, 5));
    const back = StealthInput.fromJSON(input.toJSON());
    expect(back.toJSON()).toEqual(input.toJSON());
    expect(back.commitment).toEqual(input.commitment);
  });

  it("rejects non-32-byte commitment with a field-named message", () => {
    expect(() => new StealthInput(bytes(16))).toThrow(/StealthInput\.commitment must be 32 bytes, got 16/);
  });

  it("commitment getter returns a defensive copy each call", () => {
    const input = new StealthInput(bytes(SCALAR_LENGTH, 5));
    const first = input.commitment;
    first[0] = 0xff;
    const second = input.commitment;
    expect(second[0]).not.toBe(0xff);
    // Each call returns a fresh array (so mutation can't be observed across calls).
    expect(first).not.toBe(second);
  });

  it("defensively copies the constructor input", () => {
    const src = bytes(SCALAR_LENGTH, 5);
    const input = new StealthInput(src);
    src[0] = 0xff;
    expect(input.commitment[0]).not.toBe(0xff);
  });
});

describe("BalanceProofSignature", () => {
  it("round-trips toJSON/fromJSON with snake_case wire keys", () => {
    const sig = new BalanceProofSignature(bytes(SCALAR_LENGTH, 1), bytes(SCALAR_LENGTH, 9));
    const json = sig.toJSON();
    expect(Object.keys(json)).toEqual(["public_nonce", "signature"]);
    const back = BalanceProofSignature.fromJSON(json);
    expect(back.toJSON()).toEqual(json);
  });

  it("rejects non-32-byte fields with a field-named message", () => {
    expect(() => new BalanceProofSignature(bytes(31), bytes(SCALAR_LENGTH))).toThrow(
      /BalanceProofSignature\.publicNonce must be 32 bytes, got 31/,
    );
    expect(() => new BalanceProofSignature(bytes(SCALAR_LENGTH), bytes(33))).toThrow(
      /BalanceProofSignature\.signature must be 32 bytes, got 33/,
    );
  });

  it("publicNonce / signature getters return defensive copies each call", () => {
    const sig = new BalanceProofSignature(bytes(SCALAR_LENGTH, 1), bytes(SCALAR_LENGTH, 9));
    const firstNonce = sig.publicNonce;
    firstNonce[0] = 0xff;
    const secondNonce = sig.publicNonce;
    expect(secondNonce[0]).not.toBe(0xff);

    const firstSig = sig.signature;
    firstSig[0] = 0xff;
    const secondSig = sig.signature;
    expect(secondSig[0]).not.toBe(0xff);
  });

  it("defensively copies the constructor inputs", () => {
    const nonce = bytes(SCALAR_LENGTH, 1);
    const signature = bytes(SCALAR_LENGTH, 9);
    const sig = new BalanceProofSignature(nonce, signature);
    nonce[0] = 0xff;
    signature[0] = 0xff;
    expect(sig.publicNonce[0]).not.toBe(0xff);
    expect(sig.signature[0]).not.toBe(0xff);
  });
});

describe("StealthInputsStatement", () => {
  it("revealedOnly() has empty inputs and the given amount", () => {
    const s = StealthInputsStatement.revealedOnly(777n);
    expect(s.inputs).toEqual([]);
    expect(s.revealedAmount).toBe(777n);
    expect(s.statementJson).toBeUndefined();
  });

  it("serialises revealedAmount as a decimal string and round-trips", () => {
    const s = new StealthInputsStatement([new StealthInput(bytes(SCALAR_LENGTH, 2))], 1234n);
    const json = s.toJSON();
    expect(json.revealed_amount).toBe("1234");
    const back = StealthInputsStatement.fromJSON(json);
    expect(back.revealedAmount).toBe(1234n);
    expect(back.inputs[0].commitment).toEqual(s.inputs[0].commitment);
  });

  it("rejects an empty/whitespace revealed_amount instead of decoding it as 0n", () => {
    // BigInt("") and BigInt("  ") both return 0n silently — guard against that footgun.
    expect(() => StealthInputsStatement.fromJSON({ inputs: [], revealed_amount: "" })).toThrow();
    expect(() => StealthInputsStatement.fromJSON({ inputs: [], revealed_amount: "   " })).toThrow();
  });
});

describe("StealthOutputsStatement", () => {
  it("carries the WASM-produced wire JSON verbatim and round-trips", () => {
    const wire = '{"outputs":[{"a":1}],"revealed":"0"}';
    const s = StealthOutputsStatement.fromJSON(wire);
    expect(s.toJSON()).toBe(wire);
    expect(s.statementJson).toBe(wire);
    expect(s.parsed()).toEqual({ outputs: [{ a: 1 }], revealed: "0" });
  });
});

describe("StealthTransferStatement", () => {
  const outputsWire = '{"outputs":[],"revealed":"0"}';

  function buildEnvelope(withProof: boolean): StealthTransferStatement {
    const inputs = StealthInputsStatement.revealedOnly(500n);
    const outputs = StealthOutputsStatement.fromJSON(outputsWire);
    const proof = withProof ? new BalanceProofSignature(bytes(SCALAR_LENGTH, 1), bytes(SCALAR_LENGTH, 2)) : undefined;
    return new StealthTransferStatement(inputs, outputs, proof);
  }

  it("round-trips structural toJSON/fromJSON with balanceProof present", () => {
    const env = buildEnvelope(true);
    const json = env.toJSON();
    expect(json.balance_proof).toBeDefined();
    // outputs is carried as the raw wire string, not a parsed object.
    expect(json.outputs).toBe(outputsWire);
    expect(json.inputs).toEqual({ inputs: [], revealed_amount: "500" });
    const back = StealthTransferStatement.fromJSON(json);
    expect(back.inputsStatement.revealedAmount).toBe(500n);
    expect(back.outputsStatement.statementJson).toBe(outputsWire);
    expect(back.outputsStatement.parsed()).toEqual({ outputs: [], revealed: "0" });
    expect(back.balanceProof?.toJSON()).toEqual(env.balanceProof?.toJSON());
    // Full structural round-trip is identical.
    expect(back.toJSON()).toEqual(json);
  });

  it("round-trips structural toJSON/fromJSON with balanceProof undefined (omitted key)", () => {
    const env = buildEnvelope(false);
    const json = env.toJSON();
    expect("balance_proof" in json).toBe(false);
    const back = StealthTransferStatement.fromJSON(json);
    expect(back.balanceProof).toBeUndefined();
    expect(back.inputsStatement.revealedAmount).toBe(500n);
    expect(back.toJSON()).toEqual(json);
  });

  it("toCompactJson() emits no whitespace and embeds the raw outputs fragment", () => {
    const env = buildEnvelope(true);
    const compact = env.toCompactJson();
    expect(compact).not.toMatch(/\s/);
    // The raw WASM outputs fragment is embedded verbatim, keyed `outputs_statement`
    // (the engine-verified wire key — see toCompactJson docs).
    expect(compact).toContain(`"outputs_statement":${outputsWire}`);
    // For the revealed-only case (no cached WASM inputs string) the inputs fragment
    // is the JSON.stringify of the structural inputs view, keyed `inputs_statement`.
    expect(compact).toContain('"inputs_statement":{"inputs":[],"revealed_amount":"500"}');
  });

  it("toCompactJson() embeds the cached WASM inputs statementJson byte-exact", () => {
    const inputs = StealthInputsStatement.revealedOnly(0n);
    inputs.statementJson = '{"wasm":"inputs","revealed_amount":"0"}';
    const env = new StealthTransferStatement(inputs, StealthOutputsStatement.fromJSON(outputsWire));
    const compact = env.toCompactJson();
    expect(compact).toContain('"inputs_statement":{"wasm":"inputs","revealed_amount":"0"}');
  });

  it("toCompactJson() throws when the inputs fragment is not a JSON object", () => {
    const inputs = StealthInputsStatement.revealedOnly(0n);
    inputs.statementJson = "not-json";
    const env = new StealthTransferStatement(inputs, StealthOutputsStatement.fromJSON(outputsWire));
    expect(() => env.toCompactJson()).toThrow(/inputs_statement fragment is not a JSON object/);
  });

  it("toCompactJson() throws when the outputs fragment is not a JSON object", () => {
    const inputs = StealthInputsStatement.revealedOnly(0n);
    const env = new StealthTransferStatement(inputs, StealthOutputsStatement.fromJSON("[malformed"));
    expect(() => env.toCompactJson()).toThrow(/outputs_statement fragment is not a JSON object/);
  });

  it("toCompactJson() preserves large u64 amounts in the WASM fragments byte-for-byte", () => {
    // u64 max (18446744073709551615) exceeds Number.MAX_SAFE_INTEGER (2^53 - 1), so a
    // JSON.parse -> number -> re-stringify round-trip would silently corrupt it. The
    // signed wire form must carry the WASM fragment verbatim. Note these are RAW u64
    // numbers in the WASM JSON (not quoted strings), exactly as WASM emits them.
    const bigU64 = "18446744073709551615";
    const inputsWire = `{"inputs":[],"revealed_amount":${bigU64},"some_commit":"deadbeef"}`;
    const outputsBig = `{"outputs":[{"amount":${bigU64},"mask":"abc"}],"revealed":${bigU64}}`;

    const inputs = StealthInputsStatement.revealedOnly(0n);
    inputs.statementJson = inputsWire;
    const outputs = StealthOutputsStatement.fromJSON(outputsBig);
    const env = new StealthTransferStatement(inputs, outputs);

    const compact = env.toCompactJson();
    // Both fragments survive verbatim — the exact large-u64 substring is present.
    expect(compact).toContain(`"amount":${bigU64}`);
    expect(compact).toContain(`"revealed":${bigU64}`);
    expect(compact).toContain(`"inputs_statement":${inputsWire}`);
    expect(compact).toContain(`"outputs_statement":${outputsBig}`);
    // And the assembled envelope is exactly the concatenation we expect.
    expect(compact).toBe(`{"inputs_statement":${inputsWire},"outputs_statement":${outputsBig}}`);
    // Sanity: a naive JSON.parse round-trip WOULD have corrupted the u64 (proves the
    // byte-exact path is necessary, not theoretical).
    expect(String(JSON.parse(compact).outputs_statement.outputs[0].amount)).not.toBe(bigU64);
  });
});
