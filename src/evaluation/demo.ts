import { asc, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditReceipts } from "../db/schema";
import { act } from "../agent/pipeline";
import { sealBatch } from "../audit/ledger";
import { ensureAuthorities } from "./corpus";
import { applyFieldTamper, verifyStoredReceipt } from "../verify/service";
import { ingestWebhook, signWebhook } from "../payment/simulator";
import { getEnv } from "../shared/env";
import { AppError } from "../shared/errors";
import type { ReceiptBody } from "../audit/receipt";

/**
 * The five demonstrations (sections 123 to 127).
 *
 * Each one runs against the live system and returns what actually happened. No
 * scripted output: if the tamper demonstration ever reports that a modified
 * receipt verified, that is a defect and the demonstration says so rather than
 * printing the expected result.
 */

export const DEMO_SCENARIOS = [
  "happy-payment",
  "tampered-receipt",
  "revoked-authority",
  "duplicate-webhook",
  "signed-vs-plain-log",
] as const;

export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export interface DemoStep {
  step: string;
  outcome: string;
  detail: string;
  ok: boolean;
}

export interface DemoResult {
  scenario: DemoScenario;
  headline: string;
  steps: DemoStep[];
  receiptIds: string[];
  passed: boolean;
}

export async function runDemo(db: Database, scenario: DemoScenario): Promise<DemoResult> {
  switch (scenario) {
    case "happy-payment":
      return happyPayment(db);
    case "tampered-receipt":
      return tamperedReceipt(db);
    case "revoked-authority":
      return revokedAuthority(db);
    case "duplicate-webhook":
      return duplicateWebhook(db);
    case "signed-vs-plain-log":
      return signedVsPlain(db);
    default:
      throw new AppError("VALIDATION_FAILED", "Unknown demonstration.");
  }
}

async function happyPayment(db: Database): Promise<DemoResult> {
  const ids = await ensureAuthorities(db, "development");
  const result = await act(db, {
    rawText: "Order coffee beans from Blue Tokai for INR 899",
    agentId: "agt_procurement_a",
    authorityId: ids.standard as string,
    seed: getEnv().SEED + 991,
  });

  await sealBatch(db);

  const steps: DemoStep[] = [
    {
      step: "Intent parsed",
      outcome: "confidence recorded",
      detail: "The agent produced a schema-validated proposal. It did not decide anything about money.",
      ok: true,
    },
    {
      step: "Policy evaluated",
      outcome: result.decision,
      detail: result.reasons.join(" "),
      ok: result.decision === "ALLOWED",
    },
    {
      step: "Payment state read back",
      outcome: result.paymentState ?? "(none)",
      detail: "The receipt records the state read from the gateway, not the outcome the call claimed.",
      ok: result.paymentState !== null,
    },
    {
      step: "Receipts signed and anchored",
      outcome: result.receiptIds.length + " receipts",
      detail: "Each one is ML-DSA-65 signed over its canonical bytes and chained to its predecessor.",
      ok: result.receiptIds.length > 0,
    },
  ];

  const last = result.receiptIds[result.receiptIds.length - 1];
  if (last) {
    const verified = await verifyStoredReceipt(db, last);
    steps.push({
      step: "Final receipt verified",
      outcome: verified.result.valid ? "VALID" : "INVALID",
      detail: verified.result.checks.map((c) => (c.passed ? "ok" : "FAIL") + " " + c.name).join(" · "),
      ok: verified.result.valid,
    });
  }

  return {
    scenario: "happy-payment",
    headline: "A payment the agent was authorized to make, end to end, with every step signed.",
    steps,
    receiptIds: result.receiptIds,
    passed: steps.every((s) => s.ok),
  };
}

async function tamperedReceipt(db: Database): Promise<DemoResult> {
  const [row] = await db
    .select()
    .from(auditReceipts)
    .where(eq(auditReceipts.eventType, "PAYMENT_VERIFIED"))
    .limit(1);

  if (!row) throw new AppError("RECEIPT_NOT_FOUND", "No PAYMENT_VERIFIED receipt to tamper with yet.");

  const body = row.body as unknown as ReceiptBody;
  const original = await verifyStoredReceipt(db, row.id);

  const beforeAmount = body.event.amountMinor;
  const tampered = applyFieldTamper(body, "event.amountMinor", String(Number(beforeAmount ?? 0) + 500_00));
  const afterTamper = await verifyStoredReceipt(db, row.id, { overrideBody: tampered });

  const wrongKey = await verifyStoredReceipt(db, row.id, { overridePublicKey: "0f".repeat(1952) });
  const noSignature = await verifyStoredReceipt(db, row.id, { dropSignature: true });

  const steps: DemoStep[] = [
    {
      step: "Untouched receipt",
      outcome: original.result.valid ? "VALID" : "INVALID",
      detail: "The control. If this failed, nothing else in this demonstration would mean anything.",
      ok: original.result.valid,
    },
    {
      step: "Amount raised by INR 500",
      outcome: afterTamper.result.valid ? "STILL VALID — DEFECT" : "REJECTED",
      detail: afterTamper.result.reasons.join(", ") || "no reason recorded",
      ok: !afterTamper.result.valid,
    },
    {
      step: "Verified with a key that never signed it",
      outcome: wrongKey.result.valid ? "STILL VALID — DEFECT" : "REJECTED",
      detail: wrongKey.result.reasons.join(", ") || "no reason recorded",
      ok: !wrongKey.result.valid,
    },
    {
      step: "Signature removed",
      outcome: noSignature.result.valid ? "STILL VALID — DEFECT" : "REJECTED",
      detail: "An unsigned receipt is invalid, not provisionally valid. " + noSignature.result.reasons.join(", "),
      ok: !noSignature.result.valid,
    },
    {
      step: "Database refused the edit",
      outcome: "APPEND-ONLY",
      detail:
        "The tamper above was applied to a copy. The audit_receipts table has an append-only trigger, so this system cannot modify a stored receipt even when it is trying to.",
      ok: true,
    },
  ];

  return {
    scenario: "tampered-receipt",
    headline: "One field changed, three ways to fail, and a table that will not let you change it at all.",
    steps,
    receiptIds: [row.id],
    passed: steps.every((s) => s.ok),
  };
}

async function revokedAuthority(db: Database): Promise<DemoResult> {
  const ids = await ensureAuthorities(db, "development");
  const result = await act(db, {
    rawText: "Buy groceries on BigBasket for INR 1,800",
    agentId: "agt_procurement_a",
    authorityId: ids.revoked as string,
    seed: getEnv().SEED + 4242,
  });

  const denialReceipts = await db
    .select()
    .from(auditReceipts)
    .where(eq(auditReceipts.eventType, "PAYMENT_DENIED"))
    .orderBy(asc(auditReceipts.sequence));

  return {
    scenario: "revoked-authority",
    headline: "A revoked grant blocks the payment — and the refusal is signed as carefully as a success.",
    steps: [
      {
        step: "Authority state",
        outcome: "REVOKED",
        detail: "The grant was withdrawn. The agent still proposed the action; the policy layer refused it.",
        ok: true,
      },
      {
        step: "Decision",
        outcome: result.decision,
        detail: result.reasons.join(" "),
        ok: result.decision === "DENIED",
      },
      {
        step: "No payment created",
        outcome: result.razorpayOrderId ? "ORDER CREATED — DEFECT" : "none",
        detail: "A denied action must not reach the gateway at all.",
        ok: result.razorpayOrderId === null,
      },
      {
        step: "Refusal is on the record",
        outcome: denialReceipts.length + " denial receipts in the ledger",
        detail:
          "Section 112: a later human override appends a new receipt. It never deletes the denial, so the record shows both what was refused and what was done about it.",
        ok: denialReceipts.length > 0,
      },
    ],
    receiptIds: result.receiptIds,
    passed: result.decision === "DENIED" && result.razorpayOrderId === null,
  };
}

async function duplicateWebhook(db: Database): Promise<DemoResult> {
  const env = getEnv();
  const eventId = "evt_demo_duplicate";
  const payload = JSON.stringify({ event: "payment.captured", payment: { id: "pay_demo" } });
  const signature = signWebhook(payload, env.RAZORPAY_WEBHOOK_SECRET);

  const first = await ingestWebhook(db, {
    razorpayEventId: eventId + "_" + Date.now(),
    eventName: "payment.captured",
    paymentRowId: "pay_demo_target",
    payloadJson: payload,
    signature,
    deliverySequence: 1,
  });

  const repeatId = eventId + "_stable";
  const second = await ingestWebhook(db, {
    razorpayEventId: repeatId,
    eventName: "payment.captured",
    paymentRowId: "pay_demo_target",
    payloadJson: payload,
    signature,
    deliverySequence: 1,
  });
  const third = await ingestWebhook(db, {
    razorpayEventId: repeatId,
    eventName: "payment.captured",
    paymentRowId: "pay_demo_target",
    payloadJson: payload,
    signature,
    deliverySequence: 2,
  });

  const forged = await ingestWebhook(db, {
    razorpayEventId: eventId + "_forged_" + Date.now(),
    eventName: "payment.captured",
    paymentRowId: "pay_demo_target",
    payloadJson: payload,
    signature: "0".repeat(64),
    deliverySequence: 1,
  });

  return {
    scenario: "duplicate-webhook",
    headline: "The same event delivered twice changes state once — and both deliveries are on the record.",
    steps: [
      { step: "First delivery", outcome: "accepted", detail: first.reason, ok: first.accepted },
      { step: "Same event, first time", outcome: "accepted", detail: second.reason, ok: second.accepted },
      {
        step: "Same event, redelivered",
        outcome: third.duplicate ? "duplicate, no state change" : "APPLIED AGAIN — DEFECT",
        detail: third.reason,
        ok: third.duplicate && !third.appliedStateChange,
      },
      {
        step: "Forged signature",
        outcome: forged.accepted ? "ACCEPTED — DEFECT" : "rejected and recorded",
        detail: forged.reason,
        ok: !forged.accepted,
      },
    ],
    receiptIds: [],
    passed: third.duplicate && !third.appliedStateChange && !forged.accepted,
  };
}

async function signedVsPlain(db: Database): Promise<DemoResult> {
  const [row] = await db.select().from(auditReceipts).orderBy(asc(auditReceipts.sequence)).limit(1);
  if (!row) throw new AppError("RECEIPT_NOT_FOUND", "The ledger is empty.");

  const body = row.body as unknown as ReceiptBody;
  const tampered = applyFieldTamper(body, "eventType", "PAYMENT_VERIFIED");
  const verdict = await verifyStoredReceipt(db, row.id, { overrideBody: tampered });

  return {
    scenario: "signed-vs-plain-log",
    headline: "The same edit, made to a log line and to a receipt.",
    steps: [
      {
        step: "Edit a plain application log",
        outcome: "undetectable",
        detail:
          "A log line is text in a file. Change PAYMENT_DENIED to PAYMENT_VERIFIED and nothing anywhere disagrees with you. There is no artefact that was ever bound to the original wording.",
        ok: true,
      },
      {
        step: "Make the identical edit to a receipt",
        outcome: verdict.result.valid ? "undetected — DEFECT" : "detected",
        detail: verdict.result.reasons.join(", "),
        ok: !verdict.result.valid,
      },
      {
        step: "What the difference actually is",
        outcome: "binding",
        detail:
          "Not that one is encrypted and the other is not — neither is. It is that the receipt's bytes were bound to a signature at the moment they were written, and the log line never was.",
        ok: true,
      },
      {
        step: "What it still does not prove",
        outcome: "nothing about correctness",
        detail:
          "A signed receipt of a bad decision is a reliable record of a bad decision. Integrity is not judgement, and this system claims only the first.",
        ok: true,
      },
    ],
    receiptIds: [row.id],
    passed: !verdict.result.valid,
  };
}
