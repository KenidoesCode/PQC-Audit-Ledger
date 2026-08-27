import { z } from "zod";

import { bodyRoute } from "@/api/handler";
import { act } from "@/agent/pipeline";
import { ensureAuthorities } from "@/evaluation/corpus";
import { getEnv } from "@/shared/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Schema = z.object({
  text: z.string().min(1).max(500),
  authority: z.enum(["standard", "expired", "revoked", "narrow", "small"]).default("standard"),
});

/**
 * The whole flow behind one call: intent, authority, policy, payment, receipts.
 * The response returns the receipt ids so the caller can go and verify them --
 * a system that reports "done" without handing back the evidence is asking to
 * be trusted, which is the thing this project is against.
 */
export const POST = bodyRoute(Schema, async ({ db }, body) => {
  const ids = await ensureAuthorities(db, "development");
  const result = await act(db, {
    rawText: body.text,
    agentId: "agt_procurement_a",
    authorityId: ids[body.authority] as string,
    seed: getEnv().SEED + Math.floor(Date.now() % 100000),
  });
  return { result };
});
