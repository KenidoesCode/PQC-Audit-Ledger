import Link from "next/link";
import { asc, desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { agentActions, auditReceipts, evaluationRuns, merkleBatches, payments } from "@/db/schema";
import { listPublicKeys } from "@/crypto/keys";
import { verifyChain, unanchoredCount } from "@/audit/ledger";
import { SUITE } from "@/crypto/mldsa";
import { Figure, Hash, Plate, Stamp, inr } from "@/ui/plate";
import { Rosette } from "@/ui/rosette";
import type { EvaluationResult } from "@/evaluation/evaluate";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const receipts = await db.select().from(auditReceipts).orderBy(desc(auditReceipts.sequence)).limit(8);
  const allReceipts = await db.select({ id: auditReceipts.id }).from(auditReceipts);
  const actions = await db.select().from(agentActions);
  const paid = await db.select().from(payments);
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
      {/* The certificate head: seal on the left, the instrument on the right */}
      {/* ------------------------------------------------------------------ */}
      <section className="plate">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="counterfoil flex shrink-0 flex-col items-center">
            {genesis ? (
              <Rosette hash={genesis.payloadHash} size={148} className="ink-in" />
            ) : (
              <div className="h-[148px] w-[148px]" />
            )}
            <p className="label mt-2 text-center">Seal of receipt no. 1</p>
            <p className="hash mt-1 text-center">{genesis ? genesis.payloadHash.slice(0, 12) : "—"}</p>
          </div>

          <div className="min-w-0 flex-1">
            <p className="label">Post-quantum signed, tamper-evident audit ledger</p>
            <h1 className="mt-1 text-3xl leading-tight">
              Every agent action on this system carries a receipt a stranger can check.
            </h1>
            <p className="mt-3 max-w-3xl text-[0.9375rem] text-[var(--color-intaglio-mid)]">
              Receipts are signed with {SUITE.algorithm} ({SUITE.standard}), chained to their predecessor and
              anchored into a Merkle tree. The signature proves the bytes are authentic and unmodified relative
              to the signing key. It proves nothing about whether the payment was a good idea, and this page
              will not imply otherwise.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Figure value={String(allReceipts.length)} caption="receipts in the ledger" />
              <Figure value={String(actions.length)} caption="agent actions" />
              <Figure value={inr(settled)} caption="simulated value settled" />
              <Figure
                value={chain.intact ? "intact" : "BROKEN"}
                caption="hash chain"
                tone={chain.intact ? "plain" : "void"}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Stamp kind={chain.intact ? "valid" : "void"}>
                {chain.intact ? "Chain verified" : chain.brokenLinks.length + " broken links"}
              </Stamp>
              {developmentKey && <Stamp kind="pending">Development key — forgeable by seed holder</Stamp>}
              <Stamp kind="note">No live money reachable</Stamp>
              <a
                href="/api/bundle"
                className="underlink font-[family-name:var(--font-ledger)] text-[0.6875rem] uppercase tracking-[0.16em]"
              >
                Download audit bundle ↓
              </a>
              <a
                href="/ledger-verify.mjs"
                download
                className="underlink font-[family-name:var(--font-ledger)] text-[0.6875rem] uppercase tracking-[0.16em]"
              >
                Download offline verifier ↓
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Plate title="Decisions">
          <div className="space-y-3">
            <Row label="Allowed" value={String(actions.length - denied.length - review.length)} />
            <Row label="Denied" value={String(denied.length)} tone={denied.length > 0 ? "void" : undefined} />
            <Row label="Sent to a person" value={String(review.length)} />
            <Row label="Payments captured" value={String(captured.length)} />
            <Row label="Payments failed" value={String(failed.length)} />
          </div>
          <p className="mt-4 text-xs text-[var(--color-intaglio-soft)]">
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
                <Row label="Key" value={key.id} />
                <Row label="Algorithm" value={key.algorithm} />
                <Row label="State" value={key.state} />
                <Row label="Custody" value={key.custody} tone={key.custody === "DEVELOPMENT_SEED" ? "void" : undefined} />
                <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">{key.label}</p>
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
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="mono">{batch.treeSize} leaves</span>
                    <Hash value={batch.root} chars={20} />
                  </div>
                  <p className="label mt-0.5">{batch.algorithm}</p>
                </div>
              ))}
              <Row label="Unanchored receipts" value={String(unanchored)} />
            </div>
          )}
          <Link href="/merkle" className="underlink label mt-4 inline-block">
            Open the tree →
          </Link>
        </Plate>
      </div>

      {metrics && (
        <Plate
          title="Latest evaluation"
          right={
            <Link href="/evaluation" className="underlink label">
              Full report →
            </Link>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
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
          <p className="mt-4 max-w-4xl text-xs text-[var(--color-intaglio-soft)]">
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
          <Link href="/receipts" className="underlink label">
            The whole ledger →
          </Link>
        }
      >
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
              <tr key={receipt.id} className="settle" style={{ animationDelay: i * 28 + "ms" }}>
                <td>{receipt.sequence}</td>
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
      </Plate>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "void" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color-mix(in_oklab,var(--color-intaglio)_12%,transparent)] pb-1.5">
      <span className="label">{label}</span>
      <span className={"mono " + (tone === "void" ? "text-[var(--color-vermilion)]" : "")}>{value}</span>
    </div>
  );
}

function fmtPct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}
