import { closeDb, getDb } from "../src/db/client";
import { ensureBootstrapped } from "../src/db/bootstrap";
import { evaluate } from "../src/evaluation/evaluate";

async function main(): Promise<void> {
  await ensureBootstrapped();
  const db = await getDb();
  const split = process.argv.includes("--held-out") ? "held-out" : "development";
  const result = await evaluate(db, { split });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
