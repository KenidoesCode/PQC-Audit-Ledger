import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("pglite://.data/ledger"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SEED: z.coerce.number().int().default(20260827),
  /**
   * Development signing seed.
   *
   * Section 27 allows generated development keys; section 28 requires that
   * production keys never come from an environment variable like this one. The
   * key generated from this seed is labelled DEVELOPMENT everywhere it appears,
   * including inside every receipt it signs, so a receipt signed by a
   * development key can never be mistaken for one signed by a real HSM.
   */
  SIGNING_SEED: z.string().default("pqc-audit-ledger-development-signing-seed"),
  PAYMENT_MODE: z.enum(["SIMULATED", "RAZORPAY_TEST"]).default("SIMULATED"),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default("whsec_development_only"),
});

export type Env = z.infer<typeof Schema> & {
  dbDriver: "postgres" | "pglite";
  pglitePath: string;
  pgliteInMemory: boolean;
  /** True only when a live payment could conceivably be created. Always false here. */
  liveMoneyPossible: false;
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = Schema.parse(process.env);
  const url = parsed.DATABASE_URL;
  const isPglite = url.startsWith("pglite://");
  const target = isPglite ? url.slice("pglite://".length) : "";
  cached = {
    ...parsed,
    dbDriver: isPglite ? "pglite" : "postgres",
    pglitePath: target || ".data/ledger",
    pgliteInMemory: target === ":memory:" || target === "",
    liveMoneyPossible: false,
  };
  return cached;
}

export function resetEnv(): void {
  cached = null;
}

/** What the Settings page renders. Secrets are reported as present/absent only. */
export function environmentStatus() {
  const env = getEnv();
  return {
    nodeEnv: env.NODE_ENV,
    paymentMode: env.PAYMENT_MODE,
    liveMoneyPossible: env.liveMoneyPossible,
    database: { driver: env.dbDriver, target: env.dbDriver === "pglite" ? env.pglitePath : "postgres" },
    razorpay: {
      keyIdPresent: env.RAZORPAY_KEY_ID.trim().length > 0,
      keySecretPresent: env.RAZORPAY_KEY_SECRET.trim().length > 0,
    },
    seed: env.SEED,
  };
}
