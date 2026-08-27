import { closeDb, getDb } from "../src/db/client";
import { ensureBootstrapped } from "../src/db/bootstrap";
import { auditReceipts } from "../src/db/schema";
import { loadPublicKey } from "../src/crypto/keys";
import { verifyReceipt } from "../src/verify/verifier";
import { mutate, MUTATION_TYPES } from "../src/evaluation/mutate";
import { Rng } from "../src/shared/rng";
import type { ReceiptBody } from "../src/audit/receipt";

/**
 * Mutates stored receipts and reports whether the verifier caught each one.
 *
 * Nothing is written back. The database refuses an UPDATE on audit_receipts, and
 * a mutation engine that needed to modify the ledger to test it would be testing
 * the wrong thing anyway.
 */
async function main(): Promise<void> {
  await ensureBootstrapped();
  const db = await getDb();
  const rng = new Rng(20260827);
  const rows = await db.select().from(auditReceipts).limit(20);

  for (const row of rows) {
    const key = await loadPublicKey(db, row.signingKeyId);
    for (const type of MUTATION_TYPES) {
      const mutation = mutate(row.body as unknown as ReceiptBody, type, rng);
      if (!mutation.applied) continue;
      const verdict = verifyReceipt({
        body: mutation.body,
        signature: row.signature,
        signatureAlgorithm: row.signatureAlgorithm,
        storedPayloadHash: row.payloadHash,
        publicKeyHex: key?.publicKey ?? null,
        publicKeyId: key?.id ?? null,
      });
      process.stdout.write(
        (verdict.valid ? "MISSED  " : "caught  ") +
          type.padEnd(24) +
          mutation.field.padEnd(32) +
          verdict.reasons.join(",") +
          "\n",
      );
    }
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
