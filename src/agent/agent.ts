import { z } from "zod";

import { hashCanonical } from "../crypto/hash";

/**
 * The agent.
 *
 * WHAT IT DOES: turns a sentence into a structured, schema-validated proposal.
 * WHAT IT DOES NOT DO: decide anything about money.
 *
 * Section 4 asks why AI exists in this project at all, and this file is the
 * answer: natural-language intent is genuinely ambiguous and a parser is a
 * reasonable place for a model. Everything downstream of the proposal --
 * authority, caps, allowlists, the decision itself -- is deterministic code
 * that the agent cannot reach.
 *
 * NO MODEL IS CALLED HERE
 * ---------------------------------------------------------------------------
 * This is a deterministic parser with a model-shaped interface: the same schema
 * an LLM would be constrained to, the same confidence field, the same rejection
 * path for output that does not validate. That is a real limitation and it is
 * stated plainly rather than dressed up -- the demonstration has no model
 * provider configured, and a parser that pretends to be one would be a lie in
 * the architecture diagram.
 *
 * What it does buy: the injection tests are real. The parser is fed the same
 * hostile strings a model would be fed, and the assertion that a directive
 * inside item text cannot raise a spend cap is enforced by the structure --
 * the parser has no field in which to express "raise the cap", so an injected
 * instruction has nowhere to land. Section 113 asks for injection resistance,
 * and the structural version of it is stronger than a model that was merely
 * told to ignore instructions.
 */

export const PERMITTED_TOOLS = ["payments.create_order", "payments.capture", "payments.refund"] as const;
export type ToolName = (typeof PERMITTED_TOOLS)[number];

/** The proposal schema. An agent that cannot produce this produces nothing. */
export const ProposalSchema = z.object({
  toolName: z.enum(PERMITTED_TOOLS),
  merchantId: z.string().min(1).max(64),
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: z.enum(["INR"]),
  description: z.string().min(1).max(200),
  confidence: z.number().int().min(0).max(100),
});

export type Proposal = z.infer<typeof ProposalSchema>;

export interface ParsedIntent {
  proposal: Proposal;
  intentHash: string;
  /** Text the parser refused to treat as instruction. Section 113. */
  ignoredDirectives: string[];
}

/**
 * Phrases that look like instructions to the system rather than descriptions of
 * a purchase. They are not stripped, sanitised or obeyed -- they are recorded
 * as ignored, which is what makes the injection visible in the receipt instead
 * of silently absent.
 */
const DIRECTIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore (all |any )?(previous|prior|above) instructions?/i, label: "instruction override" },
  { pattern: /(raise|increase|remove|lift|disable) (the )?(spend )?(cap|limit)/i, label: "cap manipulation" },
  { pattern: /you are (now )?(an? )?(admin|administrator|root|superuser)/i, label: "authority escalation" },
  { pattern: /(skip|bypass|disable) (the )?(policy|check|verification|approval)/i, label: "control bypass" },
  { pattern: /send (the )?(funds?|money|payment) to/i, label: "beneficiary substitution" },
  { pattern: /system\s*:/i, label: "role injection" },
];

const AMOUNT_PATTERN = /(?:inr|rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

const MERCHANT_ALIASES: Record<string, string> = {
  "blue tokai": "mrc_blue_tokai",
  chaayos: "mrc_chaayos",
  "urban company": "mrc_urban_company",
  bigbasket: "mrc_bigbasket",
  zomato: "mrc_zomato",
  "reliance digital": "mrc_reliance_digital",
};

export function parseIntent(rawText: string, agentId: string): ParsedIntent {
  const ignoredDirectives = DIRECTIVE_PATTERNS.filter((d) => d.pattern.test(rawText)).map((d) => d.label);

  const amountMatch = AMOUNT_PATTERN.exec(rawText);
  const rupees = amountMatch ? Number.parseFloat((amountMatch[1] as string).replace(/,/g, "")) : Number.NaN;
  const amountMinor = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;

  const lower = rawText.toLowerCase();
  const merchantEntry = Object.entries(MERCHANT_ALIASES).find(([name]) => lower.includes(name));
  const merchantId = merchantEntry ? (merchantEntry[1] as string) : "mrc_unknown";

  const toolName: ToolName = /refund/i.test(rawText) ? "payments.refund" : "payments.create_order";

  /*
    Confidence is a function of what was actually recognised, not a number
    chosen to look plausible. Each missing signal costs a fixed amount, and the
    presence of an injected directive costs the most -- an input containing an
    instruction to the system is not a purchase description the parser
    understood, whatever else it managed to extract from it.
  */
  let confidence = 100;
  if (!amountMatch) confidence -= 45;
  if (!merchantEntry) confidence -= 30;
  if (ignoredDirectives.length > 0) confidence -= 25 * ignoredDirectives.length;
  confidence = Math.max(0, Math.min(100, confidence));

  const candidate = {
    toolName,
    merchantId,
    amountMinor: amountMinor > 0 ? amountMinor : 1,
    currency: "INR" as const,
    description: rawText.slice(0, 200),
    confidence,
  };

  // The schema is enforced on the parser's own output, not only on a model's.
  // Section 115 asks for tool-schema validation; validating only untrusted
  // producers is how a refactor introduces an invalid proposal that nothing
  // catches.
  const proposal = ProposalSchema.parse(candidate);

  return {
    proposal,
    // The hash covers the parsed proposal, not the raw sentence. The receipt
    // binds what the agent decided to do; the raw text is stored beside it and
    // is not what authority was granted over.
    intentHash: hashCanonical({ agentId, proposal }),
    ignoredDirectives,
  };
}
