import { eq } from "drizzle-orm";
import { sha256 } from "@noble/hashes/sha2.js";

import type { Database } from "../db/client";
import { signingKeys, type KeyState } from "../db/schema";
import { AppError } from "../shared/errors";
import { getEnv } from "../shared/env";
import { deterministicId } from "../shared/ids";
import { keyPairFromSeed, SIGNATURE_ALGORITHM, SUITE } from "./mldsa";
import { toHex } from "./hash";

/**
 * The key store.
 *
 * SEPARATION (section 24)
 * ---------------------------------------------------------------------------
 * Signing is reachable only through `signWithActiveKey`, which takes bytes and
 * returns a signature. Nothing outside this module can obtain a private key --
 * `loadPublicKey` exists, `loadPrivateKey` does not, and the private column is
 * never selected by any other file. That is the closest thing to a signing
 * boundary a single-process application can honestly claim, and the README says
 * so in exactly those words rather than calling it an HSM.
 *
 * DEVELOPMENT KEYS ARE LABELLED, EVERYWHERE (sections 27 and 28)
 * ---------------------------------------------------------------------------
 * The bundled key is derived from a seed in the environment. Anyone with that
 * seed can forge any receipt this deployment ever issued. That is fine for a
 * demonstration and catastrophic in production, so the key row records custody
 * DEVELOPMENT_SEED, the key id literally begins with `key_dev-`, and every
 * verification result carries the custody forward so the UI can say it. A
 * development-signed receipt is cryptographically valid and organizationally
 * worthless, and the system must never let those two be confused.
 */

export const DEVELOPMENT_KEY_LABEL = "DEVELOPMENT (seed-derived, forgeable by anyone holding the seed)";

export interface PublicKeyRecord {
  id: string;
  algorithm: string;
  publicKey: string;
  state: KeyState;
  custody: "DEVELOPMENT_SEED" | "EXTERNAL_HSM";
  label: string;
}

function seedBytes(seedPhrase: string): Uint8Array {
  // The seed phrase is stretched to exactly 32 bytes with SHA-256. This is key
  // *derivation for a development fixture*, not a password KDF -- there is no
  // secret worth stretching here, and pretending otherwise with a slow KDF
  // would imply a security property this key does not have.
  return sha256(new TextEncoder().encode(seedPhrase));
}

/** Creates the development key if it is absent. Idempotent. */
export async function ensureDevelopmentKey(db: Database): Promise<PublicKeyRecord> {
  const env = getEnv();
  const seed = seedBytes(env.SIGNING_SEED);
  const pair = keyPairFromSeed(seed);

  // The id is derived from the public key, so a changed seed produces a
  // different key id rather than silently replacing a key under the same name.
  // Receipts name their key; a key that changed identity without changing its
  // id would make every historical receipt unverifiable with no explanation.
  const id = deterministicId("key", "dev-" + toHex(sha256(new TextEncoder().encode(pair.publicKeyHex))).slice(0, 16));

  const [existing] = await db.select().from(signingKeys).where(eq(signingKeys.id, id)).limit(1);
  if (existing) return toPublicRecord(existing);

  const [inserted] = await db
    .insert(signingKeys)
    .values({
      id,
      algorithm: SIGNATURE_ALGORITHM,
      custody: "DEVELOPMENT_SEED",
      state: "ACTIVE",
      publicKey: pair.publicKeyHex,
      privateKey: pair.privateKeyHex,
      label: DEVELOPMENT_KEY_LABEL,
      activatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return toPublicRecord(inserted);

  const [raced] = await db.select().from(signingKeys).where(eq(signingKeys.id, id)).limit(1);
  if (!raced) throw new AppError("KEY_NOT_FOUND", "The development key could not be created or read back.");
  return toPublicRecord(raced);
}

function toPublicRecord(row: typeof signingKeys.$inferSelect): PublicKeyRecord {
  return {
    id: row.id,
    algorithm: row.algorithm,
    publicKey: row.publicKey,
    state: row.state,
    custody: row.custody,
    label: row.label,
  };
}

export async function listPublicKeys(db: Database): Promise<PublicKeyRecord[]> {
  const rows = await db.select().from(signingKeys);
  return rows.map(toPublicRecord);
}

export async function loadPublicKey(db: Database, keyId: string): Promise<PublicKeyRecord | null> {
  const [row] = await db.select().from(signingKeys).where(eq(signingKeys.id, keyId)).limit(1);
  return row ? toPublicRecord(row) : null;
}

export async function getActiveKey(db: Database): Promise<PublicKeyRecord> {
  const rows = await db.select().from(signingKeys).where(eq(signingKeys.state, "ACTIVE"));
  const active = rows[0];
  if (!active) {
    throw new AppError(
      "KEY_NOT_ACTIVE",
      "No signing key is ACTIVE. The system refuses to write an unsigned receipt: section 159 requires that a signing failure fail the operation rather than downgrade the audit trail.",
    );
  }
  return toPublicRecord(active);
}

/**
 * Signs bytes with the active key.
 *
 * The only path to a private key in this codebase. If the active key has no
 * private material -- which is what an externally-held production key looks
 * like here -- this throws rather than falling back to some other key. A
 * signing service that quietly picks a different signer is worse than one that
 * stops.
 */
export async function signWithActiveKey(
  db: Database,
  message: Uint8Array,
): Promise<{ keyId: string; signature: string; algorithm: typeof SIGNATURE_ALGORITHM }> {
  const rows = await db.select().from(signingKeys).where(eq(signingKeys.state, "ACTIVE"));
  const active = rows[0];
  if (!active) {
    throw new AppError("KEY_NOT_ACTIVE", "No signing key is ACTIVE, so nothing can be signed.");
  }
  if (!active.privateKey) {
    throw new AppError(
      "SIGNING_UNAVAILABLE",
      "The active key " +
        active.id +
        " has no private material in this process. It is held externally and this deployment cannot sign with it.",
      { keyId: active.id, custody: active.custody },
    );
  }

  const { sign } = await import("./mldsa");
  return {
    keyId: active.id,
    signature: sign(message, active.privateKey),
    algorithm: SIGNATURE_ALGORITHM,
  };
}

export const KEY_SUITE = SUITE;
