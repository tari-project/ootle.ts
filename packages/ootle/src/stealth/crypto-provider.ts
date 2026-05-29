//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { Mask, Output, DecryptedData } from "./primitives";
import type {
  StealthInput,
  BalanceProofSignature,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
} from "./statements";

/**
 * The single seam that hides all `@tari-project/ootle-wasm` crypto behind a
 * typed, byte/bigint interface returning the SDK's domain types.
 *
 * Every higher layer depends on **this interface**, never on raw WASM, so
 * tests can inject a {@link FakeStealthCrypto fake}. The only real
 * implementation is {@link WasmStealthCrypto}.
 *
 * All methods are **async even though the WASM is synchronous** to leave room
 * for a future off-thread / worker-backed provider without churning call sites.
 */
export interface StealthCryptoProvider {
  /**
   * Build the outputs (sender) side of a transfer: one witness per spec, aggregated
   * into a canonical WASM outputs-statement plus the summed output mask.
   *
   * @param specs - The outputs to create (incl. change).
   * @param revealedOutputAmount - The un-confidential (revealed) µTari output amount.
   * @returns The WASM-produced {@link StealthOutputsStatement} and the aggregated
   *   `outputMask` for the balance proof.
   */
  generateOutputsStatement(
    specs: Output[],
    revealedOutputAmount: bigint,
  ): Promise<{ statement: StealthOutputsStatement; outputMask: Mask }>;

  /**
   * Build the inputs (spend) side of a transfer as canonical WASM wire JSON.
   *
   * @param inputs - The stealth inputs being spent (empty for a revealed-only spend).
   * @param revealedAmount - The un-confidential (revealed) µTari input amount.
   * @returns A {@link StealthInputsStatement} carrying the WASM-produced `statementJson`.
   */
  buildInputsStatement(inputs: StealthInput[], revealedAmount: bigint): Promise<StealthInputsStatement>;

  /**
   * Sign the balance proof over the two statements' canonical wire JSONs.
   *
   * A transfer with **no stealth inputs** passes `inputMask = Mask.zero()`.
   *
   * @returns The `(public_nonce, signature)` balance-proof signature.
   */
  generateBalanceProofSignature(
    inputMask: Mask,
    outputMask: Mask,
    inputsStatementJson: string,
    outputsStatementJson: string,
  ): Promise<BalanceProofSignature>;

  /**
   * Optional client-side pre-flight check of a balance-proof signature. The
   * engine is authoritative at submission — implement as a cheap debug aid only.
   */
  validateBalanceProofSignature?(
    proof: BalanceProofSignature,
    inputsStatementJson: string,
    outputsStatementJson: string,
  ): Promise<boolean>;

  /**
   * Derive the 32-byte AEAD encryption key for an output's encrypted data via DH+KDF.
   *
   * - Receivers: `(viewSecret, sender_public_nonce)`.
   * - Senders: `(sender_secret_nonce, recipient_view_pub)`.
   *
   * Split from {@link unblindOutput} to mirror the WASM (`encryptedDataDhKdfAead` then
   * `unblindOutput`).
   */
  deriveAeadKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array>;

  /**
   * Decrypt an owned output using a precomputed AEAD key (from {@link deriveAeadKey}).
   *
   * **Throws** on AEAD failure / commitment mismatch — i.e. the output is *not owned*.
   * The receive helper catches this to mean "skip this UTXO".
   *
   * @param commitment - The output's 32-byte Pedersen commitment (from its substate id).
   * @param encryptedData - The raw ciphertext bytes.
   * @param aeadKey - The 32-byte AEAD key from {@link deriveAeadKey}.
   * @param skipMemo - When `true`, the memo is not decrypted.
   */
  unblindOutput(
    commitment: Uint8Array,
    encryptedData: Uint8Array,
    aeadKey: Uint8Array,
    skipMemo: boolean,
  ): Promise<DecryptedData>;

  /**
   * Aggregate input commitment masks into a single scalar. `masks` must be
   * non-empty; the revealed-only case (no stealth inputs) must short-circuit
   * to `Mask.zero()` at the caller instead of calling this method.
   */
  aggregateInputMasks(masks: Mask[]): Promise<Mask>;

  /**
   * Derive the one-time stealth spend scalar (`c + k`) via DH for an owned stealth UTXO.
   *
   * @param networkByte - The network byte (see `Network`).
   * @param ownerSecret - The owner's secret key.
   * @param publicNonce - The output's sender public nonce.
   * @returns The 32-byte spend scalar.
   */
  stealthDhSecret(networkByte: number, ownerSecret: Uint8Array, publicNonce: Uint8Array): Promise<Uint8Array>;

  /**
   * Structurally validate a complete transfer envelope (balance proof filled). **Throws**
   * on invalid. This is a client pre-flight (`view_key = null`); the engine is
   * authoritative for viewable-resource validation at submission.
   */
  validateTransfer(statement: StealthTransferStatement): Promise<void>;
}
