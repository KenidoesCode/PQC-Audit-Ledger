import { AppError } from "../shared/errors";

/**
 * Canonical serialization (JCS, RFC 8785 subset).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * JSON.stringify is not a signing format. Two objects that are equal to every
 * consumer can serialize to different bytes -- key insertion order differs, a
 * number round-trips as 1e21 instead of its digits, a value is undefined here
 * and absent there. Sign one and verify the other and you get a cryptographic
 * failure that has nothing to do with tampering, which is the worst possible
 * failure mode: it trains people to ignore signature errors.
 *
 * So the bytes are pinned here, once, and every hash and every signature in
 * this system is taken over the output of this function.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 * ---------------------------------------------------------------------------
 *  1. Object keys sort by UTF-16 code unit, ascending -- what RFC 8785
 *     specifies and what a default Array sort already does.
 *  2. No insignificant whitespace anywhere.
 *  3. Arrays keep their order. Order is data.
 *  4. null is serialized. undefined is REJECTED rather than dropped, because
 *     dropping it lets the signer and the verifier disagree about whether a
 *     field was ever there.
 *  5. Non-finite numbers are REJECTED. JSON cannot represent them and
 *     JSON.stringify silently turns them into null.
 *  6. Integers outside the exact-integer range are REJECTED. Amounts are minor
 *     units and must survive a round trip exactly; a value that cannot is a bug
 *     upstream, not something to quietly round here.
 *  7. Strings use the standard JSON escaping, which is already RFC 8785
 *     conformant for the BMP and for surrogate pairs.
 *  8. Output is UTF-8. Nothing downstream may re-encode it.
 *
 * A receipt is canonicalized ONCE, at signing time, and those exact bytes are
 * what get hashed, signed, chained and Merkle-leafed. The verifier re-derives
 * them from the stored receipt body and compares.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "undefined") {
    throw new AppError(
      "VALIDATION_FAILED",
      "Cannot canonicalize undefined at " +
        path +
        ". Use null for an explicitly absent value -- dropping the key would let the signer and the verifier disagree about whether the field existed.",
      { path },
    );
  }

  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new AppError("VALIDATION_FAILED", "Cannot canonicalize " + String(n) + " at " + path + ".", {
        path,
      });
    }
    if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Integer at " + path + " exceeds the exact-integer range and would not survive a round trip.",
        { path },
      );
    }
    // JSON already emits the shortest round-tripping representation of a
    // double, which is exactly what RFC 8785 requires.
    return JSON.stringify(n);
  }

  if (type === "string") return JSON.stringify(value);
  if (type === "boolean") return value ? "true" : "false";

  if (Array.isArray(value)) {
    return "[" + value.map((item, i) => serialize(item, path + "[" + i + "]")).join(",") + "]";
  }

  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return (
      "{" +
      entries.map(([key, item]) => JSON.stringify(key) + ":" + serialize(item, path + "." + key)).join(",") +
      "}"
    );
  }

  throw new AppError("VALIDATION_FAILED", "Cannot canonicalize " + type + " at " + path + ".", { path });
}

/** The canonical string form. Use canonicalBytes for anything cryptographic. */
export function canonicalize(value: unknown): string {
  return serialize(value, "$");
}

/** The exact bytes that get hashed and signed. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export const CANONICALIZATION = {
  name: "JCS",
  reference: "RFC 8785 (subset: no undefined, no non-finite numbers, no unsafe integers)",
  encoding: "UTF-8",
} as const;
