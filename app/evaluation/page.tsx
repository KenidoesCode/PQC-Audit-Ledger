import { desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { evaluationRuns } from "@/db/schema";
import { Dim, Figure, Plate, Tag } from "@/ui/plate";
import type { EvaluationResult } from "@/evaluation/evaluate";

export const dynamic = "force-dynamic";

export default async function EvaluationPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const runs = await db.select().from(evaluationRuns).orderBy(desc(evaluationRuns.createdAt)).limit(5);
  const latest = runs[0];
  const m = latest?.metrics as unknown as EvaluationResult | undefined;

  if (!m) {
    return (
      <Plate title="Evaluation">
        <p className="text-sm">No evaluation has been run.</p>
      </Plate>
    );
  }

  const weakTypes = m.perMutationType.filter((t) => t.applied > 0 && t.detected < t.applied);
  const unusedTypes = m.perMutationType.filter((t) => t.applied === 0);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <p className="label">Cryptographic evaluation</p>
        <h1 className="h-part mt-1">
          {m.receiptCount} receipts, {m.mutationCount} applied mutations, {m.controlCount} controls
        </h1>
        <p className="mono mt-1 t-2">
          dataset {m.datasetVersion} · {m.cryptoVersion} · key {m.signingKeyId} · split {m.split}
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The honest reading comes FIRST, above the numbers it is about.     */}
      {/* ------------------------------------------------------------------ */}
      <Plate title="Read this before the numbers">
        <div className="max-w-4xl space-y-3 text-sm">
          <p>
            <strong>
              A tamper-detection rate of {(m.tamperDetectionRate * 100).toFixed(1)}% is the expected result,
              and it is not an impressive one.
            </strong>{" "}
            Any change to the canonical bytes changes their SHA-256, and the verifier recomputes that hash
            from the body before it looks at the signature at all. A rate below 1.000 here would mean the
            canonicalizer is dropping a field — it would be a defect report, not a tuning opportunity. Read
            this number as a regression test, not as evidence that the cryptography is strong.
          </p>
          <p>
            <strong>The number that can actually fail is the false-verification rate.</strong> It is measured
            over {m.controlCount} untouched receipts pushed through the identical path. A canonicalizer that
            serialized the same object two different ways would show up here as receipts that stopped
            verifying for no reason, and nowhere else.
          </p>
          <p>
            <strong>What a signature does not cover.</strong> Anything outside the signed body. This ledger
            keeps denormalised columns — event type, action id, agent id, occurred-at — so tables can be
            queried without parsing jsonb, and a signature says nothing about them. They are checked directly
            against the body they were copied from: {m.columnsProbed} column values probed,{" "}
            <strong>{m.columnBodyDivergences.length} divergences</strong>. That is the one check here whose
            failing case is not already ruled out by SHA-256.
          </p>
          <p>
            <strong>
              {m.mutationReceiptsSampled < m.receiptCount
                ? m.mutationReceiptsSampled + " of " + m.receiptCount + " receipts were mutated on this run."
                : "Every receipt was mutated on this run."}
            </strong>{" "}
            {m.mutationReceiptsSampled < m.receiptCount
              ? "Mutating all of them costs about 1,430 signature verifications, which is more than half of a cold start, so the run that populates this page samples. POST /api/evaluate runs the full sweep. "
              : ""}
            <strong>{m.mutationsNotApplicable} mutations could not be applied</strong> and are excluded rather
            than scored — a receipt with no payment id cannot have its payment id changed, and counting that
            as an undetected tamper would quietly lower the denominator in our favour.
          </p>
        </div>
      </Plate>

      <div className="card-grid">
        <Plate>
          <Figure value={(m.tamperDetectionRate * 100).toFixed(1) + "%"} caption="tamper detection" />
          <p className="mt-2 text-xs t-2">
            {m.tamperDetected} of {m.mutationCount} rejected · {m.tamperMissed} missed
          </p>
        </Plate>
        <Plate>
          <Figure
            value={(m.falseVerificationRate * 100).toFixed(1) + "%"}
            caption="false verification"
            tone={m.falseVerificationRate > 0 ? "void" : "plain"}
          />
          <p className="mt-2 text-xs t-2">
            {m.falseVerifications} of {m.controlCount} controls wrongly rejected
          </p>
        </Plate>
        <Plate>
          <Figure value={(m.auditCompleteness * 100).toFixed(1) + "%"} caption="audit completeness" />
          <p className="mt-2 text-xs t-2">measured against the actions table, not the receipts table</p>
        </Plate>
        <Plate>
          <Figure
            value={m.chainIntact ? "intact" : "broken"}
            caption="hash chain"
            tone={m.chainIntact ? "plain" : "void"}
          />
          <p className="mt-2 text-xs t-2">
            {m.chainBrokenLinks} broken links · {m.chainMissingSequences} missing sequences
          </p>
        </Plate>
      </div>

      <div className="pair-grid">
        <Plate title="Per mutation type">
          <div className="scrollx">
            <table className="register">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Attempted</th>
                  <th>Applied</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {m.perMutationType.map((t) => (
                  <tr key={t.type}>
                    <td>{t.type}</td>
                    <td className="t-3">{t.attempted}</td>
                    <td>{t.applied}</td>
                    <td className={t.applied > 0 && t.detected < t.applied ? "t-void" : ""}>{t.detected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {weakTypes.length > 0 && (
            <p className="mt-3 text-xs t-void">
              {weakTypes.map((t) => t.type).join(", ")} produced undetected tampers. That is a defect.
            </p>
          )}
          {unusedTypes.length > 0 && (
            <p className="mt-3 text-xs t-2">
              {unusedTypes.length} mutation types never applied to any receipt in this corpus (
              {unusedTypes.map((t) => t.type).join(", ")}) — the fields they target are absent from every
              receipt here. They are counted as untested, not as passed.
            </p>
          )}
        </Plate>

        <div className="space-y-5">
          <Plate title="Latency">
            <div className="scrollx">
              <table className="register">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>n</th>
                    <th>p50</th>
                    <th>p95</th>
                    <th>p99</th>
                    <th>max</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>sign (ML-DSA-65)</td>
                    <td>{m.signLatencyMs.count}</td>
                    <td>{m.signLatencyMs.p50}</td>
                    <td>{m.signLatencyMs.p95}</td>
                    <td>{m.signLatencyMs.p99}</td>
                    <td>{m.signLatencyMs.max}</td>
                  </tr>
                  <tr>
                    <td>verify</td>
                    <td>{m.verifyLatencyMs.count}</td>
                    <td>{m.verifyLatencyMs.p50}</td>
                    <td>{m.verifyLatencyMs.p95}</td>
                    <td>{m.verifyLatencyMs.p99}</td>
                    <td>{m.verifyLatencyMs.max}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs t-2">
              Milliseconds, nearest-rank percentiles so every figure is one that was actually observed.
              Averages are not reported: the tail is the part a batch job runs into. ML-DSA-65 signatures are
              3309 bytes against Ed25519&apos;s 64 — roughly fifty times the storage per receipt, which is the
              price of the post-quantum property and is paid in disk, not in latency.
            </p>
          </Plate>

          <Plate title="Anchoring">
            <div className="space-y-1.5">
              <Dim label="Merkle proofs checked" value={m.merkleProofsChecked + " (sampled)"} />
              <Dim label="Merkle proofs valid" value={String(m.merkleProofsValid)} />
              <Dim label="Unanchored receipts" value={String(m.unanchoredReceipts)} />
              <Dim label="Actions missing receipts" value={String(m.actionsWithoutFullChain.length)} />
            </div>
            <p className="mt-3 text-xs t-2">
              Proofs are checked on a sample, not on every receipt — rebuilding the tree per receipt is
              quadratic. The sample size is printed so nobody reads this as every proof having been checked.
            </p>
          </Plate>
        </div>
      </div>

      {m.columnBodyDivergences.length > 0 && (
        <Plate title="Column and body disagree">
          <div className="scrollx">
            <table className="register">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Column</th>
                  <th>Column value</th>
                  <th>Signed value</th>
                </tr>
              </thead>
              <tbody>
                {m.columnBodyDivergences.slice(0, 25).map((d, i) => (
                  <tr key={d.receiptId + i}>
                    <td>{d.receiptId}</td>
                    <td className="t-void">{d.column}</td>
                    <td>{d.columnValue}</td>
                    <td>{d.bodyValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.columnBodyDivergences.length > 25 && (
            <p className="mt-3 text-xs t-void">
              Showing the first 25 of {m.columnBodyDivergences.length} divergences. All of them are in the
              evaluation run stored at <code className="mono">/api/evaluate</code>.
            </p>
          )}
        </Plate>
      )}

      <Plate title="Previous runs">
        <div className="scrollx">
          <table className="register">
            <thead>
              <tr>
                <th>Run</th>
                <th>Split</th>
                <th>Receipts</th>
                <th>Detection</th>
                <th>False verifications</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const metrics = run.metrics as unknown as EvaluationResult;
                return (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{run.split}</td>
                    <td>{metrics.receiptCount}</td>
                    <td>{(metrics.tamperDetectionRate * 100).toFixed(1)}%</td>
                    <td>{metrics.falseVerifications}</td>
                    <td>{run.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Tag kind="note">POST /api/evaluate to run another</Tag>
        </div>
      </Plate>
    </div>
  );
}
