CREATE TABLE "agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"authority_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_args" jsonb NOT NULL,
	"merchant_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"decision" text NOT NULL,
	"decision_reasons" jsonb NOT NULL,
	"nonce" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"previous_receipt_hash" text,
	"signature" text,
	"signature_algorithm" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"action_id" text,
	"payment_id" text,
	"agent_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorities" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"principal" text NOT NULL,
	"state" text NOT NULL,
	"currency" text NOT NULL,
	"cap_minor" bigint NOT NULL,
	"spent_minor" bigint DEFAULT 0 NOT NULL,
	"per_action_cap_minor" bigint NOT NULL,
	"merchant_allowlist" jsonb NOT NULL,
	"permitted_tools" jsonb NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_version" text NOT NULL,
	"crypto_version" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"split" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"outcome" text NOT NULL,
	"justification" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"intent_hash" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"confidence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merkle_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"root" text NOT NULL,
	"algorithm" text NOT NULL,
	"tree_size" integer NOT NULL,
	"from_sequence" bigint NOT NULL,
	"to_sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merkle_leaves" (
	"batch_id" text NOT NULL,
	"leaf_index" integer NOT NULL,
	"receipt_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"leaf_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text,
	"state" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"merchant_id" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"rules" jsonb NOT NULL,
	"rules_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"algorithm" text NOT NULL,
	"custody" text NOT NULL,
	"state" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"razorpay_event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"payment_id" text,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"duplicate_of_id" text,
	"applied_state_change" boolean NOT NULL,
	"delivery_sequence" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actions_nonce_key" ON "agent_actions" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actions_idempotency_key" ON "agent_actions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_actions_decision_idx" ON "agent_actions" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_receipts_sequence_key" ON "audit_receipts" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_receipts_payload_hash_key" ON "audit_receipts" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "audit_receipts_event_type_idx" ON "audit_receipts" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_receipts_action_idx" ON "audit_receipts" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "authorities_agent_idx" ON "authorities" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "authorities_state_idx" ON "authorities" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "merkle_leaves_key" ON "merkle_leaves" USING btree ("batch_id","leaf_index");--> statement-breakpoint
CREATE INDEX "merkle_leaves_receipt_idx" ON "merkle_leaves" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_key" ON "payments" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE INDEX "payments_state_idx" ON "payments" USING btree ("state");--> statement-breakpoint
CREATE INDEX "signing_keys_state_idx" ON "signing_keys" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_event_key" ON "webhook_events" USING btree ("razorpay_event_id");--> statement-breakpoint
-- ===========================================================================
-- APPEND-ONLY LEDGER (specification sections 40 and 75)
-- ===========================================================================
-- Immutability enforced by the database, not by application code. Application
-- level immutability is a convention, and a convention is not a control: one
-- ORM call with the wrong method, one console session, and the audit trail is
-- quietly editable.
--
-- What this stops: the application, a mistaken migration, an operator with an
-- ordinary connection.
-- What this does NOT stop: a database superuser, who can drop the trigger. That
-- is not a gap in the design -- it is the reason receipts carry signatures at
-- all. Section 105 assumes the database can be rewritten and requires the
-- system to DETECT it rather than pretend it cannot happen.
--
-- Corrections are appended as CORRECTION receipts (section 41). Nothing is ever
-- overwritten, so a wrong receipt and its correction both stay in the record.
CREATE OR REPLACE FUNCTION audit_receipts_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'audit_receipts is append-only: % was refused. Append a CORRECTION receipt instead.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_receipts_no_update
  BEFORE UPDATE ON audit_receipts
  FOR EACH ROW EXECUTE FUNCTION audit_receipts_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_receipts_no_delete
  BEFORE DELETE ON audit_receipts
  FOR EACH ROW EXECUTE FUNCTION audit_receipts_append_only();
