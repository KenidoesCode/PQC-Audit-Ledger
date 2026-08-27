import { getDb, runMigrations } from "./client";
import { auditReceipts } from "./schema";
import { ensureDevelopmentKey } from "../crypto/keys";
import { ensurePolicyVersion } from "../agent/pipeline";
import { sealBatch } from "../audit/ledger";
import { generateCorpus } from "../evaluation/corpus";
import { evaluate } from "../evaluation/evaluate";
import { getEnv } from "../shared/env";
import { logger } from "../shared/logger";

/**
 * Bootstrap.
 *
 * On a serverless host every instance starts with an empty in-memory database,
 * so a ledger that is only populated by a seed script would be permanently
 * empty in production -- every page would truthfully report that nothing has
 * happened, which is honest and useless. So the corpus is generated, anchored
 * and evaluated during bootstrap, once per process.
 *
 * The cost is a slower first request on a cold instance. The alternative is a
 * deployed audit ledger with no audit trail, and that is not an alternative.
 */

let bootstrapped: Promise<void> | null = null;

export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapped) return bootstrapped;

  bootstrapped = (async () => {
    const env = getEnv();
    const started = Date.now();

    await runMigrations();
    const db = await getDb();

    await ensureDevelopmentKey(db);
    await ensurePolicyVersion(db);

    const [existing] = await db.select({ id: auditReceipts.id }).from(auditReceipts).limit(1);
    if (existing) {
      logger.debug("bootstrap_skipped", { reason: "the ledger already has receipts" });
      return;
    }

    const development = await generateCorpus(db, { split: "development", targetActions: 30 });
    await sealBatch(db);
    await evaluate(db, { split: "development", signLatenciesMs: development.signLatenciesMs });

    logger.info("bootstrap_complete", {
      durationMs: Date.now() - started,
      receipts: development.receipts,
      inMemory: env.pgliteInMemory,
    });
  })().catch((error: unknown) => {
    // A failed bootstrap must not be cached as success, or every later request
    // would see an empty ledger with no explanation.
    bootstrapped = null;
    throw error;
  });

  return bootstrapped;
}
