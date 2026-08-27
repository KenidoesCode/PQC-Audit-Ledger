import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { agentActions, humanReviews } from "@/db/schema";
import { Plate, Stamp, inr } from "@/ui/plate";

export const dynamic = "force-dynamic";

/**
 * Human review.
 *
 * The rule that shapes this page is section 112: an override does not delete
 * the denial. A queue that removes an item once someone approves it would
 * destroy exactly the evidence an investigator needs, so an item stays visible
 * with its original decision and the override is appended beside it.
 */
export default async function ReviewPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const pending = await db
    .select()
    .from(agentActions)
    .where(eq(agentActions.decision, "HUMAN_REVIEW"))
    .orderBy(desc(agentActions.createdAt))
    .limit(50);

  const reviews = await db.select().from(humanReviews).orderBy(desc(humanReviews.createdAt)).limit(50);
  const reviewed = new Map(reviews.map((r) => [r.actionId, r] as const));

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Human review</p>
        <h1 className="text-2xl">{pending.length} actions the system would not take alone</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-intaglio-mid)]">
          These are not denials. The authority covers them; the policy escalated because of the amount, or
          because the agent was not confident enough about what it had been asked to do. An escalation and a
          refusal are different outcomes and the ledger keeps them apart.
        </p>
      </div>

      <Plate title="Queue">
        {pending.length === 0 ? (
          <p className="text-sm">Nothing is waiting on a person.</p>
        ) : (
          <table className="register">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Merchant</th>
                <th>Why it escalated</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((action, i) => {
                const review = reviewed.get(action.id);
                return (
                  <tr key={action.id} className="settle" style={{ animationDelay: Math.min(i, 20) * 22 + "ms" }}>
                    <td>{inr(action.amountMinor)}</td>
                    <td>{action.merchantId}</td>
                    <td className="max-w-[34rem] text-[var(--color-intaglio-soft)]">
                      {action.decisionReasons.join(" ")}
                    </td>
                    <td>
                      {review ? (
                        <span className={review.outcome === "OVERRIDDEN" ? "text-[var(--color-ochre)]" : ""}>
                          {review.outcome}
                        </span>
                      ) : (
                        <span className="text-[var(--color-intaglio-faint)]">awaiting</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Plate>

      <Plate title="What an override does to the record">
        <div className="max-w-4xl space-y-3 text-sm">
          <p>
            An override appends a HUMAN_REVIEW receipt and, if the action then proceeds, the ordinary payment
            receipts after it. It does not modify the POLICY_EVALUATED receipt and it does not remove the
            PAYMENT_DENIED one. The database will not allow either: audit_receipts carries an append-only
            trigger, so the record of the refusal survives the decision to overrule it.
          </p>
          <p>
            That is what makes a review queue auditable rather than decorative. Six months later the question is
            never whether this was approved. It is who approved it, after it had been refused, and what they
            said at the time.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Stamp kind="note">Reviews recorded: {reviews.length}</Stamp>
            <Link href="/receipts" className="underlink label">
              Review receipts in the ledger
            </Link>
          </div>
        </div>
      </Plate>
    </div>
  );
}
