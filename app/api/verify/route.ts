import { z } from "zod";

import { bodyRoute, route } from "@/api/handler";
import { applyFieldTamper, verifyStoredReceipt } from "@/verify/service";
import { auditReceipts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "@/shared/errors";
import type { ReceiptBody } from "@/audit/receipt";

export const dynamic = "force-dynamic";

const Schema = z.object({
  receiptId: z.string().min(1),
  /** Tamper one field before verifying. The stored hash and signature are untouched. */
  tamper: z.object({ field: z.string().min(1), value: z.string() }).optional(),
  /** Verify against a key that did not sign this receipt. */
  wrongKey: z.boolean().optional(),
  /** Strip the signature. */
  dropSignature: z.boolean().optional(),
});

export const POST = bodyRoute(Schema, async ({ db }, body) => {
  const [row] = await db.select().from(auditReceipts).where(eq(auditReceipts.id, body.receiptId)).limit(1);
  if (!row) throw new AppError("RECEIPT_NOT_FOUND", "No receipt " + body.receiptId + ".");

  const overrideBody = body.tamper
    ? applyFieldTamper(row.body as unknown as ReceiptBody, body.tamper.field, body.tamper.value)
    : undefined;

  // A key of the right length that never signed anything. Not a random string:
  // a malformed key would fail on its length and prove nothing about whether
  // the signature is bound to the key that made it.
  const wrongKey = body.wrongKey ? "0f".repeat(1952) : undefined;

  const record = await verifyStoredReceipt(db, body.receiptId, {
    ...(overrideBody ? { overrideBody } : {}),
    ...(wrongKey ? { overridePublicKey: wrongKey } : {}),
    ...(body.dropSignature ? { dropSignature: true } : {}),
  });

  return { verification: record, tampered: Boolean(body.tamper), wrongKey: Boolean(body.wrongKey) };
});

export const GET = route(async ({ url, db }) => {
  const receiptId = url.searchParams.get("receiptId");
  if (!receiptId) throw new AppError("VALIDATION_FAILED", "Pass ?receiptId=");
  return { verification: await verifyStoredReceipt(db, receiptId) };
});
