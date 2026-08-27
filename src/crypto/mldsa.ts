import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

import { AppError } from "../shared/errors";
import { fromHex, toHex } from "./hash";

/**
 * ===========================================================================
 * POST-QUANTUM SIGNATURE SUITE -- concrete, per specification section 19
 * ===========================================================================
 *
 *   Algorithm        ML-DSA-65
 *   Standard         FIPS 204 (Module-Lattice-Based Digital Signature Standard)
 *   Formerly         CRYSTALS-Dilithium, parameter set Dilithium3
 *   Security level   NIST category 3 (comparable to AES-192)
 *   Implementation   noble/post-quantum 0.7.1, pure TypeScript
 *   Public key       1952 bytes, raw FIPS 204 encoding, stored as hex
 *   Private key      4032 bytes, raw FIPS 204 encoding, never stored in the ledger
 *   Signature        3309 bytes, raw FIPS 204 encoding, stored as hex
 *
 * WHY THIS LIBRARY AND NOT liboqs
 * ---------------------------------------------------------------------------
 * The specification names liboqs "or another maintained implementation
 * explicitly justified in the architecture", so here is the justification.
 * liboqs is a native addon. This application deploys to a serverless runtime
 * where native modules must be prebuilt for the exact platform target and
 * cannot be compiled at request time, and a signing service that fails to load
 * on the host is a signing service that does not exist. noble/post-quantum is
 * a maintained, dependency-light FIPS 204 implementation that runs identically
 * in the test suite, in local development and on the deployed host -- so the
 * bytes this system produces in production are the bytes it was tested against.
 *
 * NOTHING CRYPTOGRAPHIC IS IMPLEMENTED HERE
 * ---------------------------------------------------------------------------
 * No polynomial arithmetic, no NTT, no rejection sampling, no custom key
 * derivation. This file marshals bytes into and out of a library and refuses to
 * do anything clever with them.
 *
 * SIGNATURES ARE HEDGED, THEREFORE NOT REPRODUCIBLE
 * ---------------------------------------------------------------------------
 * FIPS 204 signing draws fresh randomness per signature (the hedged variant).
 * Signing the same receipt twice produces two different signatures and both
 * verify. That is deliberate in the standard, and it means signature bytes can
 * never be used as an identity or a cache key. The canonical payload hash is
 * the stable thing, and the payload hash is what the ledger chains and anchors.
 */

export const SIGNATURE_ALGORITHM = "ML-DSA-65" as const;

export const SUITE = {
  algorithm: SIGNATURE_ALGORITHM,
  standard: "FIPS 204",
  formerName: "CRYSTALS-Dilithium (Dilithium3)",
  securityCategory: 3,
  library: "@noble/post-quantum",
  libraryVersion: "0.7.1",
  publicKeyBytes: 1952,
  privateKeyBytes: 4032,
  signatureBytes: 3309,
  deterministicSigning: false,
  seedBytes: 32,
} as const;

export interface KeyPair {
  publicKeyHex: string;
  privateKeyHex: string;
}

/**
 * Derives a key pair from a 32-byte seed.
 *
 * FIPS 204 key generation is a deterministic function of the seed, so a fixed
 * development seed yields a fixed development key. That is what lets the
 * bundled offline verifier ship with a checkable expected public key, and it is
 * exactly why a production key must never be derived this way: whoever holds
 * the seed holds the private key. Section 28 forbids it, and so does this
 * comment.
 */
export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== SUITE.seedBytes) {
    throw new AppError("VALIDATION_FAILED", "ML-DSA-65 requires a 32-byte seed.", {
      received: seed.length,
    });
  }
  const pair = ml_dsa65.keygen(seed);
  return { publicKeyHex: toHex(pair.publicKey), privateKeyHex: toHex(pair.secretKey) };
}

export function sign(message: Uint8Array, privateKeyHex: string): string {
  const privateKey = fromHex(privateKeyHex);
  if (privateKey.length !== SUITE.privateKeyBytes) {
    throw new AppError("SIGNING_UNAVAILABLE", "Private key is not a well-formed ML-DSA-65 key.", {
      expectedBytes: SUITE.privateKeyBytes,
      receivedBytes: privateKey.length,
    });
  }
  return toHex(ml_dsa65.sign(message, privateKey));
}

/**
 * Verifies a signature.
 *
 * Returns a reason rather than throwing, because "the public key was the wrong
 * length" and "the signature did not verify" are different findings and the
 * verifier has to tell them apart. Collapsing both into false is how a
 * key-distribution mistake gets reported to an auditor as tampering.
 */
export function verify(
  signatureHex: string,
  message: Uint8Array,
  publicKeyHex: string,
): { valid: boolean; reason: string | null } {
  let signature: Uint8Array;
  let publicKey: Uint8Array;

  try {
    signature = fromHex(signatureHex);
  } catch {
    return { valid: false, reason: "SIGNATURE_MALFORMED" };
  }
  try {
    publicKey = fromHex(publicKeyHex);
  } catch {
    return { valid: false, reason: "PUBLIC_KEY_MALFORMED" };
  }

  if (signature.length !== SUITE.signatureBytes) return { valid: false, reason: "SIGNATURE_WRONG_LENGTH" };
  if (publicKey.length !== SUITE.publicKeyBytes) return { valid: false, reason: "PUBLIC_KEY_WRONG_LENGTH" };

  try {
    const ok = ml_dsa65.verify(signature, message, publicKey);
    return ok ? { valid: true, reason: null } : { valid: false, reason: "SIGNATURE_INVALID" };
  } catch {
    // A library-level throw is still a verification failure, and it is reported
    // as one rather than as a 500. It is never reported as success.
    return { valid: false, reason: "SIGNATURE_INVALID" };
  }
}
