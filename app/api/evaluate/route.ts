import { z } from "zod";

import { bodyRoute } from "@/api/handler";
import { evaluate } from "@/evaluation/evaluate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Schema = z.object({ split: z.enum(["development", "held-out"]).default("development") });

export const POST = bodyRoute(Schema, async ({ db }, body) => ({
  evaluation: await evaluate(db, { split: body.split }),
}));
