import { InvalidArgumentError } from "../errors";

// TODO - this can be removed when typescript v6 comes out
export function toHexStr(uint8: Uint8Array): string {
  return Array.from(uint8, (b) => b.toString(16).padStart(2, "0")).join("");
}

const HEX_PATTERN = /^[0-9a-fA-F]*$/;

/**
 * Decodes a hex string into bytes.
 *
 * Strict: rejects odd-length input and any character outside `[0-9a-fA-F]`.
 * Returns an empty `Uint8Array` for an empty input.
 *
 * @throws {InvalidArgumentError} if `hex` has odd length or contains non-hex characters.
 */
export function fromHexStr(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new InvalidArgumentError(`fromHexStr: hex string must have even length, got ${hex.length}`);
  }
  if (!HEX_PATTERN.test(hex)) {
    throw new InvalidArgumentError(`fromHexStr: hex string contains non-hex characters`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
