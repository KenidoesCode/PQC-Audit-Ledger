import Link from "next/link";
import { asc, count, desc, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { auditReceipts, merkleLeaves } from "@/db/schema";
import { verifyChain } from "@/audit/ledger";
import { Hash, Panel, Tag } from "@/ui/panel";

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

  const [totalRow] = await db.select({ value: count() }).from(auditReceipts);
  const total = totalRow?.value ?? 0;

  // Anchoring is only read for the rows on this page, so the query asks about
  // those receipts rather than pulling every leaf in every batch.
  const pageIds = rows.map((row) => row.id);
  const anchored = new Set(
    pageIds.length === 0
      ? []
      : (
          await db
            .select({ receiptId: merkleLeaves.receiptId })
            .from(merkleLeaves)
            .where(inArray(merkleLeaves.receiptId, pageIds))
        ).map((leaf) => leaf.receiptId),
  );

  const chain = await verifyChain(db);
  const [latest] = await db.select().from(auditReceipts).orderBy(desc(auditReceipts.sequence)).limit(1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Append-only audit ledger</p>
          <h1 className="title mt-1">{total} receipts, oldest first</h1>
          <p className="lede mt-2 max-w-2xl">
            Each row names the payload hash of the row above it. Remove one and every row below it stops
            linking. That is the only thing protecting the set; a signature protects one receipt, and nothing
            else protects the order.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Tag kind={chain.intact ? "valid" : "void"}>
            {chain.intact ? "Chain intact" : chain.brokenLinks.length + " broken links"}
          </Tag>
          <span className="label">head at sequence {latest?.sequence ?? 0}</span>
        </div>
      </div>

      <Panel>
        <div className="scrollx">
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
                <tr
                  key={row.id}
                  className="rez"
                  // The stagger is only worth its bytes on the rows a reader
                  // actually sees arrive; the rest settle together.
                  style={i < 12 ? { animationDelay: i * 22 + "ms" } : undefined}
                >
                  <td className="t-3">{row.sequence}</td>
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
                      <span className="t-lume">yes</span>
                    ) : (
                      <span className="t-3">pending</span>
                    )}
                  </td>
                  <td>{row.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
      </Panel>
    </div>
  );
}
