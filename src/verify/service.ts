import { eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditReceipts } from "../db/schema";
import { loadPublicKey } from "../crypto/keys";
import { proofForReceipt } from "../audit/ledger";
import { AppError } from "../shared/errors";
import type { ReceiptBody } from "../audit/receipt";
import { verifyReceipt, type VerifyResult } from "./verifier";

/**
 * Verification against the stored ledger.
 *
 * The thin layer between the database and the pure verifier: it fetches, it
 * does not decide. `overrides` exists for the tamper demonstration -- the UI
 * supplies a modified body and this passes it to the verifier alongside the
 * UNMODIFIED stored hash and signature, which is exactly the position an
 * attacker with row access leaves the system in.
 */
export interface VerifyOptions {
  /** A replacement body, for the tamper demonstration. */
  overrideBody?: ReceiptBody;
  /** A different public key, for the wrong-key demonstration. */
  overridePublicKey?: string;
  /** Drop the signature, for the missing-signature demonstration. */
  dropSignature?: boolean;
  includeMerkle?: boolean;
  includeChain?: boolean;
}

export interface VerifyRecord {
  receiptId: string;
  sequence: number;
  eventType: string;
  storedPayloadHash: string;
  signingKeyId: string;
  keyCustody: string | null;
  result: VerifyResult;
  merkleRoot: string | null;
  merkleBatchId: string | null;
}

export async function verifyStoredReceipt(
  db: Database,
  receiptId: string,
  options: VerifyOptions = {},
): Promise<VerifyRecord> {
  const [row] = await db.select().from(auditReceipts).where(eq(auditReceipts.id, receiptId)).limit(1);
  if (!row) throw new AppError("RECEIPT_NOT_FOUND", "No receipt " + receiptId + ".");

  const body = options.overrideBody ?? (row.body as unknown as ReceiptBody);
  const key = await loadPublicKey(db, row.signingKeyId);
  const anchored = options.includeMerkle === false ? null : await proofForReceipt(db, row.id);

  let previousPayloadHash: string | null | undefined;
  if (options.includeChain !== false) {
    if (row.sequence <= 1) previousPayloadHash = null;
    else {
      const rows = await db.select().from(auditReceipts);
      const previous = rows
        .filter((r) => r.sequence < row.sequence)
        .sort((a, b) => b.sequence - a.sequence)[0];
      previousPayloadHash = previous?.payloadHash ?? null;
    }
  }

  const result = verifyReceipt({
    body,
    signature: options.dropSignature ? null : row.signature,
    signatureAlgorithm: row.signatureAlgorithm,
    storedPayloadHash: row.payloadHash,
    publicKeyHex: options.overridePublicKey ?? key?.publicKey ?? null,
    publicKeyId: options.overridePublicKey ? null : (key?.id ?? null),
    ...(previousPayloadHash === undefined ? {} : { previousReceiptPayloadHash: previousPayloadHash }),
    merkle: anchored ? { proof: anchored.proof, root: anchored.root } : null,
  });

  return {
    receiptId: row.id,
    sequence: row.sequence,
    eventType: row.eventType,
    storedPayloadHash: row.payloadHash,
    signingKeyId: row.signingKeyId,
    keyCustody: key?.custody ?? null,
    result,
    merkleRoot: anchored?.root ?? null,
    merkleBatchId: anchored?.batchId ?? null,
  };
}

/**
 * Applies a tamper to a stored receipt body without touching the database.
 *
 * The ledger table is append-only at the database level -- an UPDATE is refused
 * by a trigger -- so the tamper demonstration cannot modify the row even if it
 * wanted to. It modifies a copy, which is the more realistic scenario anyway:
 * what an auditor is usually handed is an exported receipt, and the question is
 * whether they can tell it apart from the real one.
 */
export function applyFieldTamper(body: ReceiptBody, path: string, value: string): ReceiptBody {
  const next = JSON.parse(JSON.stringify(body)) as ReceiptBody;
  const [head, tail] = path.split(".");

  if (head === "event" && tail) {
    const current = next.event[tail];
    next.event[tail] = typeof current === "number" ? Number(value) : value;
    return next;
  }
  if (head === "references" && tail) {
    (next.references as unknown as Record<string, unknown>)[tail] = value;
    return next;
  }
  if (head === "eventType") {
    next.eventType = value as ReceiptBody["eventType"];
    return next;
  }
  if (head === "timestamp") {
    next.timestamp = value;
    return next;
  }
  if (head === "previousReceiptHash") {
    next.previousReceiptHash = value;
    return next;
  }
  if (head === "signingKeyId") {
    next.signingKeyId = value;
    return next;
  }

  throw new AppError("VALIDATION_FAILED", "Cannot tamper an unknown field: " + path + ".");
}
