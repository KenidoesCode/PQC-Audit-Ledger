import Link from "next/link";
import { asc, desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { auditReceipts, merkleLeaves } from "@/db/schema";
import { verifyChain } from "@/audit/ledger";
import { Hash, Plate, Stamp } from "@/ui/plate";

export const dynamic = "force-dynamic";

/**
 * The ledger.
 *
 * Ordered by sequence ASCENDING, oldest first, and it is not sortable. A
 * chain-linked ledger read newest-first shows every receipt pointing at the
 * row above it, which is backwards, and an append-only record whose order the
 * reader can rearrange is not obviously append-only any more. Order is the
 * evidence here, so the page does not offer to change it.
 */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  await ensureBootstrapped();
  const db = await getDb();
  const params = await searchParams;

  const from = Math.max(0, Number.parseInt(params.from ?? "0", 10) || 0);
  const pageSize = 60;

  const rows = await db
    .select()
    .from(auditReceipts)
    .orderBy(asc(auditReceipts.sequence))
    .limit(pageSize)
    .offset(from);

  const total = (await db.select({ id: auditReceipts.id }).from(auditReceipts)).length;
  const anchored = new Set((await db.select().from(merkleLeaves)).map((l) => l.receiptId));
  const chain = await verifyChain(db);
  const [latest] = await db.select().from(auditReceipts).orderBy(desc(auditReceipts.sequence)).limit(1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Append-only audit ledger</p>
          <h1 className="text-2xl">{total} receipts, oldest first</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-intaglio-mid)]">
            Each row names the payload hash of the row above it. Remove one and every row below it stops
            linking. That is the only thing protecting the set; a signature protects one receipt, and nothing
            else protects the order.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Stamp kind={chain.intact ? "valid" : "void"}>
            {chain.intact ? "Chain intact" : chain.brokenLinks.length + " broken links"}
          </Stamp>
          <span className="label">head at sequence {latest?.sequence ?? 0}</span>
        </div>
      </div>

      <Plate>
        <table className="register">
          <thead>
            <tr>
              <th>Seq</th>
              <th>Event</th>
              <th>Payload hash</th>
              <th>Links to</th>
              <th>Anchored</th>
              <th>Occurred</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} className="settle" style={{ animationDelay: Math.min(i, 24) * 22 + "ms" }}>
                <td className="text-[var(--color-intaglio-faint)]">{row.sequence}</td>
                <td>
                  <Link href={"/receipts/" + row.id} className="underlink">
                    {row.eventType}
                  </Link>
                </td>
                <td>
                  <Hash value={row.payloadHash} />
                </td>
                <td>
                  <Hash value={row.previousReceiptHash} chars={12} />
                </td>
                <td>
                  {anchored.has(row.id) ? (
                    <span className="text-[var(--color-intaglio-mid)]">yes</span>
                  ) : (
                    <span className="text-[var(--color-ochre)]">pending</span>
                  )}
                </td>
                <td>{row.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between">
          <Link
            href={"/receipts?from=" + Math.max(0, from - pageSize)}
            aria-disabled={from === 0}
            className={"label underlink " + (from === 0 ? "pointer-events-none opacity-40" : "")}
          >
            ← earlier
          </Link>
          <span className="label">
            {from + 1}–{Math.min(from + pageSize, total)} of {total}
          </span>
          <Link
            href={"/receipts?from=" + (from + pageSize)}
            aria-disabled={from + pageSize >= total}
            className={"label underlink " + (from + pageSize >= total ? "pointer-events-none opacity-40" : "")}
          >
            later →
          </Link>
        </div>
      </Plate>
    </div>
  );
}
