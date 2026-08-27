# PQC Audit Ledger

Post-quantum signed, tamper-evident audit receipts for agentic payments.

An AI agent is given a spend authority. It reads an instruction, proposes a
payment, and a deterministic layer it cannot reach decides whether that payment
happens. Every step of that — the intent, the authority check, the policy
verdict, the authorization, the attempt, the state read back from the gateway,
and every refusal — produces a receipt signed with **ML-DSA-65 (FIPS 204)**,
chained to its predecessor, and anchored into a Merkle tree.

The point is the last mile: **a stranger can check the result without trusting
this system**. Download the audit bundle, download the single-file offline
verifier, run it with no network and no install.

```bash
curl -O https://<host>/api/bundle
curl -O https://<host>/ledger-verify.mjs
node ledger-verify.mjs audit-bundle.json
```

Exit 0 means every receipt verified and the chain is intact. Exit 1 names the
receipt and the check that failed.

---

## What is actually true here, and what is not

**A valid signature proves**

- these exact bytes were signed by the holder of that private key;
- not one byte has changed since;
- the receipt names the key that signed it, so it cannot be re-attributed;
- it sat in this position in the chain;
- it was in the ledger when the batch root was published.

**A valid signature does not prove**

- that the merchant was legitimate;
- that the buyer wanted the purchase;
- that the policy encoded a sensible rule;
- that the agent understood the instruction;
- that the payment was a good idea.

A signed receipt of a bad decision is a reliable record of a bad decision.
Integrity is not judgement, and this system claims only the first.

**The signing key here is a development key.** It is derived deterministically
from a seed in the environment, which means anyone holding that seed can forge
any receipt this deployment ever issued. Every receipt it signs is
cryptographically valid and organizationally worthless, and the UI says so on
every page where it matters rather than in a footnote. Section 28 of the
specification forbids production keys being generated this way, and so does the
comment at the function that does it.

**No live money is reachable.** Not "no live money is intended" — no code path in
this repository calls a Razorpay endpoint. The adapter interface exists; the
simulator is the only implementation of it.

---

## Results, including the unflattering reading

From the bundled development corpus (30 agent actions, ~190 receipts):

| Measurement | Result |
| --- | --- |
| Tamper detection | 1.000 over ~1,430 applied mutations |
| False verification | 0.000 over ~190 untouched controls |
| Audit completeness | 1.000 of agent actions have a full receipt chain |
| Column/body divergence | 0 of ~1,350 probed column values |
| Chain | intact, no broken links, no missing sequences |
| Sign latency | p50 ≈ 6.7 ms, p95 ≈ 17.7 ms, p99 ≈ 27.7 ms |
| Verify latency | p50 ≈ 1.8 ms, p95 ≈ 1.9 ms, p99 ≈ 2.2 ms |

**The 1.000 detection rate is not an achievement.** Any change to the canonical
bytes changes their SHA-256, and the verifier recomputes that hash from the body
before it looks at the signature at all. A rate below 1.000 would be a defect
report about the canonicalizer — it would mean a field was being dropped. Read
that number as a regression test, not as evidence the cryptography is strong.

**The number that could actually have failed is the false-verification rate.** A
canonicalizer that serialized the same object two different ways would show up
there, and nowhere else.

**~1,079 mutations could not be applied and are excluded rather than scored.** A
receipt with no payment id cannot have its payment id changed, and counting that
as an undetected tamper would quietly lower the denominator in our favour. The
per-type table on the evaluation page shows attempted, applied and detected
separately so the exclusions are visible.

**What a signature does not cover is measured directly.** The ledger keeps
denormalised columns (event type, action id, agent id, occurred-at) so tables can
be queried without parsing jsonb, and a signature says nothing about them. They
are compared against the body they were copied from, and that comparison is the
one check in the evaluation whose failing case is not already ruled out by
SHA-256.

**Merkle proofs are verified on a sample of 25, not on every receipt** —
rebuilding the tree per receipt is quadratic. The sample size is printed next to
the result.

**Signature bytes are not reproducible.** FIPS 204 signing is hedged: re-signing
the same receipt produces a different signature that also verifies. Payload
hashes and Merkle roots are reproducible; signature bytes are not, and nothing in
this system treats a signature as an identity.

**Cost.** An ML-DSA-65 signature is 3,309 bytes against Ed25519's 64 — roughly
fifty times the storage per receipt. That is the price of the post-quantum
property, and it is paid in disk rather than in latency.

---

## The cryptographic suite, concretely

| | |
| --- | --- |
| Signature | ML-DSA-65 |
| Standard | FIPS 204 (formerly CRYSTALS-Dilithium, Dilithium3) |
| Security level | NIST category 3 |
| Implementation | `@noble/post-quantum` 0.7.1, pure TypeScript |
| Public key | 1,952 bytes, raw FIPS 204 encoding, stored hex |
| Private key | 4,032 bytes, never in the ledger, never in a bundle, never logged |
| Signature | 3,309 bytes, raw FIPS 204 encoding, stored hex |
| Hash | SHA-256 |
| Canonicalization | JCS (RFC 8785 subset) |
| Merkle | SHA-256, RFC 6962 domain separation, odd nodes promoted |

**Why not liboqs.** The specification names liboqs "or another maintained
implementation explicitly justified in the architecture". liboqs is a native
addon; this deploys to a serverless runtime where native modules must be prebuilt
for the exact platform target and cannot be compiled at request time, and a
signing service that fails to load on the host is a signing service that does not
exist. The noble implementation runs identically in the test suite, in local
development and on the deployed host, so the bytes produced in production are the
bytes it was tested against. No cryptographic primitive is implemented in this
repository.

### Canonicalization rules, in full

Written out here because the only real defence against a canonicalizer bug is
somebody else implementing these rules from the description and getting the same
bytes.

1. Object keys sorted by UTF-16 code unit, ascending.
2. No insignificant whitespace.
3. Arrays keep their order. Order is data.
4. `null` is serialized. `undefined` is **rejected**, not dropped — dropping it
   would let the signer and the verifier disagree about whether a field existed.
5. Non-finite numbers are **rejected**. `JSON.stringify` turns them into `null`.
6. Integers outside the exact-integer range are **rejected**.
7. Standard JSON string escaping.
8. UTF-8. Nothing downstream re-encodes.

### Merkle rules, in full

- **Leaf** = SHA-256(`0x00` ‖ receipt payload hash). Not the receipt id — the
  payload hash is what the signature already covers, so the root and the
  signature are statements about the same bytes.
- **Node** = SHA-256(`0x01` ‖ left ‖ right). The prefixes prevent an internal
  node being presented as a leaf (RFC 6962). They cost one byte.
- **Odd node**: promoted unchanged to the next level. Not duplicate-last, which
  is the Bitcoin rule and admits the CVE-2012-2459 collision where two distinct
  leaf sets produce the same root.
- **Ordering**: ledger sequence, not sorted.
- **Empty tree**: rejected. A root over zero receipts is not a fact about
  anything.

---

## What the signature covers, and what it deliberately does not

**Signed** (the receipt body): schema version, receipt id, event type and
version, timestamp, the whole event object, every reference (agent, authority,
policy, action, intent, tool call, merchant, order, payment), the previous
receipt hash, and the signing key id.

The **signing key id is inside the signature**. If it sat outside, an attacker
holding any valid key could re-point a receipt at their own key and the signature
would check out against it.

**Not signed**: the Merkle batch, the root and the proof. They cannot be — the
batch does not exist when the receipt is signed. Anchoring is a separate, later
statement about an already-final payload hash. Conflating the two is how systems
end up claiming a signature proves inclusion.

---

## Threat model

| Adversary | What they can do | What stops them |
| --- | --- | --- |
| Compromised agent | Propose anything, including instructions injected into item text | The agent has no field in which to express "raise the cap". The policy layer is deterministic code the agent cannot reach. |
| Compromised application | Write rows through the ORM | `audit_receipts` has an append-only trigger. Updates and deletes are refused by the database. |
| Compromised database | Drop the trigger, rewrite rows | Nothing prevents it. Verification **detects** it: the payload hash is recomputed from the body before the signature is checked. |
| Removed or reordered receipts | Delete a row, swap two | Individually every remaining receipt is still valid. The **chain** catches it, and the offline verifier reports the sequence and the break. |
| Stolen signing key | Forge any receipt | Nothing. This is the real limit: the key is the trust anchor. Rotation retires it and historical receipts stay verifiable because each names the key that signed it. |
| Future quantum adversary | Break classical signatures retroactively | ML-DSA-65 is the reason this project exists — receipts signed today must still be checkable in twenty years. |

The append-only trigger stops the application, an ORM mistake and a careless
console session. It does not stop a database superuser, who can drop it. That is
not a gap in the design; it is the reason receipts are signed at all.

---

## The five demonstrations

Run live from `/verifier`, or by `POST /api/demo/<scenario>`:

1. **`happy-payment`** — an authorized payment end to end, every step signed,
   final receipt verified.
2. **`tampered-receipt`** — one field changed, three ways to fail (payload hash,
   signature, Merkle leaf), plus a database that refuses the edit outright.
3. **`revoked-authority`** — a revoked grant blocks the payment, the gateway is
   never reached, and the refusal is signed as carefully as a success.
4. **`duplicate-webhook`** — the same event delivered twice changes state once;
   both deliveries are recorded; a forged signature is rejected and recorded.
5. **`signed-vs-plain-log`** — the identical edit made to a log line and to a
   receipt. The difference is not encryption; neither is encrypted. It is that
   the receipt's bytes were bound to a signature when they were written.

Nothing about these is scripted. If the tamper demonstration ever reports that a
modified receipt verified, the page prints exactly that.

---

## Design

**The interface is security printing** — intaglio green on rag paper, a
counterfoil, a guilloché rosette, a perforated tear line. Not a mood: a signed
receipt *is* a certificate, an instrument whose only value is that a third party
can check it without trusting the issuer, and five centuries of security printing
is the design tradition for exactly that problem.

**The rosette is generated from the receipt's own payload hash.** Frequencies,
phase, amplitude, ring count and ink weight are all read out of the hash bytes.
Two receipts engrave the same figure only if they have the same payload hash. So
a tampered receipt does not show a warning badge next to an otherwise identical
document — it engraves a visibly different seal, side by side with the original,
before a single hex character has been read.

---

## Running it

```bash
npm install
npm run db:migrate        # PGlite, real PostgreSQL in-process, no server needed
npm run dev

npm run gen:events        # generate the seeded corpus and seal a batch
npm run gen:events -- --held-out
npm run evaluate          # mutation evaluation with real metrics
npm run mutate            # per-mutation caught/missed listing
npm run pack:verifier     # rebuild public/ledger-verify.mjs
npm run verify            # typecheck + lint + tests + build
```

`DATABASE_URL=pglite://:memory:` runs entirely in memory, which is what the
deployment uses: a serverless filesystem is read-only apart from an ephemeral
`/tmp` and nothing written survives an invocation. The corpus is therefore
generated, anchored and evaluated during bootstrap on each cold instance. The
cost is a slower first request; the alternative is a deployed audit ledger with
no audit trail.

`postgres://…` switches to a real server with the same migrations.

## Tests

42 tests, all against a real in-process PostgreSQL — the append-only trigger and
the jsonb round trip are enforced by the database, and a mock could enforce
neither.

```bash
npm test
```

## Known limits

- **The offline verifier is not an independent reimplementation.** It is the same
  canonicalizer, hash, signature and Merkle code as the service, compiled into
  one file. A bug in the canonicalizer would be present in both and they would
  agree about a receipt they were both wrong about. Defending against that needs
  a second implementation by someone else — which is why the rules are written
  out in full above.
- **The agent is a deterministic parser with a model-shaped interface.** No model
  provider is configured. It validates against the same schema an LLM would be
  constrained to and rejects output that does not validate; it does not call one.
- **Appends are serialized by a single advisory lock.** The chain is a linked
  list, so two concurrent appends would fork it. One lock for the whole ledger is
  a real throughput ceiling.
- **Both policy thresholds were tuned, not derived.** The human-review threshold
  (₹5,000) and the minimum intent confidence (70%) were chosen so the corpus
  produces a workable number of review cases. Both are labelled as tuned at their
  definition.
- **The simulator's failure rate (12.5%) is tuned too**, so the failure paths are
  exercised without dominating the ledger. It is not any real gateway's number.
