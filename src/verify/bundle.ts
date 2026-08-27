import { asc } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditReceipts, merkleBatches, merkleLeaves } from "../db/schema";
import { listPublicKeys } from "../crypto/keys";
import { buildProof, MERKLE_ALGORITHM, type MerkleProof } from "../crypto/merkle";
import { CANONICALIZATION } from "../crypto/canonical";
import { HASH_ALGORITHM } from "../crypto/hash";
import { SUITE } from "../crypto/mldsa";
import type { ReceiptBody } from "../audit/receipt";

/**
 * The audit bundle.
 *
 * Everything an outside party needs to check this ledger without talking to it
 * again: the receipts, the public keys, the Merkle roots and one proof per
 * receipt. No private keys, no database rows, no API.
 *
 * WHY THE PROOFS ARE PRECOMPUTED
 * ---------------------------------------------------------------------------
 * A bundle containing only the leaves would let the verifier rebuild the trees
 * itself, which sounds more independent and is in fact weaker: it would be
 * checking that the leaves we sent hash to the root we sent, which is a
 * statement about our arithmetic and not about the ledger. Shipping the proof
 * as issued means the verifier checks the exact path the service published.
 *
 * WHY THE BUNDLE IS NOT SIGNED AS A WHOLE
 * ---------------------------------------------------------------------------
 * It would add nothing. Every receipt inside it is already individually signed,
 * and a bundle signature would only attest that this collection was assembled
 * by us -- which is not a fact anyone auditing us should need to take on trust.
 * An attacker who removes a receipt from the bundle is caught by the chain
 * check, not by a wrapper signature.
 */

export const BUNDLE_FORMAT = "pqc-audit-bundle/1" as const;

export interface BundleReceipt {
  sequence: number;
  body: ReceiptBody;
  payloadHash: string;
  signature: string | null;
  signatureAlgorithm: string;
  merkle: { batchId: string; root: string; proof: MerkleProof } | null;
}

export interface AuditBundle {
  format: typeof BUNDLE_FORMAT;
  generatedAt: string;
  suite: {
    signature: typeof SUITE;
    hash: string;
    canonicalization: typeof CANONICALIZATION;
    merkle: typeof MERKLE_ALGORITHM;
  };
  keys: { id: string; algorithm: string; publicKey: string; state: string; custody: string; label: string }[];
  batches: { id: string; root: string; algorithm: string; treeSize: number }[];
  receipts: BundleReceipt[];
  notes: string[];
}

export async function buildBundle(db: Database, limit = 500): Promise<AuditBundle> {
  const rows = await db.select().from(auditReceipts).orderBy(asc(auditReceipts.sequence)).limit(limit);
  const keys = await listPublicKeys(db);
  const batches = await db.select().from(merkleBatches);
  const leaves = await db.select().from(merkleLeaves).orderBy(asc(merkleLeaves.leafIndex));

  const leavesByBatch = new Map<string, typeof leaves>();
  for (const leaf of leaves) {
    const list = leavesByBatch.get(leaf.batchId) ?? [];
    list.push(leaf);
    leavesByBatch.set(leaf.batchId, list);
  }

  const leafByReceipt = new Map(leaves.map((l) => [l.receiptId, l] as const));
  const batchById = new Map(batches.map((b) => [b.id, b] as const));

  const receipts: BundleReceipt[] = rows.map((row) => {
    const leaf = leafByReceipt.get(row.id);
    const batch = leaf ? batchById.get(leaf.batchId) : undefined;
    const siblings = leaf ? (leavesByBatch.get(leaf.batchId) ?? []) : [];

    return {
      sequence: row.sequence,
      body: row.body as unknown as ReceiptBody,
      payloadHash: row.payloadHash,
      signature: row.signature,
      signatureAlgorithm: row.signatureAlgorithm,
      merkle:
        leaf && batch
          ? {
              batchId: batch.id,
              root: batch.root,
              proof: buildProof(
                siblings.map((s) => s.payloadHash),
                leaf.leafIndex,
              ),
            }
          : null,
    };
  });

  return {
    format: BUNDLE_FORMAT,
    generatedAt: new Date().toISOString(),
    suite: {
      signature: SUITE,
      hash: HASH_ALGORITHM,
      canonicalization: CANONICALIZATION,
      merkle: MERKLE_ALGORITHM,
    },
    keys: keys.map((k) => ({
      id: k.id,
      algorithm: k.algorithm,
      publicKey: k.publicKey,
      state: k.state,
      custody: k.custody,
      label: k.label,
    })),
    batches: batches.map((b) => ({
      id: b.id,
      root: b.root,
      algorithm: b.algorithm,
      treeSize: b.treeSize,
    })),
    receipts,
    notes: [
      "Every receipt in this bundle is individually signed. The bundle itself is not signed, deliberately: a wrapper signature would only attest that we assembled it.",
      "Removing a receipt from this bundle breaks the chain check in the verifier. Reordering it breaks the chain check. Editing one breaks its own signature.",
      "The signing key in this bundle is a DEVELOPMENT key derived from a seed. Anyone holding that seed can forge any receipt here. It is cryptographically valid and organizationally worthless, and those two must never be confused.",
      "Signature bytes are not reproducible: FIPS 204 signing is hedged, so re-signing the same receipt gives a different signature that also verifies. The payload hashes and the Merkle roots ARE reproducible.",
    ],
  };
}
