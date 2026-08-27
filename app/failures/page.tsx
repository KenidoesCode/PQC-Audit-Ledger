import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { agentActions, payments, webhookEvents } from "@/db/schema";
import { verifyChain } from "@/audit/ledger";
import { Plate, inr } from "@/ui/plate";

export const dynamic = "force-dynamic";

export default async function FailuresPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const denied = await db
    .select()
    .from(agentActions)
    .where(eq(agentActions.decision, "DENIED"))
    .orderBy(desc(agentActions.createdAt))
    .limit(50);

  const failed = await db.select().from(payments).where(eq(payments.state, "FAILED")).limit(50);
  const webhooks = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(50);
  const rejectedWebhooks = webhooks.filter((w) => !w.signatureValid);
  const duplicates = webhooks.filter((w) => w.duplicateOfId !== null);
  const chain = await verifyChain(db);

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Failures</p>
        <h1 className="text-2xl">What this system refused, and what went wrong on its own</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-intaglio-mid)]">
          A refusal is a result, not an error. Everything on this page has receipts behind it, signed to the
          same standard as the successes.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Plate title={"Policy denials (" + denied.length + ")"}>
          {denied.length === 0 ? (
            <p className="text-sm">Nothing was denied.</p>
          ) : (
            <ul className="space-y-2.5">
              {denied.map((action) => (
                <li key={action.id} className="border-l-2 border-[var(--color-vermilion)] pl-3">
                  <p className="mono">
                    {inr(action.amountMinor)} to {action.merchantId}
                  </p>
                  <ul className="mt-0.5">
                    {action.decisionReasons.map((reason) => (
                      <li key={reason} className="text-xs text-[var(--color-intaglio-mid)]">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Plate>

        <div className="space-y-5">
          <Plate title={"Payment failures (" + failed.length + ")"}>
            {failed.length === 0 ? (
              <p className="text-sm">No payment failed.</p>
            ) : (
              <table className="register">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Amount</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((payment) => (
                    <tr key={payment.id}>
                      <td>{payment.razorpayOrderId}</td>
                      <td>{inr(payment.amountMinor)}</td>
                      <td className="text-[var(--color-vermilion)]">{payment.failureReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
              A failed payment still produces a full receipt chain. A ledger that only records successes cannot
              be used to investigate anything.
            </p>
          </Plate>

          <Plate title="Webhook anomalies">
            <div className="space-y-1.5">
              <Row label="Deliveries recorded" value={String(webhooks.length)} />
              <Row label="Duplicates" value={String(duplicates.length)} />
              <Row label="Bad signatures" value={String(rejectedWebhooks.length)} />
              <Row label="Applied a state change" value={String(webhooks.filter((w) => w.appliedStateChange).length)} />
            </div>
            <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
              A redelivery is recorded and changes nothing. Recording it is the point: a duplicate that leaves
              no trace is indistinguishable from one that was never sent.
            </p>
          </Plate>
        </div>
      </div>

      <Plate title="Ledger integrity">
        {chain.intact ? (
          <p className="text-sm">
            No broken links and no missing sequences across {chain.receiptCount} receipts. A break here would
            mean a receipt was altered, inserted or removed, and the two cases are reported separately because
            they are different incidents.
          </p>
        ) : (
          <div>
            <p className="text-sm text-[var(--color-vermilion)]">
              {chain.brokenLinks.length} broken links, {chain.missingSequences.length} missing sequences.
            </p>
            <table className="register mt-3">
              <thead>
                <tr>
                  <th>Sequence</th>
                  <th>Receipt</th>
                  <th>Claims</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {chain.brokenLinks.map((link) => (
                  <tr key={link.receiptId}>
                    <td>{link.sequence}</td>
                    <td>{link.receiptId}</td>
                    <td>{link.claimed?.slice(0, 16) ?? "null"}</td>
                    <td>{link.actual?.slice(0, 16) ?? "null"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Plate>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
