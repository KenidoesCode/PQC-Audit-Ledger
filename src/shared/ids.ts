import { randomBytes } from "node:crypto";

export type IdPrefix =
  | "rcp" // audit receipt
  | "int" // buyer intent
  | "act" // agent action
  | "tcl" // tool call
  | "ath" // payment authority
  | "pol" // policy version
  | "ord" // simulated order
  | "pay" // simulated payment
  | "whk" // webhook event
  | "key" // signing key
  | "mrk" // merkle batch
  | "evr" // evaluation run
  | "rev" // human review
  | "cor"; // correlation

// Crockford-style: no i, l, o, u. These identifiers get read aloud in an
// incident call, so ambiguous glyphs are a real cost.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function suffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return out;
}

/**
 * Deterministic id mode, and the deployment failure it exists to fix.
 * ---------------------------------------------------------------------------
 * This is deployed with `DATABASE_URL=pglite://:memory:`, which means the
 * database lives inside the process rather than behind a socket. On a
 * serverless host that has a consequence the code cannot see from the inside:
 * there is no single database. Every function instance holds its OWN in-process
 * PostgreSQL, empty at cold start, which `ensureBootstrapped` then fills by
 * generating, anchoring and evaluating the corpus from scratch.
 *
 * The page renderer and the API route handlers are SEPARATE serverless
 * functions. They cold-start independently and each seeds its own copy of the
 * corpus. Whatever the two corpora agree about has to come from the seed --
 * and ids did not, because `newId` mixed `Date.now()` with ten bytes of
 * `randomBytes`. Two tiers seeding two milliseconds apart produced two disjoint
 * sets of receipt ids over identical content.
 *
 * What that broke, concretely: `GET /api/audit` returned a receipt id minted by
 * the API instance; `/receipts/<that id>` is rendered by the page instance,
 * whose ledger has never contained that id, so the lookup missed and the page
 * called `notFound()`. A 200 from the API and a 404 from the page, for the same
 * receipt, at the same moment. Every deep link into the ledger rotted the same
 * way, and so did every Merkle proof link, because the proof is addressed by
 * receipt id too.
 *
 * The fix is to make cold-start seeding mint ids from a counter instead of from
 * the clock. Two instances running the same bootstrap over the same seed then
 * mint the same ids in the same order, so a receipt id is the same string on
 * every instance and a link between tiers resolves. Runtime ids -- anything
 * minted by a live request after bootstrap -- stay clock-and-random, because
 * those are genuinely per-instance and a counter shared across instances would
 * collide.
 */
let deterministicCounter: number | null = null;

export async function withDeterministicIds<T>(fn: () => Promise<T>): Promise<T> {
  deterministicCounter = 0;
  try {
    return await fn();
  } finally {
    deterministicCounter = null;
  }
}

export function newId(prefix: IdPrefix): string {
  if (deterministicCounter !== null) {
    const n = deterministicCounter;
    deterministicCounter += 1;
    return `${prefix}_${n.toString(36).padStart(12, "0")}`;
  }
  return `${prefix}_${Date.now().toString(36).padStart(9, "0")}${suffix(10)}`;
}

/**
 * Correlation ids deliberately bypass the counter above.
 *
 * A correlation id is per-request diagnostic metadata: it is echoed in the JSON
 * response and written to the log, and it is never stored in a table or in a
 * signed receipt body, so nothing about cross-tier agreement depends on it. It
 * must stay outside deterministic mode for a different reason -- requests
 * arriving while a cold instance is still bootstrapping would otherwise draw
 * from the same counter as the seeding path (`route()` mints the correlation id
 * before it awaits `ensureBootstrapped`), shifting every subsequent seeded id
 * by however many requests happened to land during the bootstrap. That is the
 * original nondeterminism wearing a different hat.
 */
export function newCorrelationId(): string {
  return `cor_${Date.now().toString(36).padStart(9, "0")}${suffix(10)}`;
}

/** Deterministic id from a key, so a fixed seed reproduces a fixed corpus. */
export function deterministicId(prefix: IdPrefix, key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `${prefix}_${slug}`;
}
