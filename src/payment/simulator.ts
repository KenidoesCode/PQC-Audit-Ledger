import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { payments, webhookEvents } from "../db/schema";
import { AppError } from "../shared/errors";
import { getEnv } from "../shared/env";
import { newId } from "../shared/ids";
import { Rng } from "../shared/rng";

/**
 * The Razorpay simulator.
 *
 * NO LIVE MONEY IS REACHABLE FROM THIS PROCESS. Not "no live money is
 * intended" -- no code path in this repository calls a Razorpay endpoint. The
 * adapter interface below is the shape a real adapter would implement, and the
 * simulator is the only implementation that exists. Section 65 asks for a
 * simulator; section 187 requires every payment be labelled as such, and the
 * UI does so from `PAYMENT_LABEL` rather than from a hardcoded string in a
 * component that someone could change without noticing.
 *
 * Identifier shapes match Razorpay's (`order_...`, `pay_...`) because receipts
 * bind those identifiers and a receipt whose order id does not look like an
 * order id would be useless as a demonstration of the binding. They are
 * simulated identifiers and they are marked as such in the receipt event body.
 */

export const PAYMENT_LABEL = "SIMULATED PAYMENT — NO LIVE MONEY";

function razorpayStyleId(prefix: "order" | "pay", rng: Rng): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 14; i += 1) out += alphabet[rng.int(0, alphabet.length - 1)];
  return prefix + "_" + out;
}

export interface CreatedOrder {
  paymentRowId: string;
  razorpayOrderId: string;
  amountMinor: number;
  currency: string;
}

export async function createOrder(
  db: Database,
  input: { actionId: string; merchantId: string; amountMinor: number; currency: string; seed: number },
): Promise<CreatedOrder> {
  const rng = new Rng(input.seed);
  const id = newId("pay");
  const razorpayOrderId = razorpayStyleId("order", rng);

  await db.insert(payments).values({
    id,
    actionId: input.actionId,
    razorpayOrderId,
    state: "CREATED",
    amountMinor: input.amountMinor,
    currency: input.currency,
    merchantId: input.merchantId,
  });

  return { paymentRowId: id, razorpayOrderId, amountMinor: input.amountMinor, currency: input.currency };
}

export interface CaptureOutcome {
  state: "CAPTURED" | "FAILED";
  razorpayPaymentId: string | null;
  failureReason: string | null;
}

/**
 * Attempts capture.
 *
 * Failures are seeded, not random, so a corpus is reproducible. The failure
 * rate is a property of the simulator and not of the ledger: a failed payment
 * still produces a receipt, because section 18 of the success conditions
 * requires denied and failed actions to be as auditable as successful ones.
 */
export async function capture(
  db: Database,
  paymentRowId: string,
  seed: number,
): Promise<CaptureOutcome> {
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentRowId)).limit(1);
  if (!row) throw new AppError("PAYMENT_NOT_FOUND", "No simulated payment " + paymentRowId + ".");

  const rng = new Rng(seed);
  // Tuned for the demonstration corpus: roughly one attempt in eight fails, so
  // the failure paths are exercised without dominating the ledger. Not derived
  // from any real gateway's success rate.
  const fails = rng.chance(0.125);

  if (fails) {
    const reason = rng.pick(["BANK_DECLINED", "GATEWAY_TIMEOUT", "INSUFFICIENT_FUNDS", "RISK_BLOCKED"]);
    await db
      .update(payments)
      .set({ state: "FAILED", failureReason: reason })
      .where(eq(payments.id, paymentRowId));
    return { state: "FAILED", razorpayPaymentId: null, failureReason: reason };
  }

  const razorpayPaymentId = razorpayStyleId("pay", rng);
  await db
    .update(payments)
    .set({ state: "CAPTURED", razorpayPaymentId })
    .where(eq(payments.id, paymentRowId));
  return { state: "CAPTURED", razorpayPaymentId, failureReason: null };
}

/**
 * Reads the payment's state back from the "gateway".
 *
 * Section 108 requires the state be verified rather than assumed from the call
 * that created it. This is trivially true here because the simulator and the
 * store are the same table -- and that is exactly why the function exists as a
 * separate call: the code path that asserts an outcome reads it, so replacing
 * this file with a real adapter changes one function and not the audit logic.
 */
export async function readPaymentState(db: Database, paymentRowId: string) {
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentRowId)).limit(1);
  if (!row) throw new AppError("PAYMENT_NOT_FOUND", "No simulated payment " + paymentRowId + ".");
  return row;
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

export function signWebhook(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Constant-time comparison.
 *
 * A webhook signature compared with `===` leaks its prefix through timing. The
 * length check first is unavoidable and harmless -- length is not secret.
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = signWebhook(payload, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface WebhookOutcome {
  eventRowId: string;
  accepted: boolean;
  duplicate: boolean;
  appliedStateChange: boolean;
  reason: string;
}

/**
 * Ingests one webhook delivery.
 *
 * IDEMPOTENCY IS BY EVENT ID, ENFORCED BY A UNIQUE INDEX (sections 69 and 162).
 * A redelivery of an event already seen is recorded as a delivery and produces
 * a receipt, but changes no payment state. Recording it is the point: a
 * duplicate that leaves no trace is indistinguishable from one that was never
 * sent, and "the gateway delivered this four times" is exactly what an
 * investigator needs.
 *
 * OUT OF ORDER DELIVERY (section 70)
 * ---------------------------------------------------------------------------
 * A terminal state is never walked backwards. A `payment.failed` arriving after
 * a `payment.captured` is recorded and does not overwrite the capture, because
 * gateway deliveries are not ordered and the last one to arrive is not the most
 * recent one to have happened.
 */
export async function ingestWebhook(
  db: Database,
  input: {
    razorpayEventId: string;
    eventName: "payment.captured" | "payment.failed";
    paymentRowId: string;
    payloadJson: string;
    signature: string;
    deliverySequence: number;
  },
): Promise<WebhookOutcome> {
  const env = getEnv();
  const signatureValid = verifyWebhookSignature(input.payloadJson, input.signature, env.RAZORPAY_WEBHOOK_SECRET);

  const [existing] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.razorpayEventId, input.razorpayEventId))
    .limit(1);

  const id = newId("whk");

  if (existing) {
    await db.insert(webhookEvents).values({
      id,
      // The stored event id must stay unique, so a redelivery is recorded under
      // a derived id that names the original. The link is `duplicateOfId`.
      razorpayEventId: input.razorpayEventId + "#redelivery-" + input.deliverySequence,
      eventName: input.eventName,
      paymentId: input.paymentRowId,
      payload: JSON.parse(input.payloadJson) as Record<string, unknown>,
      signatureValid,
      duplicateOfId: existing.id,
      appliedStateChange: false,
      deliverySequence: input.deliverySequence,
    });
    return {
      eventRowId: id,
      accepted: signatureValid,
      duplicate: true,
      appliedStateChange: false,
      reason: "Event " + input.razorpayEventId + " was already processed. Recorded, no state change.",
    };
  }

  if (!signatureValid) {
    await db.insert(webhookEvents).values({
      id,
      razorpayEventId: input.razorpayEventId,
      eventName: input.eventName,
      paymentId: input.paymentRowId,
      payload: JSON.parse(input.payloadJson) as Record<string, unknown>,
      signatureValid: false,
      appliedStateChange: false,
      deliverySequence: input.deliverySequence,
    });
    return {
      eventRowId: id,
      accepted: false,
      duplicate: false,
      appliedStateChange: false,
      reason: "Webhook signature did not verify. Recorded and rejected.",
    };
  }

  const [payment] = await db.select().from(payments).where(eq(payments.id, input.paymentRowId)).limit(1);
  const terminal = payment?.state === "CAPTURED" || payment?.state === "REFUNDED";
  const applies = Boolean(payment) && !terminal;

  if (applies && payment) {
    await db
      .update(payments)
      .set(
        input.eventName === "payment.captured"
          ? { state: "CAPTURED" }
          : { state: "FAILED", failureReason: "WEBHOOK_REPORTED_FAILURE" },
      )
      .where(eq(payments.id, payment.id));
  }

  await db.insert(webhookEvents).values({
    id,
    razorpayEventId: input.razorpayEventId,
    eventName: input.eventName,
    paymentId: input.paymentRowId,
    payload: JSON.parse(input.payloadJson) as Record<string, unknown>,
    signatureValid: true,
    appliedStateChange: applies,
    deliverySequence: input.deliverySequence,
  });

  return {
    eventRowId: id,
    accepted: true,
    duplicate: false,
    appliedStateChange: applies,
    reason: applies
      ? "Applied " + input.eventName + "."
      : terminal
        ? "Payment is already in a terminal state. Delivery recorded; the state was not walked backwards."
        : "No such payment. Delivery recorded.",
  };
}
