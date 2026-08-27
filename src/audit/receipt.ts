import { canonicalBytes, canonicalize } from "../crypto/canonical";
import { hashBytes } from "../crypto/hash";
import { SIGNATURE_ALGORITHM } from "../crypto/mldsa";

/**
 * ===========================================================================
 * THE RECEIPT
 * ===========================================================================
 *
 * A receipt is the unit of audit. Section 15 forbids signing database rows, so
 * this is a format of its own: a receipt body is constructed deliberately,
 * canonicalized, hashed, signed, and only then written down. The database row
 * is a copy of the receipt, not the receipt.
 *
 * WHAT IS INSIDE THE SIGNATURE AND WHAT IS NOT
 * ---------------------------------------------------------------------------
 * Signed (the `ReceiptBody`):
 *   schema version, receipt id, event type and version, timestamp, the whole
 *   `event` object, every reference (agent, authority, policy, action, intent,
 *   tool call, merchant, order, payment), the previous receipt hash, and the
 *   signing key id.
 *
 * NOT signed:
 *   the Merkle batch id, the Merkle root, the proof, and the row's storage
 *   metadata. These cannot be signed: the batch does not exist yet when the
 *   receipt is signed, and a batch is sealed over receipts that are already
 *   final. Anchoring is a later, separate statement about the same payload
 *   hash. Conflating the two is how systems end up claiming a signature
 *   proves inclusion.
 *
 * THE SIGNING KEY ID IS INSIDE THE BODY
 * ---------------------------------------------------------------------------
 * Deliberately. If the key id sat outside the signature, an attacker holding
 * any valid key could re-point a receipt at their own key and the signature
 * would still check out against it. Binding the key id into the signed bytes
 * means a receipt names the key that signed it and cannot be re-attributed.
 */

export const RECEIPT_SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  "INTENT_RECEIVED",
  "ACTION_PROPOSED",
  "AUTHORITY_CHECKED",
  "POLICY_EVALUATED",
  "PAYMENT_AUTHORIZED",
  "PAYMENT_ATTEMPTED",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "PAYMENT_DENIED",
  "WEBHOOK_RECEIVED",
  "AUTHORITY_REVOKED",
  "HUMAN_REVIEW",
  "CORRECTION",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ReceiptReferences {
  agentId: string | null;
  authorityId: string | null;
  policyId: string | null;
  actionId: string | null;
  intentHash: string | null;
  toolCallId: string | null;
  merchantId: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
}

/** The exact object that gets canonicalized and signed. Nothing else is signed. */
export interface ReceiptBody {
  schemaVersion: number;
  receiptId: string;
  eventType: EventType;
  eventVersion: number;
  timestamp: string;
  event: Record<string, unknown>;
  references: ReceiptReferences;
  previousReceiptHash: string | null;
  signingKeyId: string;
}

export interface SignedReceipt {
  body: ReceiptBody;
  payloadHash: string;
  signature: string;
  signatureAlgorithm: typeof SIGNATURE_ALGORITHM;
}

/**
 * The genesis previous-hash.
 *
 * The first receipt in a ledger has no predecessor. It records null rather than
 * a zero hash, because a zero hash is a value an attacker can also write and
 * null is a shape the verifier can check exactly once, at sequence 1.
 */
export const GENESIS_PREVIOUS_HASH = null;

export function receiptCanonicalBytes(body: ReceiptBody): Uint8Array {
  return canonicalBytes(body);
}

export function receiptCanonicalString(body: ReceiptBody): string {
  return canonicalize(body);
}

export function receiptPayloadHash(body: ReceiptBody): string {
  return hashBytes(receiptCanonicalBytes(body));
}

export function emptyReferences(): ReceiptReferences {
  // Every field present and explicitly null. Absent keys and null keys
  // canonicalize differently, so a receipt that omitted a reference would not
  // verify against one that nulled it -- and which of the two a writer produced
  // must never depend on how the object was built.
  return {
    agentId: null,
    authorityId: null,
    policyId: null,
    actionId: null,
    intentHash: null,
    toolCallId: null,
    merchantId: null,
    razorpayOrderId: null,
    razorpayPaymentId: null,
  };
}

/**
 * The fields whose alteration must break verification.
 *
 * Used by the tamper demo and the mutation engine to name the field it changed.
 * Every one of these is inside the signed body; the list exists so the UI can
 * enumerate them, not so the verifier can special-case them. The verifier
 * checks the bytes, and the bytes cover strictly more than this list.
 */
export const CRITICAL_FIELDS = [
  "event.amountMinor",
  "event.currency",
  "event.decision",
  "event.result",
  "eventType",
  "timestamp",
  "references.agentId",
  "references.authorityId",
  "references.policyId",
  "references.intentHash",
  "references.toolCallId",
  "references.razorpayOrderId",
  "references.razorpayPaymentId",
  "previousReceiptHash",
  "signingKeyId",
] as const;
