import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { auditReceipts } from "@/db/schema";
import { verifyStoredReceipt } from "@/verify/service";
import { receiptCanonicalString, type ReceiptBody } from "@/audit/receipt";
import { Dim, Hash, Panel, Tag } from "@/ui/panel";
import { IdentityDisc } from "@/ui/disc";
import { TamperPanel } from "@/ui/tamper-panel";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureBootstrapped();
  const db = await getDb();
  const { id } = await params;

  const [row] = await db.select().from(auditReceipts).where(eq(auditReceipts.id, id)).limit(1);
  if (!row) notFound();

  const body = row.body as unknown as ReceiptBody;
  const record = await verifyStoredReceipt(db, id);
  const canonical = receiptCanonicalString(body);

  // The editable fields for the tamper bench, with their current values, so the
  // control starts from what is actually there rather than from a placeholder.
  const fieldValues: Record<string, string> = {
    eventType: body.eventType,
    timestamp: body.timestamp,
    previousReceiptHash: body.previousReceiptHash ?? "",
    signingKeyId: body.signingKeyId,
  };
  for (const [key, value] of Object.entries(body.event)) {
    if (typeof value === "string" || typeof value === "number") fieldValues["event." + key] = String(value);
  }
  for (const [key, value] of Object.entries(body.references)) {
    if (value !== null) fieldValues["references." + key] = String(value);
  }

  return (
    <div className="space-y-5">
      <Link href="/receipts" className="label underlink">
        ← the ledger
      </Link>

      {/* The part itself: seal on the left, the record on the right. */}
      <section className="panel">
        <div className="flex flex-col gap-6 min-[901px]:flex-row">
          <div className="seam flex shrink-0 flex-col items-center min-[901px]:w-[210px]">
            <IdentityDisc
              hash={row.payloadHash}
              size={168}
              tone={record.result.valid ? "lume" : "clu"}
              className="lock"
            />
            <p className="label mt-2">Receipt no. {row.sequence}</p>
            <p className="hash mt-1 text-center">{row.payloadHash}</p>
            <div className="mt-3">
              <Tag kind={record.result.valid ? "valid" : "void"}>
                {record.result.valid ? "Verified" : "Void"}
              </Tag>
            </div>
            {record.keyCustody === "DEVELOPMENT_SEED" && (
              <p className="mt-3 text-center text-[0.6875rem] leading-snug t-void">
                Signed by a development key. Cryptographically valid, organizationally worthless.
              </p>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="min-w-0">
              <p className="label">{body.eventType}</p>
              <h1 className="title mt-1">{describe(body)}</h1>
              <p className="mono mt-1 t-2">{row.id}</p>
            </div>

            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Dim ruled label="Occurred" value={body.timestamp} />
              <Dim ruled label="Schema" value={"v" + body.schemaVersion + " / event v" + body.eventVersion} />
              <Dim ruled label="Signature algorithm" value={row.signatureAlgorithm} />
              <Dim ruled label="Signing key" value={body.signingKeyId} />
              <Dim ruled label="Canonical bytes" value={String(new TextEncoder().encode(canonical).length)} />
              <Dim ruled label="Merkle batch" value={record.merkleBatchId ?? "not yet anchored"} />
            </div>

            <div className="min-w-0">
              <p className="label mb-1">Previous receipt</p>
              <Hash value={body.previousReceiptHash} chars={64} />
            </div>
          </div>
        </div>
      </section>

      <div className="pair-grid">
        <Panel title="What this receipt binds">
          <dl className="space-y-1.5">
            {Object.entries(body.references).map(([key, value]) => (
              <div key={key} className="dim">
                <dt className="label">{key}</dt>
                <dd className={"mono " + (value === null ? "t-3" : "")}>
                  {value === null ? "null" : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs t-2">
            Every reference is present, and an absent one is an explicit null rather than a missing key. Those
            two canonicalize differently, so which of them a writer produced must never depend on how the
            object happened to be built.
          </p>
        </Panel>

        <Panel title="Event">
          <pre className="term term-wrap max-h-[22rem] overflow-auto">
            {JSON.stringify(body.event, null, 2)}
          </pre>
        </Panel>
      </div>

      <Panel title="Tamper bench">
        <TamperPanel receiptId={row.id} originalHash={row.payloadHash} fieldValues={fieldValues} />
      </Panel>

      <Panel title="Canonical bytes — exactly what was signed">
        <pre className="term term-wrap max-h-[16rem] overflow-auto">{canonical}</pre>
        <p className="mt-3 text-xs t-2">
          Keys sorted, no whitespace, UTF-8. SHA-256 over these bytes is the payload hash; ML-DSA-65 over these
          bytes is the signature. Not over the row, not over a re-serialization: over these.
        </p>
      </Panel>

      <Panel title="Signature">
        <p className="hash">{row.signature ?? "(unsigned)"}</p>
        <p className="mt-3 text-xs t-2">
          3309 bytes. FIPS 204 signing is hedged, so re-signing this same receipt would produce different bytes
          that also verify — which is why nothing in this system treats a signature as an identity.
        </p>
      </Panel>
    </div>
  );
}

function describe(body: ReceiptBody): string {
  const amount = body.event.amountMinor;
  const decision = body.event.decision;
  const result = body.event.result;
  if (typeof amount === "number") {
    const rupees = "₹" + Math.trunc(amount / 100).toLocaleString("en-IN");
    if (typeof result === "string") return rupees + " — " + result.toLowerCase();
    if (typeof decision === "string") return rupees + " — " + decision.toLowerCase().replace(/_/g, " ");
    return rupees;
  }
  if (typeof decision === "string") return decision.toLowerCase().replace(/_/g, " ");
  return body.eventType.toLowerCase().replace(/_/g, " ");
}
