import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { EventType } from "../audit/receipt";

/* -------------------------------------------------------------------------- */
/* Signing keys                                                               */
/* -------------------------------------------------------------------------- */

export const KEY_STATES = ["PENDING", "ACTIVE", "ROTATING", "RETIRED", "COMPROMISED"] as const;
export type KeyState = (typeof KEY_STATES)[number];

/**
 * The key table stores the private key ONLY for development keys, and every row
 * says which it is. Section 28 is explicit that production key material does not
 * live here; the `custody` column makes a row that violates that visible rather
 * than implicit, and the verifier surfaces it on every receipt a development key
 * signed.
 */
export const signingKeys = pgTable(
  "signing_keys",
  {
    id: text("id").primaryKey(),
    algorithm: text("algorithm").notNull(),
    custody: text("custody").$type<"DEVELOPMENT_SEED" | "EXTERNAL_HSM">().notNull(),
    state: text("state").$type<KeyState>().notNull(),
    publicKey: text("public_key").notNull(),
    /** Null for any key not held by this process. Never logged, never exported. */
    privateKey: text("private_key"),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [index("signing_keys_state_idx").on(t.state)],
);

/* -------------------------------------------------------------------------- */
/* Authority                                                                  */
/* -------------------------------------------------------------------------- */

export const AUTHORITY_STATES = ["ACTIVE", "EXPIRED", "REVOKED", "EXHAUSTED"] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

export const authorities = pgTable(
  "authorities",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    principal: text("principal").notNull(),
    state: text("state").$type<AuthorityState>().notNull(),
    currency: text("currency").notNull(),
    /** Minor units. Money is integers here and nowhere else in this codebase is it not. */
    capMinor: bigint("cap_minor", { mode: "number" }).notNull(),
    spentMinor: bigint("spent_minor", { mode: "number" }).notNull().default(0),
    perActionCapMinor: bigint("per_action_cap_minor", { mode: "number" }).notNull(),
    merchantAllowlist: jsonb("merchant_allowlist").$type<string[]>().notNull(),
    permittedTools: jsonb("permitted_tools").$type<string[]>().notNull(),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("authorities_agent_idx").on(t.agentId), index("authorities_state_idx").on(t.state)],
);

/* -------------------------------------------------------------------------- */
/* Policy                                                                     */
/* -------------------------------------------------------------------------- */

export const policyVersions = pgTable("policy_versions", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  rules: jsonb("rules").$type<Record<string, unknown>>().notNull(),
  rulesHash: text("rules_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Agent activity                                                             */
/* -------------------------------------------------------------------------- */

export const intents = pgTable("intents", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  rawText: text("raw_text").notNull(),
  /** Hash of the canonical parsed intent. What receipts reference. */
  intentHash: text("intent_hash").notNull(),
  parsed: jsonb("parsed").$type<Record<string, unknown>>().notNull(),
  confidence: integer("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ACTION_DECISIONS = ["ALLOWED", "DENIED", "HUMAN_REVIEW"] as const;
export type ActionDecision = (typeof ACTION_DECISIONS)[number];

export const agentActions = pgTable(
  "agent_actions",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").notNull(),
    agentId: text("agent_id").notNull(),
    authorityId: text("authority_id").notNull(),
    policyId: text("policy_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolArgs: jsonb("tool_args").$type<Record<string, unknown>>().notNull(),
    merchantId: text("merchant_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    decision: text("decision").$type<ActionDecision>().notNull(),
    decisionReasons: jsonb("decision_reasons").$type<string[]>().notNull(),
    nonce: text("nonce").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_actions_nonce_key").on(t.nonce),
    uniqueIndex("agent_actions_idempotency_key").on(t.idempotencyKey),
    index("agent_actions_decision_idx").on(t.decision),
  ],
);

/* -------------------------------------------------------------------------- */
/* Payments (simulated Razorpay)                                              */
/* -------------------------------------------------------------------------- */

export const PAYMENT_STATES = ["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    razorpayOrderId: text("razorpay_order_id").notNull(),
    razorpayPaymentId: text("razorpay_payment_id"),
    state: text("state").$type<PaymentState>().notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    merchantId: text("merchant_id").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payments_order_key").on(t.razorpayOrderId), index("payments_state_idx").on(t.state)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    razorpayEventId: text("razorpay_event_id").notNull(),
    eventName: text("event_name").notNull(),
    paymentId: text("payment_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    /** Set when this delivery repeats one already processed. */
    duplicateOfId: text("duplicate_of_id"),
    appliedStateChange: boolean("applied_state_change").notNull(),
    deliverySequence: integer("delivery_sequence").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_event_key").on(t.razorpayEventId)],
);

/* -------------------------------------------------------------------------- */
/* The ledger                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Append-only. Enforced by a database trigger installed in the migration, not
 * by application code -- application-level immutability is a convention, and a
 * convention is not a control.
 *
 * The trigger stops the application, an ORM mistake and a careless console
 * session. It does not stop a database superuser, who can drop it. That is not
 * a gap in the design; it is the reason receipts are signed at all. Section 105
 * is explicit: a compromised database can rewrite rows, and the system detects
 * that on verification rather than pretending it cannot happen.
 *
 * Note what is NOT a column here: the Merkle batch. A receipt cannot record its
 * own anchoring, because the batch does not exist when the receipt is written
 * and setting it later would require an UPDATE -- which is exactly what the
 * trigger refuses. Anchoring lives in `merkleLeaves`, as a separate later
 * statement about an already-final payload hash.
 */
export const auditReceipts = pgTable(
  "audit_receipts",
  {
    id: text("id").primaryKey(),
    /** Ledger position. Gapless and assigned by the database. */
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    eventType: text("event_type").$type<EventType>().notNull(),
    eventVersion: integer("event_version").notNull(),
    /** The exact signed object. Canonicalizing this reproduces the signed bytes. */
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    previousReceiptHash: text("previous_receipt_hash"),
    signature: text("signature"),
    signatureAlgorithm: text("signature_algorithm").notNull(),
    signingKeyId: text("signing_key_id").notNull(),
    actionId: text("action_id"),
    paymentId: text("payment_id"),
    agentId: text("agent_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_receipts_sequence_key").on(t.sequence),
    uniqueIndex("audit_receipts_payload_hash_key").on(t.payloadHash),
    index("audit_receipts_event_type_idx").on(t.eventType),
    index("audit_receipts_action_idx").on(t.actionId),
  ],
);

export const merkleBatches = pgTable("merkle_batches", {
  id: text("id").primaryKey(),
  root: text("root").notNull(),
  algorithm: text("algorithm").notNull(),
  treeSize: integer("tree_size").notNull(),
  fromSequence: bigint("from_sequence", { mode: "number" }).notNull(),
  toSequence: bigint("to_sequence", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const merkleLeaves = pgTable(
  "merkle_leaves",
  {
    batchId: text("batch_id").notNull(),
    leafIndex: integer("leaf_index").notNull(),
    receiptId: text("receipt_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    leafHash: text("leaf_hash").notNull(),
  },
  (t) => [
    uniqueIndex("merkle_leaves_key").on(t.batchId, t.leafIndex),
    index("merkle_leaves_receipt_idx").on(t.receiptId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Human review                                                               */
/* -------------------------------------------------------------------------- */

export const humanReviews = pgTable("human_reviews", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  reviewer: text("reviewer").notNull(),
  outcome: text("outcome").$type<"UPHELD" | "OVERRIDDEN">().notNull(),
  justification: text("justification").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export const evaluationRuns = pgTable("evaluation_runs", {
  id: text("id").primaryKey(),
  datasetVersion: text("dataset_version").notNull(),
  cryptoVersion: text("crypto_version").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  split: text("split").$type<"development" | "held-out">().notNull(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
