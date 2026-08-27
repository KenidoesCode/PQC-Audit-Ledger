/**
 * Structured error contract.
 *
 * Every failure crossing a module or API boundary is an `AppError` carrying a
 * stable code. Cryptographic failures are never collapsed into a generic
 * "invalid" -- section 134 of the specification is explicit that the reason a
 * verification failed is the most useful thing the system knows, and hiding it
 * behind a boolean is how a key-rotation bug gets mistaken for tampering.
 */

export const ERROR_CODES = [
  "AUTHORITY_NOT_FOUND",
  "AUTHORITY_EXPIRED",
  "AUTHORITY_REVOKED",
  "AUTHORITY_EXHAUSTED",
  "POLICY_DENIED",
  "INTENT_INVALID",
  "TOOL_NOT_PERMITTED",
  "TOOL_ARGS_INVALID",
  "PAYMENT_FAILED",
  "PAYMENT_NOT_FOUND",
  "RECEIPT_NOT_FOUND",
  "RECEIPT_IMMUTABLE",
  "LEDGER_GAP",
  "KEY_NOT_FOUND",
  "KEY_NOT_ACTIVE",
  "SIGNING_UNAVAILABLE",
  "MERKLE_BATCH_NOT_FOUND",
  "MERKLE_PROOF_UNAVAILABLE",
  "EVALUATION_FAILED",
  "REPLAY_DETECTED",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.status = STATUS[code] ?? 500;
  }
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  AUTHORITY_NOT_FOUND: 404,
  AUTHORITY_EXPIRED: 403,
  AUTHORITY_REVOKED: 403,
  AUTHORITY_EXHAUSTED: 403,
  POLICY_DENIED: 403,
  INTENT_INVALID: 400,
  TOOL_NOT_PERMITTED: 403,
  TOOL_ARGS_INVALID: 400,
  PAYMENT_FAILED: 402,
  PAYMENT_NOT_FOUND: 404,
  RECEIPT_NOT_FOUND: 404,
  RECEIPT_IMMUTABLE: 409,
  KEY_NOT_FOUND: 404,
  KEY_NOT_ACTIVE: 409,
  MERKLE_BATCH_NOT_FOUND: 404,
  MERKLE_PROOF_UNAVAILABLE: 409,
  REPLAY_DETECTED: 409,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
};

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : "Unexpected failure.";
  return new AppError("INTERNAL", message);
}
