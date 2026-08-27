import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditReceipts, merkleBatches, merkleLeaves } from "../db/schema";
import { signWithActiveKey } from "../crypto/keys";
import { buildProof, computeRoot, leafHash, MERKLE_ALGORITHM, type MerkleProof } from "../crypto/merkle";
import { AppError } from "../shared/errors";
import { newId } from "../shared/ids";
import { logger } from "../shared/logger";
import {
  emptyReferences,
  receiptCanonicalBytes,
  receiptPayloadHash,
  RECEIPT_SCHEMA_VERSION,
  type EventType,
  type ReceiptBody,
  type ReceiptReferences,
} from "./receipt";

/**
 * The ledger writer.
 *
 * ORDER OF OPERATIONS -- this is the whole file
 * ---------------------------------------------------------------------------
 *   1. read the tail of the chain          (what am I appending to)
 *   2. build the receipt body              (including the previous hash)
 *   3. canonicalize                        (fix the bytes)
 *   4. hash                                (the payload hash, forever)
 *   5. sign the BYTES, not the hash        (ML-DSA over the canonical form)
 *   6. insert                              (append only)
 *
 * Signing before inserting is deliberate. If the insert came first and signing
 * second, a signing failure would leave an unsigned row in the audit trail, and
 * an audit trail with unsigned rows in it is one an attacker can add rows to.
 * Section 159 requires the operation to fail instead, so it does: nothing is
 * written unless it can be signed.
 *
 * SERIALIZATION OF APPENDS
 * ---------------------------------------------------------------------------
 * The chain is a linked list, so two concurrent appends that both read the same
 * tail would both claim the same predecessor and the chain would fork. This is
 * prevented by a unique index on `payload_hash` plus a retry: two receipts that
 * claim the same predecessor differ in their ids, so they do not collide on
 * hash -- but the second one to commit would leave a chain that verifies
 * incorrectly. So appends take a transaction-scoped advisory lock. It is one
 * lock for the whole ledger, which is a real throughput ceiling, and it is
 * stated in the README rather than discovered later.
 */

const LEDGER_LOCK_KEY = 0x1ed6e7;

export interface AppendInput {
  eventType: EventType;
  eventVersion?: number;
  event: Record<string, unknown>;
  references?: Partial<ReceiptReferences>;
  occurredAt?: Date;
  actionId?: string | null;
  paymentId?: string | null;
  agentId?: string | null;
}

export interface AppendedReceipt {
  id: string;
  sequence: number;
  payloadHash: string;
  previousReceiptHash: string | null;
  signature: string;
  signingKeyId: string;
  body: ReceiptBody;
  canonicalBytes: number;
  signLatencyMs: number;
}

export async function appendReceipt(db: Database, input: AppendInput): Promise<AppendedReceipt> {
  return db.transaction(async (tx) => {
    // One writer at a time. See the header comment.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);

    const [tail] = await tx
      .select({ payloadHash: auditReceipts.payloadHash, sequence: auditReceipts.sequence })
      .from(auditReceipts)
      .orderBy(desc(auditReceipts.sequence))
      .limit(1);

    const receiptId = newId("rcp");
    const occurredAt = input.occurredAt ?? new Date();

    const body: ReceiptBody = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      receiptId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      // Second precision. A signed timestamp with milliseconds in it invites a
      // verifier to re-derive one from a Date object and get different bytes.
      timestamp: occurredAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      event: input.event,
      references: { ...emptyReferences(), ...(input.references ?? {}) },
      previousReceiptHash: tail?.payloadHash ?? null,
      // Filled in below, once the signer says which key it used.
      signingKeyId: "",
    };

    // The key id is inside the signed bytes, so it must be known before
    // signing. Ask the key store which key is active, then sign with it.
    const { getActiveKey } = await import("../crypto/keys");
    const active = await getActiveKey(tx as unknown as Database);
    body.signingKeyId = active.id;

    const bytes = receiptCanonicalBytes(body);
    const payloadHash = receiptPayloadHash(body);

    const startedAt = performance.now();
    const signed = await signWithActiveKey(tx as unknown as Database, bytes);
    const signLatencyMs = performance.now() - startedAt;

    if (signed.keyId !== active.id) {
      // The active key changed between reading it and signing. The receipt body
      // names a key that did not sign it, and a receipt that misnames its own
      // signer is exactly the thing this system exists to make impossible.
      throw new AppError(
        "SIGNING_UNAVAILABLE",
        "The active signing key changed mid-append. Nothing was written.",
        { expected: active.id, actual: signed.keyId },
      );
    }

    const [row] = await tx
      .insert(auditReceipts)
      .values({
        id: receiptId,
        eventType: input.eventType,
        eventVersion: body.eventVersion,
        body: body as unknown as Record<string, unknown>,
        payloadHash,
        previousReceiptHash: body.previousReceiptHash,
        signature: signed.signature,
        signatureAlgorithm: signed.algorithm,
        signingKeyId: signed.keyId,
        actionId: input.actionId ?? null,
        paymentId: input.paymentId ?? null,
        agentId: input.agentId ?? null,
        occurredAt,
      })
      .returning();

    if (!row) throw new AppError("INTERNAL", "The ledger insert returned no row.");

    logger.debug("receipt_appended", {
      receiptId,
      eventType: input.eventType,
      sequence: row.sequence,
      signLatencyMs: Number(signLatencyMs.toFixed(3)),
    });

    return {
      id: receiptId,
      sequence: row.sequence,
      payloadHash,
      previousReceiptHash: body.previousReceiptHash,
      signature: signed.signature,
      signingKeyId: signed.keyId,
      body,
      canonicalBytes: bytes.length,
      signLatencyMs: Number(signLatencyMs.toFixed(3)),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Chain integrity                                                            */
/* -------------------------------------------------------------------------- */

export interface ChainReport {
  receiptCount: number;
  intact: boolean;
  /** Sequences where the recorded predecessor does not match the actual one. */
  brokenLinks: { sequence: number; receiptId: string; claimed: string | null; actual: string | null }[];
  /** Sequences missing from an otherwise gapless run. Section 161. */
  missingSequences: number[];
}

/**
 * Walks the whole chain.
 *
 * Two different failures are reported separately, because they mean different
 * things: a broken LINK means a receipt was altered or substituted; a missing
 * SEQUENCE means one was removed outright. A single "chain invalid" boolean
 * would let a deletion hide behind a mutation.
 */
export async function verifyChain(db: Database): Promise<ChainReport> {
  const rows = await db
    .select({
      sequence: auditReceipts.sequence,
      id: auditReceipts.id,
      payloadHash: auditReceipts.payloadHash,
      previousReceiptHash: auditReceipts.previousReceiptHash,
    })
    .from(auditReceipts)
    .orderBy(asc(auditReceipts.sequence));

  const brokenLinks: ChainReport["brokenLinks"] = [];
  const missingSequences: number[] = [];

  let previousHash: string | null = null;
  let expectedSequence = rows[0]?.sequence ?? 1;

  for (const row of rows) {
    while (row.sequence > expectedSequence) {
      missingSequences.push(expectedSequence);
      expectedSequence += 1;
    }
    expectedSequence = row.sequence + 1;

    if (row.previousReceiptHash !== previousHash) {
      brokenLinks.push({
        sequence: row.sequence,
        receiptId: row.id,
        claimed: row.previousReceiptHash,
        actual: previousHash,
      });
    }
    previousHash = row.payloadHash;
  }

  return {
    receiptCount: rows.length,
    intact: brokenLinks.length === 0 && missingSequences.length === 0,
    brokenLinks,
    missingSequences,
  };
}

/* -------------------------------------------------------------------------- */
/* Merkle anchoring                                                           */
/* -------------------------------------------------------------------------- */

export interface SealedBatch {
  id: string;
  root: string;
  treeSize: number;
  fromSequence: number;
  toSequence: number;
}

/**
 * Seals every receipt not yet anchored into one batch.
 *
 * Anchoring is a separate statement from signing: the signature says who wrote
 * this and that it has not changed; the root says this receipt was in the
 * ledger at the time the batch was sealed. Section 50 asks for those two to be
 * distinguished, and they are distinguished here by being different operations
 * over different data at different times.
 */
export async function sealBatch(db: Database): Promise<SealedBatch | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY + 1})`);

    const anchored = await tx.select({ receiptId: merkleLeaves.receiptId }).from(merkleLeaves);
    const anchoredIds = new Set(anchored.map((a) => a.receiptId));

    const all = await tx
      .select({
        id: auditReceipts.id,
        sequence: auditReceipts.sequence,
        payloadHash: auditReceipts.payloadHash,
      })
      .from(auditReceipts)
      .orderBy(asc(auditReceipts.sequence));

    const pending = all.filter((r) => !anchoredIds.has(r.id));
    if (pending.length === 0) return null;

    const payloadHashes = pending.map((r) => r.payloadHash);
    const root = computeRoot(payloadHashes);
    const batchId = newId("mrk");

    await tx.insert(merkleBatches).values({
      id: batchId,
      root,
      algorithm: MERKLE_ALGORITHM,
      treeSize: pending.length,
      fromSequence: pending[0]?.sequence ?? 0,
      toSequence: pending[pending.length - 1]?.sequence ?? 0,
    });

    await tx.insert(merkleLeaves).values(
      pending.map((r, index) => ({
        batchId,
        leafIndex: index,
        receiptId: r.id,
        payloadHash: r.payloadHash,
        leafHash: leafHash(r.payloadHash),
      })),
    );

    logger.info("merkle_batch_sealed", { batchId, treeSize: pending.length, root });

    return {
      id: batchId,
      root,
      treeSize: pending.length,
      fromSequence: pending[0]?.sequence ?? 0,
      toSequence: pending[pending.length - 1]?.sequence ?? 0,
    };
  });
}

export async function proofForReceipt(
  db: Database,
  receiptId: string,
): Promise<{ proof: MerkleProof; root: string; batchId: string } | null> {
  const [leaf] = await db.select().from(merkleLeaves).where(eq(merkleLeaves.receiptId, receiptId)).limit(1);
  if (!leaf) return null;

  const [batch] = await db.select().from(merkleBatches).where(eq(merkleBatches.id, leaf.batchId)).limit(1);
  if (!batch) {
    throw new AppError("MERKLE_BATCH_NOT_FOUND", "Leaf " + receiptId + " references a batch that is gone.");
  }

  const siblings = await db
    .select()
    .from(merkleLeaves)
    .where(eq(merkleLeaves.batchId, leaf.batchId))
    .orderBy(asc(merkleLeaves.leafIndex));

  const proof = buildProof(
    siblings.map((s) => s.payloadHash),
    leaf.leafIndex,
  );

  if (proof.root !== batch.root) {
    // The tree rebuilt from stored leaves does not reproduce the stored root.
    // That is a corrupted anchor, and returning the proof anyway would hand an
    // auditor a proof that cannot verify with no explanation of why.
    throw new AppError(
      "MERKLE_PROOF_UNAVAILABLE",
      "Batch " + batch.id + " no longer rebuilds to its recorded root. The anchor is corrupt.",
      { recordedRoot: batch.root, rebuiltRoot: proof.root },
    );
  }

  return { proof, root: batch.root, batchId: batch.id };
}

export async function unanchoredCount(db: Database): Promise<number> {
  const anchored = await db.select({ receiptId: merkleLeaves.receiptId }).from(merkleLeaves);
  const anchoredIds = new Set(anchored.map((a) => a.receiptId));
  const all = await db.select({ id: auditReceipts.id }).from(auditReceipts);
  return all.filter((r) => !anchoredIds.has(r.id)).length;
}

export { and, asc, desc, eq, gte, isNull, lte };
