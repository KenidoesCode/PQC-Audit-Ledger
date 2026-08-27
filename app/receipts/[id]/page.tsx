import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { auditReceipts } from "@/db/schema";
import { verifyStoredReceipt } from "@/verify/service";
import { receiptCanonicalString, type ReceiptBody } from "@/audit/receipt";
import { Hash, Plate, Stamp } from "@/ui/plate";
import { Rosette } from "@/ui/rosette";
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

      {/* The instrument itself: counterfoil left, body right. */}
      <section className="plate">
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="counterfoil flex shrink-0 flex-col items-center md:w-[200px]">
            <Rosette
              hash={row.payloadHash}
              size={160}
              tone={record.result.valid ? "intaglio" : "vermilion"}
              className="ink-in"
            />
            <p className="label mt-2">Receipt no. {row.sequence}</p>
            <p className="hash mt-1 text-center">{row.payloadHash}</p>
            <div className="mt-3">
              <Stamp kind={record.result.valid ? "valid" : "void"}>
                {record.result.valid ? "Verified" : "Void"}
              </Stamp>
            </div>
            {record.keyCustody === "DEVELOPMENT_SEED" && (
              <p className="mt-3 text-center text-[0.625rem] leading-snug text-[var(--color-vermilion)]">
                Signed by a development key. Cryptographically valid, organizationally worthless.
              </p>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <p className="label">{body.eventType}</p>
              <h1 className="text-2xl">{describe(body)}</h1>
              <p className="mono mt-1 text-[var(--color-intaglio-soft)]">{row.id}</p>
            </div>

            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Field label="Occurred" value={body.timestamp} />
              <Field label="Schema" value={"v" + body.schemaVersion + " / event v" + body.eventVersion} />
              <Field label="Signature algorithm" value={row.signatureAlgorithm} />
              <Field label="Signing key" value={body.signingKeyId} />
              <Field label="Canonical bytes" value={String(new TextEncoder().encode(canonical).length)} />
              <Field label="Merkle batch" value={record.merkleBatchId ?? "not yet anchored"} />
            </div>

            <div>
              <p className="label mb-1">Previous receipt</p>
              <Hash value={body.previousReceiptHash} chars={64} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Plate title="What this receipt binds">
          <dl className="space-y-1.5">
            {Object.entries(body.references).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="label">{key}</dt>
                <dd className={"mono " + (value === null ? "text-[var(--color-intaglio-faint)]" : "")}>
                  {value === null ? "null" : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-[var(--color-intaglio-soft)]">
            Every reference is present, and an absent one is an explicit null rather than a missing key. Those
            two canonicalize differently, so which of them a writer produced must never depend on how the
            object happened to be built.
          </p>
        </Plate>

        <Plate title="Event">
          <pre className="hash max-h-[22rem] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(body.event, null, 2)}
          </pre>
        </Plate>
      </div>

      <Plate title="Tamper bench">
        <TamperPanel receiptId={row.id} originalHash={row.payloadHash} fieldValues={fieldValues} />
      </Plate>

      <Plate title="Canonical bytes — exactly what was signed">
        <pre className="hash max-h-[16rem] overflow-auto whitespace-pre-wrap">{canonical}</pre>
        <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
          Keys sorted, no whitespace, UTF-8. SHA-256 over these bytes is the payload hash; ML-DSA-65 over these
          bytes is the signature. Not over the row, not over a re-serialization: over these.
        </p>
      </Plate>

      <Plate title="Signature">
        <p className="hash break-all">{row.signature ?? "(unsigned)"}</p>
        <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
          3309 bytes. FIPS 204 signing is hedged, so re-signing this same receipt would produce different bytes
          that also verify — which is why nothing in this system treats a signature as an identity.
        </p>
      </Plate>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color-mix(in_oklab,var(--color-intaglio)_12%,transparent)] pb-1">
      <span className="label">{label}</span>
      <span className="mono">{value}</span>
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
