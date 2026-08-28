import Link from "next/link";
import { desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { agentActions, intents } from "@/db/schema";
import { AgentBench } from "@/ui/agent-bench";
import { Plate, inr } from "@/ui/plate";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const actions = await db.select().from(agentActions).orderBy(desc(agentActions.createdAt)).limit(40);
  const parsed = await db
    .select({ id: intents.id, confidence: intents.confidence })
    .from(intents)
    .orderBy(desc(intents.createdAt))
    .limit(40);
  const byIntent = new Map(parsed.map((i) => [i.id, i] as const));

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <p className="label">Live agent activity</p>
        <h1 className="h-part mt-1">Give the agent an instruction and watch what stops it</h1>
        <p className="lede mt-2 max-w-3xl">
          The agent parses. It does not decide. Everything after the proposal is deterministic code the agent
          cannot reach, which is the only way the sentence &ldquo;the AI cannot exceed its authority&rdquo; means
          anything.
        </p>
      </div>

      <Plate title="Bench">
        <AgentBench />
      </Plate>

      <Plate title="Recent actions">
        <div className="scrollx">
          <table className="register">
            <thead>
              <tr>
                <th>Decision</th>
                <th>Tool</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Confidence</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action, i) => (
                <tr key={action.id} className="settling" style={{ animationDelay: Math.min(i, 20) * 20 + "ms" }}>
                  <td
                    className={
                      action.decision === "DENIED" ? "t-void" : action.decision === "HUMAN_REVIEW" ? "t-brass" : ""
                    }
                  >
                    {action.decision}
                  </td>
                  <td>{action.toolName}</td>
                  <td>{action.merchantId}</td>
                  <td>{inr(action.amountMinor)}</td>
                  <td>{byIntent.get(action.intentId)?.confidence ?? "—"}%</td>
                  <td className="max-w-[28rem] t-2">{action.decisionReasons.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs t-3">
          The 40 most recent actions, newest first. Every row here has receipts.{" "}
          <Link href="/receipts" className="underlink">
            Open the ledger
          </Link>{" "}
          to follow one.
        </p>
      </Plate>
    </div>
  );
}
