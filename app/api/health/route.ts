import { route } from "@/api/handler";
import { environmentStatus } from "@/shared/env";
import { listPublicKeys } from "@/crypto/keys";
import { verifyChain, unanchoredCount } from "@/audit/ledger";
import { SUITE } from "@/crypto/mldsa";

export const dynamic = "force-dynamic";

export const GET = route(async ({ db }) => {
  const chain = await verifyChain(db);
  return {
    ok: chain.intact,
    environment: environmentStatus(),
    suite: SUITE,
    keys: (await listPublicKeys(db)).map((k) => ({ id: k.id, state: k.state, custody: k.custody })),
    ledger: { receipts: chain.receiptCount, intact: chain.intact, unanchored: await unanchoredCount(db) },
  };
});
