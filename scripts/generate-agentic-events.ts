import { closeDb, getDb } from "../src/db/client";
import { ensureBootstrapped } from "../src/db/bootstrap";
import { generateCorpus } from "../src/evaluation/corpus";
import { sealBatch } from "../src/audit/ledger";

async function main(): Promise<void> {
  await ensureBootstrapped();
  const db = await getDb();
  const split = process.argv.includes("--held-out") ? "held-out" : "development";
  const result = await generateCorpus(db, { split });
  const batch = await sealBatch(db);
  process.stdout.write(
    JSON.stringify({ ...result, signLatenciesMs: undefined, sealedBatch: batch?.id ?? null }, null, 2) + "\n",
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
