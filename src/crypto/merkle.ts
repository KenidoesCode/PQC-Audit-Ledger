import { sha256 } from "@noble/hashes/sha2.js";

import { fromHex, toHex } from "./hash";

/**
 * ===========================================================================
 * MERKLE TREE -- every ambiguity in section 44 decided here, in one place
 * ===========================================================================
 *
 * LEAF DEFINITION (section 43)
 *   A leaf is the receipt payload hash: SHA-256 over the canonical bytes of the
 *   receipt body. Not the receipt id, not the database row. The payload hash is
 *   already the thing the signature covers, so anchoring it means the Merkle
 *   root and the signature are statements about the same bytes. Anchoring the
 *   id instead would prove a receipt with that id was in the batch while saying
 *   nothing about its contents, which is the exact failure this system exists
 *   to prevent.
 *
 * LEAF ORDERING
 *   Insertion order -- the ledger sequence of the receipts in the batch. Not
 *   sorted. The ledger is append-only and its order is itself auditable
 *   information; sorting would discard it.
 *
 * DOMAIN SEPARATION (RFC 6962)
 *   leaf  = SHA-256( 0x00 || payloadHash )
 *   node  = SHA-256( 0x01 || left || right )
 *   The prefix bytes prevent second-preimage attacks where an internal node is
 *   presented as a leaf. Without them a 64-byte "receipt" whose payload hash
 *   happens to equal a concatenation of two real hashes could be proved to be
 *   in the tree. The prefixes are the whole defence and they cost one byte.
 *
 * ODD LEAF BEHAVIOUR
 *   PROMOTION, not duplicate-last. An odd node at any level is carried to the
 *   next level unchanged. Duplicate-last is the Bitcoin rule and it admits the
 *   CVE-2012-2459 collision: two distinct leaf sets produce the same root. This
 *   tree promotes instead, which has no such collision.
 *
 * ENCODING
 *   Every hash is lowercase hex, 64 characters. Proof siblings are hex. The
 *   root is hex. Nothing anywhere is base64, and no hash is ever truncated for
 *   display in stored data.
 *
 * EMPTY TREE
 *   Rejected. A root over zero receipts is not a fact about anything, and
 *   returning some sentinel hash for it would let an empty batch look anchored.
 */

export const MERKLE_ALGORITHM = "SHA-256/RFC6962-domain-separated/promote-odd" as const;

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

export type Direction = "LEFT" | "RIGHT";

export interface MerkleProof {
  /** The leaf hash, already domain-separated. */
  leaf: string;
  /** Sibling hashes, bottom level first. */
  siblings: string[];
  /** Which side each sibling sits on, aligned with `siblings`. */
  directions: Direction[];
  root: string;
  treeSize: number;
  algorithm: typeof MERKLE_ALGORITHM;
}

/** leaf = SHA-256(0x00 || payloadHash) */
export function leafHash(payloadHashHex: string): string {
  const payload = fromHex(payloadHashHex);
  const buffer = new Uint8Array(1 + payload.length);
  buffer[0] = LEAF_PREFIX;
  buffer.set(payload, 1);
  return toHex(sha256(buffer));
}

/** node = SHA-256(0x01 || left || right) */
export function nodeHash(leftHex: string, rightHex: string): string {
  const left = fromHex(leftHex);
  const right = fromHex(rightHex);
  const buffer = new Uint8Array(1 + left.length + right.length);
  buffer[0] = NODE_PREFIX;
  buffer.set(left, 1);
  buffer.set(right, 1 + left.length);
  return toHex(sha256(buffer));
}

/**
 * Builds every level of the tree, bottom-up.
 *
 * Levels are returned so a proof can be read straight off them and so the
 * Merkle page can render the actual tree rather than a picture of a tree.
 */
export function buildLevels(payloadHashes: string[]): string[][] {
  if (payloadHashes.length === 0) {
    throw new Error("A Merkle tree over zero receipts is not a fact about anything.");
  }

  const levels: string[][] = [payloadHashes.map(leafHash)];

  while ((levels[levels.length - 1] as string[]).length > 1) {
    const below = levels[levels.length - 1] as string[];
    const above: string[] = [];
    for (let i = 0; i < below.length; i += 2) {
      const left = below[i] as string;
      const right = below[i + 1];
      // Promotion: an odd node moves up untouched. See the header comment for
      // why this is not duplicate-last.
      above.push(right === undefined ? left : nodeHash(left, right));
    }
    levels.push(above);
  }

  return levels;
}

export function computeRoot(payloadHashes: string[]): string {
  const levels = buildLevels(payloadHashes);
  return (levels[levels.length - 1] as string[])[0] as string;
}

export function buildProof(payloadHashes: string[], index: number): MerkleProof {
  if (index < 0 || index >= payloadHashes.length) {
    throw new Error("Leaf index " + index + " is outside a tree of " + payloadHashes.length + ".");
  }

  const levels = buildLevels(payloadHashes);
  const siblings: string[] = [];
  const directions: Direction[] = [];

  let position = index;
  for (let level = 0; level < levels.length - 1; level += 1) {
    const nodes = levels[level] as string[];
    const isRightChild = position % 2 === 1;
    const siblingIndex = isRightChild ? position - 1 : position + 1;
    const sibling = nodes[siblingIndex];

    if (sibling !== undefined) {
      siblings.push(sibling);
      directions.push(isRightChild ? "LEFT" : "RIGHT");
    }
    // No sibling means this node was promoted. Nothing is recorded, because
    // nothing was combined -- and recording a placeholder would make the
    // verifier hash against a value the builder never hashed against.

    position = Math.floor(position / 2);
  }

  return {
    leaf: (levels[0] as string[])[index] as string,
    siblings,
    directions,
    root: (levels[levels.length - 1] as string[])[0] as string,
    treeSize: payloadHashes.length,
    algorithm: MERKLE_ALGORITHM,
  };
}

/**
 * Verifies a proof against a claimed root, from the payload hash alone.
 *
 * This function touches no database and no application state, which is the
 * whole point: an auditor holding a receipt, a proof and a published root can
 * run exactly this and needs nothing else from us.
 */
export function verifyProof(
  payloadHashHex: string,
  proof: MerkleProof,
  expectedRoot: string,
): { valid: boolean; reason: string | null; computedRoot: string | null } {
  if (proof.siblings.length !== proof.directions.length) {
    return { valid: false, reason: "PROOF_MALFORMED", computedRoot: null };
  }

  let computed: string;
  try {
    computed = leafHash(payloadHashHex);
  } catch {
    return { valid: false, reason: "PAYLOAD_HASH_MALFORMED", computedRoot: null };
  }

  if (computed !== proof.leaf) {
    // The receipt does not hash to the leaf the proof was issued for. Either
    // the receipt changed or the proof belongs to a different receipt, and the
    // verifier is not entitled to guess which.
    return { valid: false, reason: "LEAF_MISMATCH", computedRoot: null };
  }

  try {
    for (let i = 0; i < proof.siblings.length; i += 1) {
      const sibling = proof.siblings[i] as string;
      computed =
        proof.directions[i] === "LEFT" ? nodeHash(sibling, computed) : nodeHash(computed, sibling);
    }
  } catch {
    return { valid: false, reason: "PROOF_MALFORMED", computedRoot: null };
  }

  if (computed !== expectedRoot) {
    return { valid: false, reason: "ROOT_MISMATCH", computedRoot: computed };
  }

  return { valid: true, reason: null, computedRoot: computed };
}
