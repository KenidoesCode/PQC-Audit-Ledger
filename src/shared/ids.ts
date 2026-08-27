import { randomBytes } from "node:crypto";

export type IdPrefix =
  | "rcp" // audit receipt
  | "int" // buyer intent
  | "act" // agent action
  | "tcl" // tool call
  | "ath" // payment authority
  | "pol" // policy version
  | "ord" // simulated order
  | "pay" // simulated payment
  | "whk" // webhook event
  | "key" // signing key
  | "mrk" // merkle batch
  | "evr" // evaluation run
  | "rev" // human review
  | "cor"; // correlation

// Crockford-style: no i, l, o, u. These identifiers get read aloud in an
// incident call, so ambiguous glyphs are a real cost.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function suffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return out;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${Date.now().toString(36).padStart(9, "0")}${suffix(10)}`;
}

export function newCorrelationId(): string {
  return newId("cor");
}

/** Deterministic id from a key, so a fixed seed reproduces a fixed corpus. */
export function deterministicId(prefix: IdPrefix, key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `${prefix}_${slug}`;
}
