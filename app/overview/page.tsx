import Link from "next/link";
import { asc, count, desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { agentActions, auditReceipts, evaluationRuns, merkleBatches, payments } from "@/db/schema";
import { listPublicKeys } from "@/crypto/keys";
import { verifyChain, unanchoredCount } from "@/audit/ledger";
import { SUITE } from "@/crypto/mldsa";
import { Dim, Figure, Hash, Plate, Tag, inr } from "@/ui/plate";
import { MilledDisc } from "@/ui/disc";
import type { EvaluationResult } from "@/evaluation/evaluate";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const receipts = await db.select().from(auditReceipts).orderBy(desc(auditReceipts.sequence)).limit(8);
  const [receiptTotal] = await db.select({ value: count() }).from(auditReceipts);
  // Only the columns the counts below are computed from. Nothing on this page
  // reads an action's or a payment's other fields.
  const actions = await db.select({ decision: agentActions.decision }).from(agentActions);
  const paid = await db.select({ state: payments.state, amountMinor: payments.amountMinor }).from(payments);
  const batches = await db.select().from(merkleBatches).orderBy(desc(merkleBatches.createdAt)).limit(3);
  const keys = await listPublicKeys(db);
  const chain = await verifyChain(db);
  const unanchored = await unanchoredCount(db);
  const [latestEval] = await db.select().from(evaluationRuns).orderBy(desc(evaluationRuns.createdAt)).limit(1);
  const metrics = latestEval?.metrics as unknown as EvaluationResult | undefined;

  const [genesis] = await db.select().from(auditReceipts).orderBy(asc(auditReceipts.sequence)).limit(1);

  const denied = actions.filter((a) => a.decision === "DENIED");
  const review = actions.filter((a) => a.decision === "HUMAN_REVIEW");
  const captured = paid.filter((p) => p.state === "CAPTURED");
  const failed = paid.filter((p) => p.state === "FAILED");
  const settled = captured.reduce((sum, p) => sum + p.amountMinor, 0);

  const developmentKey = keys.find((k) => k.custody === "DEVELOPMENT_SEED");

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* The head of the machine: the seal on the left, the claim on the    */}
      {/* right, jointed along a machined seam.                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="plate">
        <div className="flex flex-col gap-6 min-[901px]:flex-row min-[901px]:items-start">
          <div className="seam flex shrink-0 flex-col items-center">
            {genesis ? (
              <MilledDisc hash={genesis.payloadHash} size={152} className="seated" />
            ) : (
              <div className="h-[152px] w-[152px]" />
            )}
            <p className="label mt-2 text-center">Seal of receipt no. 1</p>
            <p className="hash mt-1 text-center">{genesis ? genesis.payloadHash.slice(0, 12) : "—"}</p>
          </div>

          <div className="min-w-0 flex-1">
            <p className="label">Post-quantum signed, tamper-evident audit ledger</p>
            <h1 className="h-part mt-1.5">
              Every agent action on this system carries a receipt a stranger can check.
            </h1>
            <p className="lede mt-3 max-w-3xl">
              Receipts are signed with {SUITE.algorithm} ({SUITE.standard}), chained to their predecessor and
              anchored into a Merkle tree. The signature proves the bytes are authentic and unmodified relative
              to the signing key. It proves nothing about whether the payment was a good idea, and this page
              will not imply otherwise.
            </p>

            <div className="figure-grid mt-5">
              <Figure value={String(receiptTotal?.value ?? 0)} caption="receipts in the ledger" />
              <Figure value={String(actions.length)} caption="agent actions" />
              <Figure value={inr(settled)} caption="simulated value settled" />
              <Figure
                value={chain.intact ? "intact" : "BROKEN"}
                caption="hash chain"
                tone={chain.intact ? "plain" : "void"}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Tag kind={chain.intact ? "valid" : "void"}>
                {chain.intact ? "Chain verified" : chain.brokenLinks.length + " broken links"}
              </Tag>
              {developmentKey && <Tag kind="pending">Development key — forgeable by seed holder</Tag>}
              <Tag kind="note">No live money reachable</Tag>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Taking the evidence away is the point of the project, so it gets   */}
      {/* the only brass-faced controls on the site.                          */}
      {/* ------------------------------------------------------------------ */}
      <Plate title="Take the evidence with you">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="lede max-w-2xl">
            The bundle is every receipt, every signature and every Merkle root as one file. The verifier is one
            file with no dependencies that reads it and decides. Neither one asks this website anything, which
            is the only reason a stranger has to believe either of them.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="/api/bundle" className="key key-brass">
              Download audit bundle
            </a>
            <a href="/ledger-verify.mjs" download className="key key-brass">
              Download offline verifier
            </a>
          </div>
        </div>
      </Plate>

      <div className="card-grid">
        <Plate title="Decisions">
          <div className="space-y-3">
            <Dim ruled label="Allowed" value={String(actions.length - denied.length - review.length)} />
            <Dim ruled label="Denied" value={String(denied.length)} tone={denied.length > 0 ? "void" : undefined} />
            <Dim ruled label="Sent to a person" value={String(review.length)} />
            <Dim ruled label="Payments captured" value={String(captured.length)} />
            <Dim ruled label="Payments failed" value={String(failed.length)} />
          </div>
          <p className="mt-4 text-xs t-2">
            A denial writes more receipts than an approval, not fewer. A system that only records what it did
            cannot answer what it refused to do.
          </p>
        </Plate>

        <Plate title="Signing key">
          {keys.length === 0 ? (
            <p className="text-sm">No key.</p>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="space-y-2">
                <Dim label="Key" value={key.id} />
                <Dim label="Algorithm" value={key.algorithm} />
                <Dim label="State" value={key.state} />
                <Dim label="Custody" value={key.custody} tone={key.custody === "DEVELOPMENT_SEED" ? "void" : undefined} />
                <p className="mt-3 text-xs t-2">{key.label}</p>
                <p className="hash mt-2">{key.publicKey.slice(0, 96)}…</p>
              </div>
            ))
          )}
        </Plate>

        <Plate title="Merkle anchors">
          {batches.length === 0 ? (
            <p className="text-sm">Nothing anchored yet.</p>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => (
                <div key={batch.id}>
                  <div className="dim">
                    <span className="mono">{batch.treeSize} leaves</span>
                    <Hash value={batch.root} chars={20} />
                  </div>
                  <p className="label mt-0.5">{batch.algorithm}</p>
                </div>
              ))}
              <Dim label="Unanchored receipts" value={String(unanchored)} />
            </div>
          )}
          <Link href="/merkle" className="underlink label mt-4 inline-block">
            Open the wheel pack →
          </Link>
        </Plate>
      </div>

      {metrics && (
        <Plate
          title="Latest evaluation"
          right={
            <Link href="/evaluation" className="underlink">
              Full report →
            </Link>
          }
        >
          <div className="figure-grid">
            <Figure value={fmtPct(metrics.tamperDetectionRate)} caption="tamper detection" />
            <Figure
              value={fmtPct(metrics.falseVerificationRate)}
              caption="false verification"
              tone={metrics.falseVerificationRate > 0 ? "void" : "plain"}
            />
            <Figure value={fmtPct(metrics.auditCompleteness)} caption="audit completeness" />
            <Figure value={metrics.signLatencyMs.p95.toFixed(1) + "ms"} caption="sign p95" />
            <Figure value={metrics.verifyLatencyMs.p95.toFixed(1) + "ms"} caption="verify p95" />
          </div>
          <p className="mt-4 max-w-4xl text-xs t-2">
            A tamper-detection rate of 1.000 is the expected result and not an impressive one: any change to the
            canonical bytes changes their SHA-256, and the verifier recomputes that hash before it looks at the
            signature. The number is a regression test on the canonicalizer. The evaluation page says what the
            signature does <em>not</em> cover.
          </p>
        </Plate>
      )}

      <Plate
        title="Latest receipts"
        right={
          <Link href="/receipts" className="underlink">
            The whole ledger →
          </Link>
        }
      >
        <div className="scrollx">
          <table className="register">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Event</th>
                <th>Payload hash</th>
                <th>Previous</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt, i) => (
                <tr key={receipt.id} className="settling" style={{ animationDelay: i * 28 + "ms" }}>
                  <td className="t-3">{receipt.sequence}</td>
                  <td>
                    <Link href={"/receipts/" + receipt.id} className="underlink">
                      {receipt.eventType}
                    </Link>
                  </td>
                  <td>
                    <Hash value={receipt.payloadHash} />
                  </td>
                  <td>
                    <Hash value={receipt.previousReceiptHash} chars={12} />
                  </td>
                  <td>{receipt.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs t-3">
          The eight most recent of {receiptTotal?.value ?? 0}, newest first.
        </p>
      </Plate>
    </div>
  );
}

function fmtPct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}
