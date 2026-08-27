import { hashCanonical } from "../crypto/hash";

/**
 * The policy engine.
 *
 * DETERMINISTIC. NO MODEL. NO NETWORK.
 * ---------------------------------------------------------------------------
 * Section 5 forbids the agent from holding unbounded payment authority, and the
 * only way to mean that is for the decision to be made somewhere the agent
 * cannot influence. The agent produces a proposal; this function decides. It
 * takes a proposal and an authority and returns a verdict, and given the same
 * two inputs it returns the same verdict on any machine at any time -- which is
 * what makes the decision auditable at all. A decision that depends on a model
 * cannot be re-derived from the receipt, and a decision that cannot be
 * re-derived is not evidence of anything.
 *
 * EVERY RULE IS EVALUATED. NO SHORT CIRCUIT.
 * ---------------------------------------------------------------------------
 * The first failing rule does not end the evaluation. An action that violates
 * the spend cap AND uses a merchant outside the allowlist is a different
 * finding from one that only does the first, and an operator reading the
 * receipt six months later needs to see both. Short-circuiting would make the
 * receipt say only what the engine happened to notice first.
 */

export const POLICY_VERSION = "1.2.0";

export type RuleId =
  | "AUTHORITY_ACTIVE"
  | "AUTHORITY_WINDOW"
  | "TOOL_PERMITTED"
  | "MERCHANT_ALLOWLISTED"
  | "CURRENCY_MATCHES"
  | "AMOUNT_POSITIVE"
  | "PER_ACTION_CAP"
  | "REMAINING_CAP"
  | "AMOUNT_REVIEW_THRESHOLD"
  | "INTENT_CONFIDENCE";

export interface PolicyRules {
  version: string;
  /** Amounts at or above this need a person, even inside the cap. Minor units. */
  humanReviewThresholdMinor: number;
  /** Below this parser confidence the action is not auto-approved. Percent. */
  minimumIntentConfidence: number;
}

export const DEFAULT_RULES: PolicyRules = {
  version: POLICY_VERSION,
  // Tuned, not derived: 50,000 paise (INR 500) is chosen so the demonstration
  // corpus produces a workable number of review cases. There is no empirical
  // basis for this number and a real deployment would set it from its own loss
  // data.
  humanReviewThresholdMinor: 5_000_00,
  // Tuned, not derived: same reasoning. 70 is a plausible operating point, not
  // a measured one.
  minimumIntentConfidence: 70,
};

export interface PolicyInput {
  now: Date;
  authority: {
    id: string;
    state: "ACTIVE" | "EXPIRED" | "REVOKED" | "EXHAUSTED";
    currency: string;
    capMinor: number;
    spentMinor: number;
    perActionCapMinor: number;
    merchantAllowlist: string[];
    permittedTools: string[];
    notBefore: Date;
    expiresAt: Date;
  };
  proposal: {
    toolName: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
    intentConfidence: number;
  };
}

export interface RuleResult {
  id: RuleId;
  passed: boolean;
  requiresHuman: boolean;
  detail: string;
}

export interface PolicyDecision {
  decision: "ALLOWED" | "DENIED" | "HUMAN_REVIEW";
  reasons: string[];
  rules: RuleResult[];
  policyVersion: string;
  rulesHash: string;
}

export function rulesHash(rules: PolicyRules): string {
  return hashCanonical(rules);
}

export function evaluate(input: PolicyInput, rules: PolicyRules = DEFAULT_RULES): PolicyDecision {
  const { authority: a, proposal: p, now } = input;
  const results: RuleResult[] = [];

  const rule = (id: RuleId, passed: boolean, detail: string, requiresHuman = false): void => {
    results.push({ id, passed, requiresHuman, detail });
  };

  rule(
    "AUTHORITY_ACTIVE",
    a.state === "ACTIVE",
    a.state === "ACTIVE" ? "Authority is ACTIVE." : "Authority is " + a.state + ".",
  );

  const inWindow = now >= a.notBefore && now <= a.expiresAt;
  rule(
    "AUTHORITY_WINDOW",
    inWindow,
    inWindow
      ? "Within the validity window, which ends " + a.expiresAt.toISOString() + "."
      : now > a.expiresAt
        ? "The grant expired at " + a.expiresAt.toISOString() + "."
        : "The grant is not valid until " + a.notBefore.toISOString() + ".",
  );

  const toolOk = a.permittedTools.includes(p.toolName);
  rule(
    "TOOL_PERMITTED",
    toolOk,
    toolOk
      ? "Tool " + p.toolName + " is delegated."
      : "Tool " + p.toolName + " is not in the delegated set (" + a.permittedTools.join(", ") + ").",
  );

  const merchantOk = a.merchantAllowlist.includes(p.merchantId);
  rule(
    "MERCHANT_ALLOWLISTED",
    merchantOk,
    merchantOk
      ? "Merchant " + p.merchantId + " is allowlisted."
      : "Merchant " + p.merchantId + " is not on the allowlist for this grant.",
  );

  const currencyOk = a.currency === p.currency;
  rule(
    "CURRENCY_MATCHES",
    currencyOk,
    currencyOk
      ? "Currency " + p.currency + " matches the grant."
      : "The grant is denominated in " +
        a.currency +
        " and the action is in " +
        p.currency +
        ". No conversion is performed, because a cap converted at an unstated rate is not a cap.",
  );

  const amountOk = Number.isInteger(p.amountMinor) && p.amountMinor > 0;
  rule(
    "AMOUNT_POSITIVE",
    amountOk,
    amountOk ? "Amount is a positive integer in minor units." : "Amount is not a positive integer in minor units.",
  );

  const perActionOk = p.amountMinor <= a.perActionCapMinor;
  rule(
    "PER_ACTION_CAP",
    perActionOk,
    perActionOk
      ? "Within the per-action cap."
      : "Exceeds the per-action cap of " + a.perActionCapMinor + " minor units.",
  );

  const remaining = a.capMinor - a.spentMinor;
  const remainingOk = p.amountMinor <= remaining;
  rule(
    "REMAINING_CAP",
    remainingOk,
    remainingOk
      ? remaining - p.amountMinor + " minor units would remain."
      : "Only " + remaining + " minor units remain of a " + a.capMinor + " cap.",
  );

  // These two do not deny. They escalate. The distinction matters: a denial
  // says the action was outside the authority granted, and an escalation says
  // the authority covers it but the system will not act alone.
  const belowReviewThreshold = p.amountMinor < rules.humanReviewThresholdMinor;
  rule(
    "AMOUNT_REVIEW_THRESHOLD",
    belowReviewThreshold,
    belowReviewThreshold
      ? "Below the human-review threshold."
      : "At or above the " + rules.humanReviewThresholdMinor + " minor-unit review threshold.",
    !belowReviewThreshold,
  );

  const confidentEnough = p.intentConfidence >= rules.minimumIntentConfidence;
  rule(
    "INTENT_CONFIDENCE",
    confidentEnough,
    confidentEnough
      ? "Intent parsed at " + p.intentConfidence + "% confidence."
      : "Intent parsed at only " +
        p.intentConfidence +
        "%. Section 169 requires a low-confidence action be escalated rather than guessed at.",
    !confidentEnough,
  );

  const hardFailures = results.filter((r) => !r.passed && !r.requiresHuman);
  const escalations = results.filter((r) => !r.passed && r.requiresHuman);

  const decision: PolicyDecision["decision"] =
    hardFailures.length > 0 ? "DENIED" : escalations.length > 0 ? "HUMAN_REVIEW" : "ALLOWED";

  const reasons =
    decision === "ALLOWED"
      ? ["Every rule in policy " + rules.version + " passed."]
      : [...hardFailures, ...escalations].map((r) => r.id + ": " + r.detail);

  return { decision, reasons, rules: results, policyVersion: rules.version, rulesHash: rulesHash(rules) };
}
