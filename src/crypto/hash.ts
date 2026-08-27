import { sha256 } from "@noble/hashes/sha2.js";

import { canonicalBytes } from "./canonical";

/**
 * SHA-256 everywhere. One hash, one encoding, no exceptions.
 *
 * Section 17 of the specification asks for a modern hash and forbids invented
 * constructions. The only construction anywhere in this system is the domain
 * separation on Merkle nodes, which is a standard defence (RFC 6962) and is
 * documented where it happens rather than here.
 */

export const HASH_ALGORITHM = "SHA-256";

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Hex string has an odd length.");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("Hex string contains a non-hex character.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function hashBytes(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

/** Hash of the canonical form of a value. This is a receipt payload hash. */
export function hashCanonical(value: unknown): string {
  return hashBytes(canonicalBytes(value));
}

export { sha256 };
