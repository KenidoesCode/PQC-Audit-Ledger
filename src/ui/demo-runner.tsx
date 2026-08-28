"use client";

import { useState } from "react";

/**
 * Runs the five demonstrations against the live system.
 *
 * Nothing here is scripted. Each button posts to the demonstration endpoint and
 * renders what came back, including the case where a step failed -- if the
 * tamper demonstration ever reports that a modified receipt verified, this
 * component prints exactly that rather than the expected outcome.
 */

const SCENARIOS = [
  { id: "happy-payment", label: "1 · Authorized payment" },
  { id: "tampered-receipt", label: "2 · Tampered receipt" },
  { id: "revoked-authority", label: "3 · Revoked authority" },
  { id: "duplicate-webhook", label: "4 · Duplicate webhook" },
  { id: "signed-vs-plain-log", label: "5 · Signed vs plain log" },
] as const;

interface Step {
  step: string;
  outcome: string;
  detail: string;
  ok: boolean;
}

interface DemoResult {
  scenario: string;
  headline: string;
  steps: Step[];
  receiptIds: string[];
  passed: boolean;
}

export function DemoRunner() {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(scenario: string): Promise<void> {
    setRunning(scenario);
    setError(null);
    try {
      const res = await fetch("/api/demo/" + scenario, { method: "POST" });
      const json = (await res.json()) as { result?: DemoResult; message?: string };
      if (!res.ok || !json.result) {
        setError(json.message ?? "The demonstration failed to run.");
        setResult(null);
        return;
      }
      setResult(json.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demonstration failed to run.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => void run(scenario.id)}
            disabled={running !== null}
            className={
              "key " + (running === scenario.id ? "scanning relative overflow-hidden" : "")
            }
          >
            {scenario.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm t-void">{error}</p>}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className={"tag " + (result.passed ? "tag-valid" : "tag-void")}>
              {result.passed ? "As expected" : "Not as expected"}
            </span>
            <p className="text-[0.9375rem]">{result.headline}</p>
          </div>

          <ol className="space-y-2">
            {result.steps.map((step, i) => (
              <li
                key={step.step}
                className="rez grid gap-1 border-l-2 pl-3 sm:grid-cols-[13rem_1fr]"
                style={{
                  animationDelay: i * 70 + "ms",
                  borderColor: step.ok ? "var(--lume)" : "var(--clu)",
                }}
              >
                <div>
                  <p className="mono font-medium">{step.step}</p>
                  <p className={"label " + (step.ok ? "" : "t-void")}>{step.outcome}</p>
                </div>
                <p className="text-xs leading-snug t-2">{step.detail}</p>
              </li>
            ))}
          </ol>

          {result.receiptIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="label">receipts:</span>
              {result.receiptIds.slice(0, 8).map((id) => (
                <a key={id} href={"/receipts/" + id} className="underlink mono">
                  {id.slice(0, 14)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
