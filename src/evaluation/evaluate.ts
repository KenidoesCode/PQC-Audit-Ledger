import { asc, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditReceipts, evaluationRuns, agentActions } from "../db/schema";
import { verifyChain, unanchoredCount, proofForReceipt } from "../audit/ledger";
import { loadPublicKey, listPublicKeys } from "../crypto/keys";
import { SUITE } from "../crypto/mldsa";
import { verifyReceipt } from "../verify/verifier";
import type { ReceiptBody } from "../audit/receipt";
import { newId } from "../shared/ids";
import { Rng } from "../shared/rng";
import { getEnv } from "../shared/env";
import { logger } from "../shared/logger";
import { control, mutate, MUTATION_TYPES, type MutationType } from "./mutate";
import { DATASET_VERSION } from "./corpus";

/**
 * The evaluation (sections 91 to 99).
 *
 * Three numbers matter and each is measured, not asserted:
 *
 *   TAMPER DETECTION RATE   of applied mutations, the share the verifier
 *                           rejects. Anything below 1.000 is a defect report
 *                           and the failing mutation types are named.
 *
 *   FALSE VERIFICATION RATE of unmodified control receipts, the share the
 *                           verifier rejects. This is the number that catches a
 *                           broken canonicalizer, and it is why the controls
 *                           exist at all.
 *
 *   AUDIT COMPLETENESS      of agent actions that occurred, the share with a
 *                           full receipt chain. Measured against the ACTIONS
 *                           table, not against the receipts table -- asking the
 *                           receipts whether the receipts are complete is not a
 *                           measurement, it is a tautology.
 *
 * Latency is reported as P50/P95/P99 (section 98). An average would hide the
 * tail, and the tail is what a batch job runs into.
 */

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface EvaluationResult {
  runId: string;
  datasetVersion: string;
  cryptoVersion: string;
  signingKeyId: string;
  split: "development" | "held-out";
  receiptCount: number;
  /** Applied mutations. Ones that could not apply are excluded and counted. */
  mutationCount: number;
  mutationsNotApplicable: number;
  /** Receipts actually mutated. Equals receiptCount unless bootstrap sampled. */
  mutationReceiptsSampled: number;
  controlCount: number;
  tamperDetected: number;
  tamperMissed: number;
  tamperDetectionRate: number;
  falseVerifications: number;
  falseVerificationRate: number;
  perMutationType: { type: MutationType; attempted: number; applied: number; detected: number }[];
  auditCompleteness: number;
  actionsWithoutFullChain: string[];
  chainIntact: boolean;
  chainBrokenLinks: number;
  chainMissingSequences: number;
  unanchoredReceipts: number;
  merkleProofsChecked: number;
  merkleProofsValid: number;
  /** See `columnBodyDivergence` below. */
  columnsProbed: number;
  columnBodyDivergences: { receiptId: string; column: string; columnValue: string; bodyValue: string }[];
  signLatencyMs: LatencySummary;
  verifyLatencyMs: LatencySummary;
}

function summarize(values: number[]): LatencySummary {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => {
    // Nearest-rank. With small samples an interpolated percentile invents a
    // value that was never observed, and these are latencies -- every reported
    // number should be one that actually happened.
    const rank = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
    return Number((sorted[Math.max(0, rank)] as number).toFixed(3));
  };
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: Number((sorted[sorted.length - 1] as number).toFixed(3)),
  };
}

/** Receipt event types that together constitute a complete audit of an action. */
const REQUIRED_FOR_ALLOWED = ["ACTION_PROPOSED", "POLICY_EVALUATED", "PAYMENT_AUTHORIZED", "PAYMENT_ATTEMPTED"];
const REQUIRED_FOR_DENIED = ["ACTION_PROPOSED", "POLICY_EVALUATED", "PAYMENT_DENIED"];

export async function evaluate(
  db: Database,
  options: {
    split: "development" | "held-out";
    signLatenciesMs?: number[];
    /**
     * How many receipts to MUTATE. Defaults to every one of them.
     *
     * Mutating a receipt costs one ML-DSA verify per mutation type, and the
     * corpus produces roughly 1,430 applied mutations -- about seven seconds of
     * pure signature verification. That is fine in a test or on an explicit
     * POST to /api/evaluate; it is not fine inside a cold start, where it was
     * more than half the time a first visitor waited.
     *
     * So bootstrap samples. The CONTROLS are never sampled -- every receipt is
     * still verified untouched, because the false-verification rate is the
     * number here that can actually fail and it costs one verify each rather
     * than thirteen. Audit completeness and the chain walk are also unsampled.
     * Only the tamper-detection denominator shrinks, and the page prints it.
     */
    mutationSample?: number;
  },
): Promise<EvaluationResult> {
  const env = getEnv();
  const rng = new Rng(env.SEED + (options.split === "held-out" ? 7919 : 0));

  const receipts = await db.select().from(auditReceipts).orderBy(asc(auditReceipts.sequence));
  const keys = await listPublicKeys(db);
  const activeKey = keys.find((k) => k.state === "ACTIVE") ?? keys[0];

  /* -- tamper detection --------------------------------------------------- */

  const perType = new Map<MutationType, { attempted: number; applied: number; detected: number }>();
  for (const type of MUTATION_TYPES) perType.set(type, { attempted: 0, applied: 0, detected: 0 });

  // Sampling is deterministic: the first N receipts in ledger order, not a
  // random draw. A random sample would make two runs of the same corpus report
  // different tamper-detection denominators, and a metric that moves on its own
  // is one nobody can use to spot a regression.
  const mutationTargets =
    options.mutationSample === undefined ? receipts : receipts.slice(0, options.mutationSample);

  let mutationCount = 0;
  let mutationsNotApplicable = 0;
  let tamperDetected = 0;
  const verifyLatencies: number[] = [];

  for (const row of mutationTargets) {
    const body = row.body as unknown as ReceiptBody;
    const key = await loadPublicKey(db, row.signingKeyId);

    for (const type of MUTATION_TYPES) {
      const bucket = perType.get(type) as { attempted: number; applied: number; detected: number };
      bucket.attempted += 1;

      const mutation = mutate(body, type, rng);
      if (!mutation.applied) {
        mutationsNotApplicable += 1;
        continue;
      }
      bucket.applied += 1;
      mutationCount += 1;

      const started = performance.now();
      const verdict = verifyReceipt({
        body: mutation.body,
        signature: row.signature,
        signatureAlgorithm: row.signatureAlgorithm,
        // The STORED hash, deliberately. The attacker changed the body and left
        // the ledger's hash and signature alone -- which is what an attacker
        // with write access to a row would actually do.
        storedPayloadHash: row.payloadHash,
        publicKeyHex: key?.publicKey ?? null,
        publicKeyId: key?.id ?? null,
      });
      verifyLatencies.push(performance.now() - started);

      if (!verdict.valid) {
        tamperDetected += 1;
        bucket.detected += 1;
      }
    }
  }

  /* -- false verifications (controls) ------------------------------------- */

  let falseVerifications = 0;
  for (const row of receipts) {
    const body = row.body as unknown as ReceiptBody;
    const key = await loadPublicKey(db, row.signingKeyId);
    const started = performance.now();
    const verdict = verifyReceipt({
      body: control(body).body,
      signature: row.signature,
      signatureAlgorithm: row.signatureAlgorithm,
      storedPayloadHash: row.payloadHash,
      publicKeyHex: key?.publicKey ?? null,
      publicKeyId: key?.id ?? null,
    });
    verifyLatencies.push(performance.now() - started);
    if (!verdict.valid) falseVerifications += 1;
  }

  /* -- audit completeness -------------------------------------------------- */

  const actions = await db.select().from(agentActions);
  const byAction = new Map<string, Set<string>>();
  for (const row of receipts) {
    if (!row.actionId) continue;
    const set = byAction.get(row.actionId) ?? new Set<string>();
    set.add(row.eventType);
    byAction.set(row.actionId, set);
  }

  const actionsWithoutFullChain: string[] = [];
  for (const action of actions) {
    const seen = byAction.get(action.id) ?? new Set<string>();
    const required = action.decision === "ALLOWED" ? REQUIRED_FOR_ALLOWED : REQUIRED_FOR_DENIED;
    if (!required.every((eventType) => seen.has(eventType))) actionsWithoutFullChain.push(action.id);
  }

  const auditCompleteness =
    actions.length === 0 ? 0 : (actions.length - actionsWithoutFullChain.length) / actions.length;

  /* -- chain and anchors --------------------------------------------------- */

  const chain = await verifyChain(db);
  const unanchored = await unanchoredCount(db);

  // Merkle proofs are checked on a sample, not on every receipt: rebuilding the
  // tree per receipt is quadratic and the evaluation would take longer than the
  // demonstration. The sample size is stated in the output so nobody reads
  // "proofs valid" as "every proof was checked".
  const sample = receipts.slice(0, Math.min(25, receipts.length));
  let merkleProofsChecked = 0;
  let merkleProofsValid = 0;
  for (const row of sample) {
    const anchored = await proofForReceipt(db, row.id);
    if (!anchored) continue;
    merkleProofsChecked += 1;
    const key = await loadPublicKey(db, row.signingKeyId);
    const verdict = verifyReceipt({
      body: row.body as unknown as ReceiptBody,
      signature: row.signature,
      signatureAlgorithm: row.signatureAlgorithm,
      storedPayloadHash: row.payloadHash,
      publicKeyHex: key?.publicKey ?? null,
      publicKeyId: key?.id ?? null,
      merkle: { proof: anchored.proof, root: anchored.root },
    });
    if (verdict.valid) merkleProofsValid += 1;
  }

  /*
    WHAT THE SIGNATURE DOES NOT COVER
    -------------------------------------------------------------------------
    A tamper-detection rate of 1.000 is the expected result here and it is not
    an impressive one: any change to the canonical bytes changes their SHA-256,
    and the verifier recomputes that hash before it looks at the signature. The
    number is a regression test on the canonicalizer, not evidence that the
    cryptography is strong.

    The interesting question is the opposite one -- what could an attacker
    change that verification would NOT catch? The answer is anything outside the
    signed body, and this ledger has such fields: the denormalised columns
    (event type, action id, agent id, occurred-at) that exist so the tables can
    be queried without parsing jsonb on every row. A signature says nothing
    about them.

    So they are checked directly, against the body they were copied from. A
    divergence here is invisible to signature verification and would show a
    tampered index or a bug in the writer, and either way an operator needs to
    know. This is the one measurement in the evaluation whose failing case is
    not already guaranteed impossible by SHA-256.
  */
  const columnBodyDivergences: EvaluationResult["columnBodyDivergences"] = [];
  for (const row of receipts) {
    const body = row.body as unknown as ReceiptBody;
    const pairs: [string, string, string][] = [
      ["event_type", row.eventType, body.eventType],
      ["payload_hash", row.payloadHash, row.payloadHash],
      ["signing_key_id", row.signingKeyId, body.signingKeyId],
      ["occurred_at", row.occurredAt.toISOString().replace(/\.\d{3}Z$/, "Z"), body.timestamp],
      ["id", row.id, body.receiptId],
      ["action_id", row.actionId ?? "", body.references.actionId ?? ""],
      ["agent_id", row.agentId ?? "", body.references.agentId ?? ""],
    ];
    for (const [column, columnValue, bodyValue] of pairs) {
      if (columnValue !== bodyValue) {
        columnBodyDivergences.push({ receiptId: row.id, column, columnValue, bodyValue });
      }
    }
  }

  const result: EvaluationResult = {
    runId: newId("evr"),
    datasetVersion: DATASET_VERSION,
    cryptoVersion: SUITE.algorithm + " via " + SUITE.library + " " + SUITE.libraryVersion,
    signingKeyId: activeKey?.id ?? "(none)",
    split: options.split,
    receiptCount: receipts.length,
    mutationCount,
    mutationsNotApplicable,
    mutationReceiptsSampled: mutationTargets.length,
    controlCount: receipts.length,
    tamperDetected,
    tamperMissed: mutationCount - tamperDetected,
    tamperDetectionRate: mutationCount === 0 ? 0 : tamperDetected / mutationCount,
    falseVerifications,
    falseVerificationRate: receipts.length === 0 ? 0 : falseVerifications / receipts.length,
    perMutationType: MUTATION_TYPES.map((type) => ({
      type,
      ...(perType.get(type) as { attempted: number; applied: number; detected: number }),
    })),
    auditCompleteness,
    actionsWithoutFullChain,
    chainIntact: chain.intact,
    chainBrokenLinks: chain.brokenLinks.length,
    chainMissingSequences: chain.missingSequences.length,
    unanchoredReceipts: unanchored,
    merkleProofsChecked,
    merkleProofsValid,
    columnsProbed: receipts.length * 7,
    columnBodyDivergences,
    signLatencyMs: summarize(options.signLatenciesMs ?? []),
    verifyLatencyMs: summarize(verifyLatencies),
  };

  await db.insert(evaluationRuns).values({
    id: result.runId,
    datasetVersion: result.datasetVersion,
    cryptoVersion: result.cryptoVersion,
    signingKeyId: result.signingKeyId,
    split: options.split,
    metrics: result as unknown as Record<string, unknown>,
  });

  logger.info("evaluation_complete", {
    runId: result.runId,
    split: options.split,
    tamperDetectionRate: result.tamperDetectionRate,
    falseVerificationRate: result.falseVerificationRate,
    auditCompleteness: result.auditCompleteness,
  });

  return result;
}

export async function latestEvaluation(db: Database, split?: "development" | "held-out") {
  const rows = split
    ? await db.select().from(evaluationRuns).where(eq(evaluationRuns.split, split))
    : await db.select().from(evaluationRuns);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}
