//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for `WalletDaemonSigner`. Stubs `WalletDaemonClient.usingFetchTransport`
// via `vi.spyOn` (the same pattern `indexer-provider.test.ts` uses for the indexer
// transport). Every test installs its own per-case stub in the `it` body so the
// behaviour the case wants is local — `beforeEach` is intentionally avoided here.

import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignerError } from "@tari-project/ootle";
import { WalletDaemonSigner } from "./wallet-daemon-signer";

interface StubDaemonClient {
  setToken: ReturnType<typeof vi.fn>;
  setReauthenticationEnabled: ReturnType<typeof vi.fn>;
  accountsGetDefault: ReturnType<typeof vi.fn>;
  sendRequest: ReturnType<typeof vi.fn>;
  authGetMethod: ReturnType<typeof vi.fn>;
  authRequest: ReturnType<typeof vi.fn>;
}

function defaultStubDaemonClient(overrides: Partial<StubDaemonClient> = {}): StubDaemonClient {
  return {
    setToken: vi.fn(),
    setReauthenticationEnabled: vi.fn(),
    accountsGetDefault: vi.fn(),
    sendRequest: vi.fn(),
    authGetMethod: vi.fn().mockResolvedValue({ method: "none" }),
    authRequest: vi.fn().mockResolvedValue("auto-token"),
    ...overrides,
  };
}

function installClient(client: StubDaemonClient): void {
  vi.spyOn(WalletDaemonClient, "usingFetchTransport").mockReturnValue(client as unknown as WalletDaemonClient);
}

/**
 * A canned `accountsGetDefault` response with the minimum fields
 * `fetchAccountInfo` reads. The public_key is a 64-char hex (32 bytes).
 */
const OWNER_PUBLIC_KEY_HEX = "ab".repeat(32);
const ACCOUNT_ADDRESS = "component_account_aaaa";

function accountsGetDefaultResponse() {
  return {
    account: { owner_public_key: OWNER_PUBLIC_KEY_HEX },
    address: ACCOUNT_ADDRESS,
  };
}

describe("WalletDaemonSigner.new", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs without calling the daemon, calls setToken, and does not start authentication", () => {
    const client = defaultStubDaemonClient();
    installClient(client);

    const signer = WalletDaemonSigner.new({ url: "http://localhost:18103", authToken: "prebaked-token" });

    expect(signer).toBeInstanceOf(WalletDaemonSigner);
    expect(client.setToken).toHaveBeenCalledWith("prebaked-token");
    expect(client.authGetMethod).not.toHaveBeenCalled();
    expect(client.accountsGetDefault).not.toHaveBeenCalled();
  });
});

describe("WalletDaemonSigner.connect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips authenticate when an authToken is supplied; calls setToken + fetchAccountInfo only", async () => {
    const client = defaultStubDaemonClient({
      accountsGetDefault: vi.fn().mockResolvedValue(accountsGetDefaultResponse()),
    });
    installClient(client);

    const signer = await WalletDaemonSigner.connect({ url: "http://localhost:18103", authToken: "user-token" });

    expect(client.setToken).toHaveBeenCalledWith("user-token");
    expect(client.authGetMethod).not.toHaveBeenCalled();
    expect(client.setReauthenticationEnabled).toHaveBeenCalledWith(true);
    expect(client.accountsGetDefault).toHaveBeenCalledTimes(1);
    expect(await signer.getAddress()).toBe(ACCOUNT_ADDRESS);
  });

  it("authenticates and threads the resulting token through setToken when no authToken is supplied", async () => {
    const client = defaultStubDaemonClient({
      accountsGetDefault: vi.fn().mockResolvedValue(accountsGetDefaultResponse()),
      authGetMethod: vi.fn().mockResolvedValue({ method: "none" }),
      authRequest: vi.fn().mockResolvedValue("freshly-issued-token"),
    });
    installClient(client);

    await WalletDaemonSigner.connect({ url: "http://localhost:18103" });

    expect(client.authGetMethod).toHaveBeenCalledTimes(1);
    expect(client.authRequest).toHaveBeenCalledTimes(1);
    expect(client.setToken).toHaveBeenCalledWith("freshly-issued-token");
    expect(client.setReauthenticationEnabled).toHaveBeenCalledWith(true);
    expect(client.accountsGetDefault).toHaveBeenCalledTimes(1);
  });
});

describe("WalletDaemonSigner.signTransaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The JRPC client encodes the JSON itself; we assert on the raw object passed,
  // not its JSON string form. (This site never hashes or BORs the transaction
  // client-side, so it does not flow through any serialiser.)
  it("forwards the unsigned tx and seal public key (hex) via sendRequest('transactions.sign')", async () => {
    const stubSignature = {
      public_key: "00".repeat(32),
      signature: { public_nonce: "11".repeat(32), signature: "22".repeat(32) },
    };
    const client = defaultStubDaemonClient({
      sendRequest: vi.fn().mockResolvedValue({ signatures: [stubSignature] }),
    });
    installClient(client);
    const signer = WalletDaemonSigner.new({ url: "http://localhost:18103", authToken: "t" });

    const unsignedTx = {
      /* shape doesn't matter — daemon-side */
    } as unknown as UnsignedTransactionV1;
    const sealPublicKey = new Uint8Array(32).fill(0xaa);
    const sigs = await signer.signTransaction(unsignedTx, sealPublicKey);

    expect(sigs).toEqual([stubSignature]);
    expect(client.sendRequest).toHaveBeenCalledTimes(1);
    expect(client.sendRequest).toHaveBeenCalledWith("transactions.sign", {
      transaction: unsignedTx,
      seal_public_key: "aa".repeat(32),
    });
  });

  it("rejects a non-32-byte seal public key without calling the daemon", async () => {
    const client = defaultStubDaemonClient({ sendRequest: vi.fn() });
    installClient(client);
    const signer = WalletDaemonSigner.new({ url: "http://localhost:18103", authToken: "t" });
    const unsignedTx = {} as unknown as UnsignedTransactionV1;

    await expect(signer.signTransaction(unsignedTx, new Uint8Array(31))).rejects.toThrow(/32 bytes/);
    expect(client.sendRequest).not.toHaveBeenCalled();
  });
});

describe("WalletDaemonSigner.fetchAccountInfo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("populates the cached public key and address from accountsGetDefault", async () => {
    const client = defaultStubDaemonClient({
      accountsGetDefault: vi.fn().mockResolvedValue(accountsGetDefaultResponse()),
    });
    installClient(client);
    const signer = WalletDaemonSigner.new({ url: "http://localhost:18103", authToken: "t" });

    await signer.fetchAccountInfo();
    const pub = await signer.getPublicKey();

    expect(await signer.getAddress()).toBe(ACCOUNT_ADDRESS);
    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub.length).toBe(32);
  });

  it("throws SignerError when the daemon response is missing owner_public_key", async () => {
    const client = defaultStubDaemonClient({
      accountsGetDefault: vi.fn().mockResolvedValue({ account: {}, address: ACCOUNT_ADDRESS }),
    });
    installClient(client);
    const signer = WalletDaemonSigner.new({ url: "http://localhost:18103", authToken: "t" });

    await expect(signer.fetchAccountInfo()).rejects.toThrow(SignerError);
    await expect(signer.fetchAccountInfo()).rejects.toThrow(/missing public_key or address/);
  });
});

describe("WalletDaemonSigner.getViewSecret", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects with SignerError carrying the canonical daemon-stealth-unsupported message", async () => {
    installClient(defaultStubDaemonClient());
    const signer = WalletDaemonSigner.new({ url: "http://localhost:18103", authToken: "t" });

    await expect(signer.getViewSecret()).rejects.toThrow(SignerError);
    await expect(signer.getViewSecret()).rejects.toThrow(/cannot export a view secret/);
  });
});
