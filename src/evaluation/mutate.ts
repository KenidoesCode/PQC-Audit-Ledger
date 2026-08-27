import type { ReceiptBody } from "../audit/receipt";
import { Rng } from "../shared/rng";

/**
 * The mutation engine (section 96).
 *
 * Each mutation returns a receipt body that differs from the original in
 * exactly one field. The verifier is then asked whether it still verifies. It
 * must not, ever, for any of these -- and the evaluation reports the rate at
 * which that holds rather than asserting it.
 *
 * MUTATIONS MUST ACTUALLY CHANGE SOMETHING
 * ---------------------------------------------------------------------------
 * A mutation that happens to write back the value already there would be
 * counted as an undetected tamper and would drag the detection rate down for a
 * reason that has nothing to do with the verifier. Every mutation below either
 * derives a provably different value or reports that it could not apply, and
 * the evaluation excludes the ones that could not apply rather than scoring
 * them. That exclusion is reported in the output.
 */

export const MUTATION_TYPES = [
  "AMOUNT_CHANGE",
  "CURRENCY_CHANGE",
  "AGENT_CHANGE",
  "AUTHORITY_CHANGE",
  "POLICY_CHANGE",
  "DECISION_CHANGE",
  "TIMESTAMP_CHANGE",
  "ORDER_ID_CHANGE",
  "PAYMENT_ID_CHANGE",
  "RESULT_CHANGE",
  "INTENT_CHANGE",
  "TOOL_CALL_CHANGE",
  "EVENT_TYPE_CHANGE",
] as const;

export type MutationType = (typeof MUTATION_TYPES)[number];

export interface Mutation {
  type: MutationType;
  applied: boolean;
  field: string;
  before: unknown;
  after: unknown;
  body: ReceiptBody;
}

function clone(body: ReceiptBody): ReceiptBody {
  return JSON.parse(JSON.stringify(body)) as ReceiptBody;
}

function notApplied(type: MutationType, field: string, body: ReceiptBody): Mutation {
  return { type, applied: false, field, before: null, after: null, body };
}

export function mutate(body: ReceiptBody, type: MutationType, rng: Rng): Mutation {
  const next = clone(body);

  switch (type) {
    case "AMOUNT_CHANGE": {
      const before = next.event.amountMinor;
      if (typeof before !== "number") return notApplied(type, "event.amountMinor", body);
      // A meaningful amount change, not a one-paise nudge: an auditor should
      // not have to believe the verifier is sensitive to rounding to believe
      // it is sensitive to theft.
      next.event.amountMinor = before + 100_00 + rng.int(1, 500);
      return { type, applied: true, field: "event.amountMinor", before, after: next.event.amountMinor, body: next };
    }
    case "CURRENCY_CHANGE": {
      const before = next.event.currency;
      if (typeof before !== "string") return notApplied(type, "event.currency", body);
      next.event.currency = before === "USD" ? "INR" : "USD";
      return { type, applied: true, field: "event.currency", before, after: next.event.currency, body: next };
    }
    case "AGENT_CHANGE": {
      const before = next.references.agentId;
      if (before === null) return notApplied(type, "references.agentId", body);
      next.references.agentId = before + "_impostor";
      return { type, applied: true, field: "references.agentId", before, after: next.references.agentId, body: next };
    }
    case "AUTHORITY_CHANGE": {
      const before = next.references.authorityId;
      if (before === null) return notApplied(type, "references.authorityId", body);
      next.references.authorityId = "ath_forged_" + rng.int(1000, 9999);
      return {
        type,
        applied: true,
        field: "references.authorityId",
        before,
        after: next.references.authorityId,
        body: next,
      };
    }
    case "POLICY_CHANGE": {
      const before = next.references.policyId;
      if (before === null) return notApplied(type, "references.policyId", body);
      next.references.policyId = "pol_9-9-9";
      return { type, applied: true, field: "references.policyId", before, after: next.references.policyId, body: next };
    }
    case "DECISION_CHANGE": {
      const before = next.event.decision;
      if (typeof before !== "string") return notApplied(type, "event.decision", body);
      next.event.decision = before === "ALLOWED" ? "DENIED" : "ALLOWED";
      return { type, applied: true, field: "event.decision", before, after: next.event.decision, body: next };
    }
    case "TIMESTAMP_CHANGE": {
      const before = next.timestamp;
      const shifted = new Date(Date.parse(before) - (rng.int(1, 72) * 3_600_000));
      next.timestamp = shifted.toISOString().replace(/\.\d{3}Z$/, "Z");
      if (next.timestamp === before) return notApplied(type, "timestamp", body);
      return { type, applied: true, field: "timestamp", before, after: next.timestamp, body: next };
    }
    case "ORDER_ID_CHANGE": {
      const before = next.references.razorpayOrderId;
      if (before === null) return notApplied(type, "references.razorpayOrderId", body);
      next.references.razorpayOrderId = "order_" + rng.int(100000, 999999) + "forged";
      return {
        type,
        applied: true,
        field: "references.razorpayOrderId",
        before,
        after: next.references.razorpayOrderId,
        body: next,
      };
    }
    case "PAYMENT_ID_CHANGE": {
      const before = next.references.razorpayPaymentId;
      if (before === null) return notApplied(type, "references.razorpayPaymentId", body);
      next.references.razorpayPaymentId = "pay_" + rng.int(100000, 999999) + "forged";
      return {
        type,
        applied: true,
        field: "references.razorpayPaymentId",
        before,
        after: next.references.razorpayPaymentId,
        body: next,
      };
    }
    case "RESULT_CHANGE": {
      const before = next.event.result;
      if (typeof before !== "string") return notApplied(type, "event.result", body);
      next.event.result = before === "CAPTURED" ? "FAILED" : "CAPTURED";
      return { type, applied: true, field: "event.result", before, after: next.event.result, body: next };
    }
    case "INTENT_CHANGE": {
      const before = next.references.intentHash;
      if (before === null) return notApplied(type, "references.intentHash", body);
      next.references.intentHash = before.slice(0, -4) + "dead";
      return {
        type,
        applied: true,
        field: "references.intentHash",
        before,
        after: next.references.intentHash,
        body: next,
      };
    }
    case "TOOL_CALL_CHANGE": {
      const before = next.references.toolCallId;
      if (before === null) return notApplied(type, "references.toolCallId", body);
      next.references.toolCallId = "tcl_substituted" + rng.int(100, 999);
      return {
        type,
        applied: true,
        field: "references.toolCallId",
        before,
        after: next.references.toolCallId,
        body: next,
      };
    }
    case "EVENT_TYPE_CHANGE": {
      const before = next.eventType;
      next.eventType = before === "PAYMENT_VERIFIED" ? "PAYMENT_FAILED" : "PAYMENT_VERIFIED";
      if (next.eventType === before) return notApplied(type, "eventType", body);
      return { type, applied: true, field: "eventType", before, after: next.eventType, body: next };
    }
    default:
      return notApplied(type, "unknown", body);
  }
}

/**
 * A mutation that changes nothing at all -- a control.
 *
 * Section 93 asks for a false-verification rate, and a rate measured only over
 * tampered receipts cannot produce one. The control is an untouched receipt fed
 * through exactly the same path; if it fails to verify, the verifier is broken
 * in a way no amount of tamper detection would reveal.
 */
export function control(body: ReceiptBody): Mutation {
  return { type: "AMOUNT_CHANGE", applied: false, field: "(control: unmodified)", before: null, after: null, body };
}
