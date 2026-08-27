import { describe, expect, it } from "vitest";

import { canonicalize, canonicalBytes } from "../src/crypto/canonical";
import { hashCanonical, toHex, fromHex } from "../src/crypto/hash";
import { keyPairFromSeed, sign, verify, SUITE } from "../src/crypto/mldsa";
import { buildProof, computeRoot, leafHash, nodeHash, verifyProof } from "../src/crypto/merkle";
import { sha256 } from "@noble/hashes/sha2.js";

const seed = sha256(new TextEncoder().encode("test-seed"));

describe("canonicalization", () => {
  it("is independent of key insertion order", () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { c: { y: 2, z: 1 }, a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it("keeps array order, because order is data", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes null and rejects undefined", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(() => canonicalize({ a: undefined })).toThrow(/undefined/);
  });

  it("rejects non-finite numbers rather than silently emitting null", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("rejects integers that would not survive a round trip", () => {
    expect(() => canonicalize({ a: 2 ** 60 })).toThrow(/exact-integer/);
  });

  it("produces UTF-8 bytes for non-ASCII content", () => {
    const bytes = canonicalBytes({ label: "a — b" });
    expect(new TextDecoder().decode(bytes)).toBe('{"label":"a — b"}');
  });

  it("gives a different hash for a one-paise difference", () => {
    expect(hashCanonical({ amountMinor: 89900 })).not.toBe(hashCanonical({ amountMinor: 89901 }));
  });
});

describe("hex", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });

  it("rejects malformed input rather than producing NaN bytes", () => {
    expect(() => fromHex("abc")).toThrow(/odd length/);
    expect(() => fromHex("zz")).toThrow(/non-hex/);
  });
});

describe("ML-DSA-65", () => {
  it("derives the same key from the same seed", () => {
    expect(keyPairFromSeed(seed).publicKeyHex).toBe(keyPairFromSeed(seed).publicKeyHex);
  });

  it("produces keys and signatures of the documented sizes", () => {
    const pair = keyPairFromSeed(seed);
    expect(fromHex(pair.publicKeyHex).length).toBe(SUITE.publicKeyBytes);
    expect(fromHex(pair.privateKeyHex).length).toBe(SUITE.privateKeyBytes);
    const signature = sign(new TextEncoder().encode("hello"), pair.privateKeyHex);
    expect(fromHex(signature).length).toBe(SUITE.signatureBytes);
  });

  it("verifies a signature over the exact message", () => {
    const pair = keyPairFromSeed(seed);
    const message = new TextEncoder().encode("hello");
    expect(verify(sign(message, pair.privateKeyHex), message, pair.publicKeyHex).valid).toBe(true);
  });

  it("rejects a signature over a different message", () => {
    const pair = keyPairFromSeed(seed);
    const signature = sign(new TextEncoder().encode("hello"), pair.privateKeyHex);
    const result = verify(signature, new TextEncoder().encode("hellp"), pair.publicKeyHex);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("SIGNATURE_INVALID");
  });

  it("rejects a wrong key and says so specifically", () => {
    const pair = keyPairFromSeed(seed);
    const other = keyPairFromSeed(sha256(new TextEncoder().encode("other")));
    const message = new TextEncoder().encode("hello");
    const result = verify(sign(message, pair.privateKeyHex), message, other.publicKeyHex);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("SIGNATURE_INVALID");
  });

  it("distinguishes a malformed key from a failed verification", () => {
    const pair = keyPairFromSeed(seed);
    const message = new TextEncoder().encode("hello");
    const signature = sign(message, pair.privateKeyHex);
    expect(verify(signature, message, "0f".repeat(10)).reason).toBe("PUBLIC_KEY_WRONG_LENGTH");
    expect(verify("0f".repeat(10), message, pair.publicKeyHex).reason).toBe("SIGNATURE_WRONG_LENGTH");
    expect(verify("zz", message, pair.publicKeyHex).reason).toBe("SIGNATURE_MALFORMED");
  });

  it("is hedged: two signatures over the same message differ and both verify", () => {
    const pair = keyPairFromSeed(seed);
    const message = new TextEncoder().encode("hello");
    const a = sign(message, pair.privateKeyHex);
    const b = sign(message, pair.privateKeyHex);
    expect(a).not.toBe(b);
    expect(verify(a, message, pair.publicKeyHex).valid).toBe(true);
    expect(verify(b, message, pair.publicKeyHex).valid).toBe(true);
  });
});

describe("merkle", () => {
  const hashes = Array.from({ length: 7 }, (_, i) => hashCanonical({ i }));

  it("separates leaf and node domains", () => {
    // If the prefixes were absent these two would be computable from each other,
    // which is the second-preimage attack the prefixes exist to prevent.
    expect(leafHash(hashes[0] as string)).not.toBe(nodeHash(hashes[0] as string, hashes[0] as string));
  });

  it("refuses an empty tree", () => {
    expect(() => computeRoot([])).toThrow();
  });

  it("verifies a proof for every leaf", () => {
    const root = computeRoot(hashes);
    for (let i = 0; i < hashes.length; i += 1) {
      const proof = buildProof(hashes, i);
      expect(verifyProof(hashes[i] as string, proof, root).valid).toBe(true);
    }
  });

  it("rejects a proof presented for a different receipt", () => {
    const root = computeRoot(hashes);
    const proof = buildProof(hashes, 2);
    const result = verifyProof(hashes[3] as string, proof, root);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("LEAF_MISMATCH");
  });

  it("rejects a proof against the wrong root", () => {
    const proof = buildProof(hashes, 0);
    const result = verifyProof(hashes[0] as string, proof, hashCanonical({ not: "the root" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("ROOT_MISMATCH");
  });

  it("promotes odd nodes rather than duplicating the last leaf", () => {
    // The duplicate-last rule makes [a,b,c] and [a,b,c,c] produce the same root.
    // Promotion must not.
    const three = [hashes[0], hashes[1], hashes[2]] as string[];
    const fourWithDuplicate = [hashes[0], hashes[1], hashes[2], hashes[2]] as string[];
    expect(computeRoot(three)).not.toBe(computeRoot(fourWithDuplicate));
  });

  it("changes the root when any leaf changes", () => {
    const altered = [...hashes];
    altered[4] = hashCanonical({ i: 4, tampered: true });
    expect(computeRoot(altered)).not.toBe(computeRoot(hashes));
  });
});
