"use client";

import { useState } from "react";

import { CRITICAL_FIELDS } from "@/audit/receipt";
import { Rosette } from "./rosette";

/**
 * The tamper bench.
 *
 * ===========================================================================
 * WHAT MAKES THIS DIFFERENT FROM A BADGE THAT SAYS "INVALID"
 * ===========================================================================
 * The seal is redrawn from the recomputed payload hash. Change one field and
 * the rosette visibly becomes a different figure, side by side with the
 * original -- before a single line of hex has been read. A red badge tells you
 * the system decided something; two different engravings let you see it.
 *
 * The stored hash and signature are never touched. What is modified is a copy
 * of the receipt body, which is exactly the position an attacker with write
 * access to a row leaves the system in, and also the position an auditor is in
 * when handed an exported receipt. The ledger table itself refuses updates at
 * the database level, so this page could not modify the row if it tried.
 */

interface Check {
  name: string;
  passed: boolean;
  reason: string | null;
  detail: string;
}

interface VerifyResponse {
  verification: {
    receiptId: string;
    result: {
      valid: boolean;
      reasons: string[];
      checks: Check[];
      computedPayloadHash: string | null;
    };
  };
}

export function TamperPanel({
  receiptId,
  originalHash,
  fieldValues,
}: {
  receiptId: string;
  originalHash: string;
  fieldValues: Record<string, string>;
}) {
  const available = CRITICAL_FIELDS.filter((f) => fieldValues[f] !== undefined);
  const [field, setField] = useState<string>(available[0] ?? "eventType");
  const [value, setValue] = useState<string>(fieldValues[available[0] ?? "eventType"] ?? "");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<VerifyResponse["verification"] | null>(null);
  const [mode, setMode] = useState<"tamper" | "wrongKey" | "dropSignature" | "clean">("clean");

  async function run(next: typeof mode): Promise<void> {
    setBusy(true);
    setMode(next);
    try {
      const body: Record<string, unknown> = { receiptId };
      if (next === "tamper") body.tamper = { field, value };
      if (next === "wrongKey") body.wrongKey = true;
      if (next === "dropSignature") body.dropSignature = true;

      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as VerifyResponse;
      setResponse(json.verification ?? null);
    } finally {
      setBusy(false);
    }
  }

  const computed = response?.result.computedPayloadHash ?? null;
  const changed = computed !== null && computed !== originalHash;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Field</span>
          <select
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setValue(fieldValues[e.target.value] ?? "");
            }}
            className="mono border border-[var(--color-intaglio)] bg-transparent px-2 py-1"
          >
            {available.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className="label">New value</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mono border border-[var(--color-intaglio)] bg-transparent px-2 py-1"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run("clean")} busy={busy}>
            Verify as stored
          </Button>
          <Button onClick={() => void run("tamper")} busy={busy} tone="void">
            Tamper and verify
          </Button>
          <Button onClick={() => void run("wrongKey")} busy={busy}>
            Wrong key
          </Button>
          <Button onClick={() => void run("dropSignature")} busy={busy}>
            No signature
          </Button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[auto_auto_1fr] md:items-start">
        <div className="text-center">
          <Rosette hash={originalHash} size={120} />
          <p className="label mt-1">as stored</p>
          <p className="hash">{originalHash.slice(0, 12)}</p>
        </div>

        <div className="text-center">
          {computed ? (
            <>
              <Rosette
                key={computed}
                hash={computed}
                size={120}
                tone={changed ? "vermilion" : "intaglio"}
                className="ink-in"
              />
              <p className="label mt-1">{changed ? "after your edit" : "recomputed"}</p>
              <p className={"hash " + (changed ? "text-[var(--color-vermilion)]" : "")}>
                {computed.slice(0, 12)}
              </p>
            </>
          ) : (
            <div className="flex h-[120px] w-[120px] items-center justify-center border border-dashed border-[color-mix(in_oklab,var(--color-intaglio)_30%,transparent)]">
              <span className="label">run a check</span>
            </div>
          )}
        </div>

        <div className={"relative overflow-hidden " + (busy ? "lamp" : "")}>
          {response ? (
            <>
              <div className="mb-3 flex items-center gap-3">
                <span className={"stamp " + (response.result.valid ? "stamp-valid" : "stamp-void")}>
                  {response.result.valid ? "Verified" : "Void"}
                </span>
                <span className="label">
                  {mode === "clean"
                    ? "unmodified"
                    : mode === "tamper"
                      ? field + " changed"
                      : mode === "wrongKey"
                        ? "verified against a key that never signed it"
                        : "signature removed"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {response.result.checks.map((check) => (
                  <li key={check.name} className="flex gap-2 text-xs leading-snug">
                    <span
                      className={
                        "mono shrink-0 " +
                        (check.passed ? "text-[var(--color-intaglio-mid)]" : "text-[var(--color-vermilion)]")
                      }
                    >
                      {check.passed ? "ok  " : "FAIL"}
                    </span>
                    <span>
                      <span className="font-medium">{check.name}</span>
                      <span className="text-[var(--color-intaglio-soft)]"> — {check.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-[var(--color-intaglio-soft)]">
              Nothing has been checked yet. Start with <em>verify as stored</em>: if the untouched receipt does
              not verify, no other result on this page would mean anything.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Button({
  onClick,
  children,
  busy,
  tone,
}: {
  onClick: () => void;
  children: React.ReactNode;
  busy: boolean;
  tone?: "void";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        "border px-3 py-1.5 font-[family-name:var(--font-ledger)] text-[0.625rem] uppercase tracking-[0.16em] transition-colors disabled:opacity-50 " +
        (tone === "void"
          ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)] hover:bg-[color-mix(in_oklab,var(--color-vermilion)_10%,transparent)]"
          : "border-[var(--color-intaglio)] hover:bg-[color-mix(in_oklab,var(--color-intaglio)_8%,transparent)]")
      }
    >
      {children}
    </button>
  );
}
