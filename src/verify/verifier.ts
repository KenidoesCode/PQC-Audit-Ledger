import { hashBytes } from "../crypto/hash";
import { verifyProof, type MerkleProof } from "../crypto/merkle";
import { verify as verifySignature, SIGNATURE_ALGORITHM } from "../crypto/mldsa";
import { receiptCanonicalBytes, type ReceiptBody } from "../audit/receipt";

/**
 * ===========================================================================
 * THE INDEPENDENT VERIFIER
 * ===========================================================================
 *
 * Section 33: the verifier must be independent. That is enforced here by what
 * this file is allowed to import. It imports canonicalization, hashing, the
 * signature primitive and the Merkle primitive -- and nothing else. No database
 * client, no schema, no environment, no application services.
 *
 * The consequence is the property that matters: this function cannot ask the
 * system under audit whether a receipt is good. It is handed bytes and a public
 * key and it decides. The bundled offline CLI verifier is this same logic
 * compiled to a single file, which is why an auditor who trusts nothing about
 * this deployment can still check its output.
 *
 * FAILURE REASONS ARE SPECIFIC ON PURPOSE (section 134)
 * ---------------------------------------------------------------------------
 * A boolean would be cheaper and much worse. "Signature invalid" and "you used
 * the wrong key" and "the stored payload hash does not match the payload" are
 * three different incidents with three different responses, and a verifier that
 * says only `false` makes an operator guess. Every check below names itself.
 *
 * THE CHECK ORDER IS NOT ARBITRARY
 * ---------------------------------------------------------------------------
 * The payload hash is recomputed from the body BEFORE the signature is checked.
 * If a stored payload hash were trusted and a signature checked against it, a
 * tampered body with an untouched hash and signature would verify -- the
 * signature would be perfectly valid over bytes nobody looked at. Recomputing
 * first is what makes the signature a statement about the receipt in hand.
 */

export const VERIFY_FAILURE_REASONS = [
  "SCHEMA_UNSUPPORTED",
  "BODY_MALFORMED",
  "PAYLOAD_HASH_MISMATCH",
  "SIGNATURE_MISSING",
  "SIGNATURE_MALFORMED",
  "SIGNATURE_WRONG_LENGTH",
  "SIGNATURE_INVALID",
  "PUBLIC_KEY_MISSING",
  "PUBLIC_KEY_MALFORMED",
  "PUBLIC_KEY_WRONG_LENGTH",
  "KEY_ID_MISMATCH",
  "ALGORITHM_MISMATCH",
  "CHAIN_BROKEN",
  "MERKLE_LEAF_MISMATCH",
  "MERKLE_ROOT_MISMATCH",
  "MERKLE_PROOF_MALFORMED",
] as const;

export type VerifyFailureReason = (typeof VERIFY_FAILURE_REASONS)[number];

export interface VerifyCheck {
  name: string;
  passed: boolean;
  reason: VerifyFailureReason | null;
  detail: string;
}

export interface VerifyInput {
  body: ReceiptBody;
  signature: string | null;
  signatureAlgorithm: string;
  /** The hash as stored. Recomputed and compared, never trusted. */
  storedPayloadHash: string;
  publicKeyHex: string | null;
  publicKeyId: string | null;
  /** Supplied only when checking the chain link; omit to skip that check. */
  previousReceiptPayloadHash?: string | null;
  merkle?: { proof: MerkleProof; root: string } | null;
}

export interface VerifyResult {
  valid: boolean;
  reasons: VerifyFailureReason[];
  checks: VerifyCheck[];
  computedPayloadHash: string | null;
  computedMerkleRoot: string | null;
}

function check(name: string, passed: boolean, reason: VerifyFailureReason | null, detail: string): VerifyCheck {
  return { name, passed, reason, detail };
}

export function verifyReceipt(input: VerifyInput): VerifyResult {
  const checks: VerifyCheck[] = [];
  let computedPayloadHash: string | null = null;
  let computedMerkleRoot: string | null = null;

  // ---- 1. schema -----------------------------------------------------------
  if (input.body.schemaVersion !== 1) {
    checks.push(
      check(
        "Receipt schema is supported",
        false,
        "SCHEMA_UNSUPPORTED",
        "Receipt declares schema version " +
          String(input.body.schemaVersion) +
          ", which this verifier does not know how to canonicalize. It refuses rather than guessing.",
      ),
    );
    return finish(checks, null, null);
  }
  checks.push(check("Receipt schema is supported", true, null, "Schema version 1."));

  // ---- 2. canonical bytes and payload hash --------------------------------
  let bytes: Uint8Array;
  try {
    bytes = receiptCanonicalBytes(input.body);
  } catch (error) {
    checks.push(
      check(
        "Receipt body canonicalizes",
        false,
        "BODY_MALFORMED",
        error instanceof Error ? error.message : "The receipt body could not be canonicalized.",
      ),
    );
    return finish(checks, null, null);
  }
  computedPayloadHash = hashBytes(bytes);

  const hashMatches = computedPayloadHash === input.storedPayloadHash;
  checks.push(
    check(
      "Payload hash recomputed from the body",
      hashMatches,
      hashMatches ? null : "PAYLOAD_HASH_MISMATCH",
      hashMatches
        ? "SHA-256 over " + String(bytes.length) + " canonical bytes matches the stored hash."
        : "The body hashes to " +
          computedPayloadHash.slice(0, 16) +
          "... but the ledger stores " +
          input.storedPayloadHash.slice(0, 16) +
          "... The receipt content and its recorded hash disagree.",
    ),
  );

  // ---- 3. algorithm --------------------------------------------------------
  const algorithmMatches = input.signatureAlgorithm === SIGNATURE_ALGORITHM;
  checks.push(
    check(
      "Signature algorithm is " + SIGNATURE_ALGORITHM,
      algorithmMatches,
      algorithmMatches ? null : "ALGORITHM_MISMATCH",
      algorithmMatches
        ? SIGNATURE_ALGORITHM + " (FIPS 204)."
        : "Receipt claims " + input.signatureAlgorithm + ". This verifier only accepts " + SIGNATURE_ALGORITHM + ".",
    ),
  );

  // ---- 4. signature present ------------------------------------------------
  if (!input.signature) {
    checks.push(
      check(
        "Signature present",
        false,
        "SIGNATURE_MISSING",
        "There is no signature. An unsigned receipt is not weakly valid or provisionally valid -- it is invalid, and section 37 requires it be reported that way.",
      ),
    );
    return finish(checks, computedPayloadHash, null);
  }
  checks.push(check("Signature present", true, null, "3309-byte ML-DSA-65 signature."));

  // ---- 5. public key present ----------------------------------------------
  if (!input.publicKeyHex) {
    checks.push(
      check(
        "Public key available",
        false,
        "PUBLIC_KEY_MISSING",
        "No public key was supplied for key id " +
          (input.body.signingKeyId || "(none)") +
          ". Without a key this is not an unverified receipt, it is an unverifiable one.",
      ),
    );
    return finish(checks, computedPayloadHash, null);
  }

  // ---- 6. the key is the key the receipt names ----------------------------
  if (input.publicKeyId && input.publicKeyId !== input.body.signingKeyId) {
    checks.push(
      check(
        "Key identity matches the receipt",
        false,
        "KEY_ID_MISMATCH",
        "The receipt was signed under key " +
          input.body.signingKeyId +
          " but verification was attempted with key " +
          input.publicKeyId +
          ". This is reported as a key mismatch and not as tampering, because those are different incidents.",
      ),
    );
  } else {
    checks.push(
      check("Key identity matches the receipt", true, null, "Key " + input.body.signingKeyId + "."),
    );
  }

  // ---- 7. the signature itself --------------------------------------------
  const signatureResult = verifySignature(input.signature, bytes, input.publicKeyHex);
  checks.push(
    check(
      "ML-DSA-65 signature verifies over the canonical bytes",
      signatureResult.valid,
      signatureResult.valid ? null : (signatureResult.reason as VerifyFailureReason),
      signatureResult.valid
        ? "Verified against the recomputed canonical bytes, not against the stored hash."
        : "Verification failed: " + String(signatureResult.reason) + ".",
    ),
  );

  // ---- 8. chain link -------------------------------------------------------
  if (input.previousReceiptPayloadHash !== undefined) {
    const linked = input.body.previousReceiptHash === input.previousReceiptPayloadHash;
    checks.push(
      check(
        "Chain link to the previous receipt",
        linked,
        linked ? null : "CHAIN_BROKEN",
        linked
          ? input.body.previousReceiptHash === null
            ? "Genesis receipt: no predecessor, and none claimed."
            : "Names the payload hash of the preceding receipt."
          : "Receipt claims predecessor " +
            String(input.body.previousReceiptHash).slice(0, 16) +
            "... but the preceding ledger entry hashes to " +
            String(input.previousReceiptPayloadHash).slice(0, 16) +
            "... A receipt was inserted, removed or altered between them.",
      ),
    );
  }

  // ---- 9. Merkle inclusion -------------------------------------------------
  if (input.merkle) {
    const merkleResult = verifyProof(computedPayloadHash, input.merkle.proof, input.merkle.root);
    computedMerkleRoot = merkleResult.computedRoot;
    const reason: VerifyFailureReason | null = merkleResult.valid
      ? null
      : merkleResult.reason === "LEAF_MISMATCH"
        ? "MERKLE_LEAF_MISMATCH"
        : merkleResult.reason === "ROOT_MISMATCH"
          ? "MERKLE_ROOT_MISMATCH"
          : "MERKLE_PROOF_MALFORMED";
    checks.push(
      check(
        "Merkle inclusion proof recomputes the published root",
        merkleResult.valid,
        reason,
        merkleResult.valid
          ? "Folding " +
            String(input.merkle.proof.siblings.length) +
            " siblings from the leaf reproduces the batch root."
          : "Proof does not reproduce the published root: " + String(merkleResult.reason) + ".",
      ),
    );
  }

  return finish(checks, computedPayloadHash, computedMerkleRoot);
}

function finish(
  checks: VerifyCheck[],
  computedPayloadHash: string | null,
  computedMerkleRoot: string | null,
): VerifyResult {
  const reasons = checks.filter((c) => !c.passed && c.reason).map((c) => c.reason as VerifyFailureReason);
  return {
    valid: reasons.length === 0,
    reasons,
    checks,
    computedPayloadHash,
    computedMerkleRoot,
  };
}
