import { z } from "zod";
import { eq } from "drizzle-orm";

import { bodyRoute } from "@/api/handler";
import { authorities } from "@/db/schema";
import { evaluate } from "@/policy/engine";
import { ensureAuthorities } from "@/evaluation/corpus";
import { AppError } from "@/shared/errors";

export const dynamic = "force-dynamic";

const Schema = z.object({
  authority: z.enum(["standard", "expired", "revoked", "narrow", "small"]).default("standard"),
  toolName: z.string().min(1),
  merchantId: z.string().min(1),
  amountMinor: z.number().int(),
  currency: z.string().min(3).max(3),
  intentConfidence: z.number().int().min(0).max(100).default(100),
});

/** Evaluates policy without writing anything. Every rule, passed and failed. */
export const POST = bodyRoute(Schema, async ({ db }, body) => {
  const ids = await ensureAuthorities(db, "development");
  const [authority] = await db
    .select()
    .from(authorities)
    .where(eq(authorities.id, ids[body.authority] as string))
    .limit(1);
  if (!authority) throw new AppError("AUTHORITY_NOT_FOUND", "No such authority fixture.");

  const now = new Date();
  const effectiveState =
    authority.state === "ACTIVE" && now > authority.expiresAt ? ("EXPIRED" as const) : authority.state;

  return {
    decision: evaluate({
      now,
      authority: { ...authority, state: effectiveState },
      proposal: {
        toolName: body.toolName,
        merchantId: body.merchantId,
        amountMinor: body.amountMinor,
        currency: body.currency,
        intentConfidence: body.intentConfidence,
      },
    }),
  };
});
