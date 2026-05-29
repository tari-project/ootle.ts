//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import type { Signer } from "./signer";
import { DefaultSignerNotSetError, KeyProviderNotFoundError } from "./errors";

/**
 * The result of authorizing a transaction: a set of signatures from one signer.
 * Mirrors `TransactionAuthorization` from the Rust ootle-rs crate.
 */
export interface TransactionAuthorization {
  signerAddress: string;
  signatures: TransactionSignature[];
}

/**
 * A wallet that manages multiple key providers (one per component address) and
 * can sign transactions on behalf of any registered signer.
 *
 * Mirrors `OotleWallet` from the Rust ootle-rs crate.
 *
 * @example
 * ```ts
 * const wallet = new OotleWallet();
 * wallet.registerKeyProvider(myAddress, mySecretKeyWallet);
 * wallet.setDefaultSigner(myAddress);
 *
 * const signed = await wallet.authorizeTransaction(unsignedTx);
 * ```
 */
export class OotleWallet implements Signer {
  private keyProviders: Map<string, Signer>;
  private defaultSignerAddress: string | null = null;

  constructor() {
    this.keyProviders = new Map();
  }

  /**
   * Registers a key provider (a `Signer`) for the given component address.
   *
   * Stealth capabilities (`getViewSecret`/`addStealthSignature`) are optional methods on
   * `Signer` (see {@link Signer}); the stealth spend authorizer uses them when present.
   */
  public registerKeyProvider(address: string, provider: Signer): this {
    this.keyProviders.set(address, provider);
    return this;
  }

  /**
   * Sets the address used when `signTransaction` is called without specifying a signer.
   *
   * @throws {KeyProviderNotFoundError} when no key provider has been registered for
   *   `address`.
   */
  public setDefaultSigner(address: string): this {
    this.requireKeyProvider(address, "explicit");
    this.defaultSignerAddress = address;
    return this;
  }

  /**
   * Returns the default signer address, or throws if none is set.
   *
   * @throws {DefaultSignerNotSetError} when no default signer is configured.
   */
  public async getAddress(): Promise<string> {
    if (!this.defaultSignerAddress) {
      throw new DefaultSignerNotSetError("No default signer address set. Call setDefaultSigner() first.");
    }
    return Promise.resolve(this.defaultSignerAddress);
  }

  /**
   * @throws {DefaultSignerNotSetError} when no default signer is configured.
   * @throws {KeyProviderNotFoundError} when the default address has no registered provider.
   */
  public async getPublicKey(): Promise<Uint8Array> {
    return this.getSignerOrThrow().getPublicKey();
  }

  /**
   * Signs using the default signer.
   *
   * @throws {DefaultSignerNotSetError} when no default signer is configured.
   * @throws {KeyProviderNotFoundError} when the default address has no registered provider.
   */
  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    return this.getSignerOrThrow().signTransaction(unsignedTx, sealPublicKey);
  }

  /**
   * Generates `TransactionAuthorization` (signatures) for a specific registered signer.
   * Mirrors `OotleWallet::authorize_transaction` from ootle-rs.
   *
   * @throws {KeyProviderNotFoundError} when no provider is registered for `signerAddress`.
   */
  public async authorizeTransaction(
    signerAddress: string,
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionAuthorization> {
    const provider = this.requireKeyProvider(signerAddress, "explicit");
    const signatures = await provider.signTransaction(unsignedTx, sealPublicKey);
    return { signerAddress, signatures };
  }

  /**
   * Collects authorizations from all registered key providers.
   * Useful when a transaction requires multiple signers.
   */
  public async authorizeTransactionAll(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionAuthorization[]> {
    return Promise.all(
      [...this.keyProviders.keys()].map((addr) => this.authorizeTransaction(addr, unsignedTx, sealPublicKey)),
    );
  }

  /**
   * Returns the key provider for a specific address, if registered.
   */
  public getKeyProvider(address: string): Signer | undefined {
    return this.keyProviders.get(address);
  }

  /**
   * Returns all registered signer addresses.
   */
  public getSignerAddresses(): string[] {
    return [...this.keyProviders.keys()];
  }

  private getSignerOrThrow(): Signer {
    if (!this.defaultSignerAddress) {
      throw new DefaultSignerNotSetError("No default signer address set. Call setDefaultSigner() first.");
    }
    return this.requireKeyProvider(this.defaultSignerAddress, "default");
  }

  private requireKeyProvider(address: string, hint: "default" | "explicit"): Signer {
    const provider = this.keyProviders.get(address);
    if (provider === undefined) {
      throw new KeyProviderNotFoundError(
        hint === "default"
          ? `No key provider registered for default address: ${address}. ` +
              `Call wallet.registerKeyProvider(address, signer) for that address, ` +
              `or pick a different default with setDefaultSigner(otherAddress).`
          : `No key provider registered for address: ${address}. ` +
              `Call wallet.registerKeyProvider(${JSON.stringify(address)}, signer) before signing.`,
        { address },
      );
    }
    return provider;
  }
}
