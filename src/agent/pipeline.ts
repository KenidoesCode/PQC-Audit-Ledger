import { eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { agentActions, authorities, intents, policyVersions } from "../db/schema";
import { appendReceipt, type AppendInput } from "../audit/ledger";
import { hashCanonical } from "../crypto/hash";
import { parseIntent } from "./agent";
import { DEFAULT_RULES, evaluate, POLICY_VERSION, rulesHash } from "../policy/engine";
import { capture, createOrder, PAYMENT_LABEL, readPaymentState } from "../payment/simulator";
import { AppError } from "../shared/errors";
import { newId } from "../shared/ids";

/**
 * The whole flow, in one function, in the order section 2 demands:
 *
 *   intent -> agent -> proposal -> authority -> policy -> authorization ->
 *   payment -> state verification -> signed receipts
 *
 * The cryptography is layered on top, not woven through. Every step appends a
 * receipt; no step's correctness depends on a receipt having been written. If
 * the ledger were removed the payments would still be correct, and if the
 * payments were removed the ledger would still verify -- which is the property
 * that makes this an audit system rather than a cryptography demonstration
 * wearing a payment costume.
 *
 * A DENIAL IS NOT A NON-EVENT
 * ---------------------------------------------------------------------------
 * The denied path writes MORE receipts than the allowed one, not fewer. A
 * system that only records what it did cannot answer "what did it refuse to
 * do", and section 112 is explicit that a later human override must not erase
 * the denial that preceded it.
 */

export interface ActInput {
  rawText: string;
  agentId: string;
  authorityId: string;
  /** Seeds the simulator so a corpus is reproducible. */
  seed: number;
  /** Overrides the receipt timestamps. Used only by the corpus generator. */
  occurredAt?: Date;
}

export interface ActResult {
  intentId: string;
  actionId: string;
  decision: "ALLOWED" | "DENIED" | "HUMAN_REVIEW";
  reasons: string[];
  receiptIds: string[];
  paymentState: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  ignoredDirectives: string[];
  signLatenciesMs: number[];
}

export async function act(db: Database, input: ActInput): Promise<ActResult> {
  const now = input.occurredAt ?? new Date();
  const receiptIds: string[] = [];
  const signLatenciesMs: number[] = [];

  const record = async (entry: AppendInput) => {
    const receipt = await appendReceipt(db, { ...entry, occurredAt: now });
    receiptIds.push(receipt.id);
    signLatenciesMs.push(receipt.signLatencyMs);
    return receipt;
  };

  /* -- 1. intent ---------------------------------------------------------- */

  const parsed = parseIntent(input.rawText, input.agentId);
  const intentId = newId("int");

  await db.insert(intents).values({
    id: intentId,
    agentId: input.agentId,
    rawText: input.rawText,
    intentHash: parsed.intentHash,
    parsed: parsed.proposal as unknown as Record<string, unknown>,
    confidence: parsed.proposal.confidence,
  });

  await record({
    eventType: "INTENT_RECEIVED",
    event: {
      intentId,
      // The raw text is recorded because an injected instruction that never
      // appears in the audit trail cannot be investigated afterwards.
      rawText: input.rawText,
      parsedProposal: parsed.proposal as unknown as Record<string, unknown>,
      ignoredDirectives: parsed.ignoredDirectives,
      confidence: parsed.proposal.confidence,
    },
    references: { agentId: input.agentId, intentHash: parsed.intentHash },
    agentId: input.agentId,
  });

  /* -- 2. authority ------------------------------------------------------- */

  const [authority] = await db.select().from(authorities).where(eq(authorities.id, input.authorityId)).limit(1);
  if (!authority) throw new AppError("AUTHORITY_NOT_FOUND", "No authority " + input.authorityId + ".");

  // The stored state is not trusted on its own: an expiry that passed since the
  // row was written is an expiry, whatever the column says. A cap enforced only
  // by a state column would be enforced by whoever last wrote that column.
  const effectiveState =
    authority.state === "ACTIVE" && now > authority.expiresAt
      ? ("EXPIRED" as const)
      : authority.state === "ACTIVE" && authority.spentMinor >= authority.capMinor
        ? ("EXHAUSTED" as const)
        : authority.state;

  const actionId = newId("act");

  await record({
    eventType: "AUTHORITY_CHECKED",
    event: {
      authorityId: authority.id,
      storedState: authority.state,
      effectiveState,
      capMinor: authority.capMinor,
      spentMinor: authority.spentMinor,
      remainingMinor: authority.capMinor - authority.spentMinor,
      expiresAt: authority.expiresAt.toISOString(),
    },
    references: { agentId: input.agentId, authorityId: authority.id, actionId, intentHash: parsed.intentHash },
    actionId,
    agentId: input.agentId,
  });

  /* -- 3. policy ---------------------------------------------------------- */

  const [policy] = await db.select().from(policyVersions).where(eq(policyVersions.active, true)).limit(1);
  const policyId = policy?.id ?? "pol_unversioned";

  const decision = evaluate({
    now,
    authority: {
      id: authority.id,
      state: effectiveState,
      currency: authority.currency,
      capMinor: authority.capMinor,
      spentMinor: authority.spentMinor,
      perActionCapMinor: authority.perActionCapMinor,
      merchantAllowlist: authority.merchantAllowlist,
      permittedTools: authority.permittedTools,
      notBefore: authority.notBefore,
      expiresAt: authority.expiresAt,
    },
    proposal: {
      toolName: parsed.proposal.toolName,
      merchantId: parsed.proposal.merchantId,
      amountMinor: parsed.proposal.amountMinor,
      currency: parsed.proposal.currency,
      intentConfidence: parsed.proposal.confidence,
    },
  });

  const nonce = hashCanonical({ intentId, actionId, proposal: parsed.proposal }).slice(0, 32);
  const idempotencyKey = hashCanonical({
    agentId: input.agentId,
    authorityId: authority.id,
    proposal: parsed.proposal,
    // The date, not the instant: the same purchase proposed twice in one day is
    // one payment. Section 62 asks for idempotency and this is the key it uses.
    day: now.toISOString().slice(0, 10),
  }).slice(0, 32);

  await db.insert(agentActions).values({
    id: actionId,
    intentId,
    agentId: input.agentId,
    authorityId: authority.id,
    policyId,
    toolName: parsed.proposal.toolName,
    toolArgs: parsed.proposal as unknown as Record<string, unknown>,
    merchantId: parsed.proposal.merchantId,
    amountMinor: parsed.proposal.amountMinor,
    currency: parsed.proposal.currency,
    decision: decision.decision,
    decisionReasons: decision.reasons,
    nonce,
    idempotencyKey,
  });

  const toolCallId = "tcl_" + nonce.slice(0, 20);

  await record({
    eventType: "ACTION_PROPOSED",
    event: {
      actionId,
      toolName: parsed.proposal.toolName,
      toolArgs: parsed.proposal as unknown as Record<string, unknown>,
      nonce,
      idempotencyKey,
    },
    references: {
      agentId: input.agentId,
      authorityId: authority.id,
      policyId,
      actionId,
      intentHash: parsed.intentHash,
      toolCallId,
      merchantId: parsed.proposal.merchantId,
    },
    actionId,
    agentId: input.agentId,
  });

  await record({
    eventType: "POLICY_EVALUATED",
    event: {
      decision: decision.decision,
      policyVersion: decision.policyVersion,
      rulesHash: decision.rulesHash,
      // Every rule, passed and failed. A receipt that lists only the failures
      // cannot show that a rule existed and was checked.
      rules: decision.rules as unknown as Record<string, unknown>[],
      reasons: decision.reasons,
    },
    references: {
      agentId: input.agentId,
      authorityId: authority.id,
      policyId,
      actionId,
      intentHash: parsed.intentHash,
      toolCallId,
      merchantId: parsed.proposal.merchantId,
    },
    actionId,
    agentId: input.agentId,
  });

  if (decision.decision !== "ALLOWED") {
    await record({
      eventType: "PAYMENT_DENIED",
      event: {
        decision: decision.decision,
        amountMinor: parsed.proposal.amountMinor,
        currency: parsed.proposal.currency,
        reasons: decision.reasons,
        label: PAYMENT_LABEL,
      },
      references: {
        agentId: input.agentId,
        authorityId: authority.id,
        policyId,
        actionId,
        intentHash: parsed.intentHash,
        toolCallId,
        merchantId: parsed.proposal.merchantId,
      },
      actionId,
      agentId: input.agentId,
    });

    return {
      intentId,
      actionId,
      decision: decision.decision,
      reasons: decision.reasons,
      receiptIds,
      paymentState: null,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      ignoredDirectives: parsed.ignoredDirectives,
      signLatenciesMs,
    };
  }

  /* -- 4. authorization and payment --------------------------------------- */

  const order = await createOrder(db, {
    actionId,
    merchantId: parsed.proposal.merchantId,
    amountMinor: parsed.proposal.amountMinor,
    currency: parsed.proposal.currency,
    seed: input.seed,
  });

  await record({
    eventType: "PAYMENT_AUTHORIZED",
    event: {
      amountMinor: parsed.proposal.amountMinor,
      currency: parsed.proposal.currency,
      decision: "ALLOWED",
      label: PAYMENT_LABEL,
    },
    references: {
      agentId: input.agentId,
      authorityId: authority.id,
      policyId,
      actionId,
      intentHash: parsed.intentHash,
      toolCallId,
      merchantId: parsed.proposal.merchantId,
      razorpayOrderId: order.razorpayOrderId,
    },
    actionId,
    paymentId: order.paymentRowId,
    agentId: input.agentId,
  });

  const outcome = await capture(db, order.paymentRowId, input.seed + 1);

  await record({
    eventType: "PAYMENT_ATTEMPTED",
    event: {
      amountMinor: parsed.proposal.amountMinor,
      currency: parsed.proposal.currency,
      result: outcome.state,
      label: PAYMENT_LABEL,
    },
    references: {
      agentId: input.agentId,
      authorityId: authority.id,
      policyId,
      actionId,
      intentHash: parsed.intentHash,
      toolCallId,
      merchantId: parsed.proposal.merchantId,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: outcome.razorpayPaymentId,
    },
    actionId,
    paymentId: order.paymentRowId,
    agentId: input.agentId,
  });

  /* -- 5. state verification ---------------------------------------------- */

  // Read the state back rather than asserting the outcome of the call that
  // produced it. Section 108, and the reason the vulnerable-agent literature
  // calls this "hallucinated payment success".
  const verified = await readPaymentState(db, order.paymentRowId);

  if (verified.state === "CAPTURED") {
    await db
      .update(authorities)
      .set({ spentMinor: authority.spentMinor + parsed.proposal.amountMinor })
      .where(eq(authorities.id, authority.id));
  }

  await record({
    eventType: verified.state === "CAPTURED" ? "PAYMENT_VERIFIED" : "PAYMENT_FAILED",
    event: {
      amountMinor: verified.amountMinor,
      currency: verified.currency,
      result: verified.state,
      failureReason: verified.failureReason,
      // What was asserted vs what the gateway says. When these differ the
      // receipt shows the difference rather than the claim.
      assertedResult: outcome.state,
      stateReadBack: true,
      label: PAYMENT_LABEL,
    },
    references: {
      agentId: input.agentId,
      authorityId: authority.id,
      policyId,
      actionId,
      intentHash: parsed.intentHash,
      toolCallId,
      merchantId: parsed.proposal.merchantId,
      razorpayOrderId: verified.razorpayOrderId,
      razorpayPaymentId: verified.razorpayPaymentId,
    },
    actionId,
    paymentId: order.paymentRowId,
    agentId: input.agentId,
  });

  return {
    intentId,
    actionId,
    decision: decision.decision,
    reasons: decision.reasons,
    receiptIds,
    paymentState: verified.state,
    razorpayOrderId: verified.razorpayOrderId,
    razorpayPaymentId: verified.razorpayPaymentId,
    ignoredDirectives: parsed.ignoredDirectives,
    signLatenciesMs,
  };
}

export async function ensurePolicyVersion(db: Database): Promise<string> {
  const id = "pol_" + POLICY_VERSION.replace(/\./g, "-");
  const [existing] = await db.select().from(policyVersions).where(eq(policyVersions.id, id)).limit(1);
  if (existing) return existing.id;
  await db
    .insert(policyVersions)
    .values({
      id,
      version: POLICY_VERSION,
      rules: DEFAULT_RULES as unknown as Record<string, unknown>,
      rulesHash: rulesHash(DEFAULT_RULES),
      active: true,
    })
    .onConflictDoNothing();
  return id;
}
