"use client";

import { useState } from "react";

import { CRITICAL_FIELDS } from "@/audit/receipt";
import { IdentityDisc } from "./disc";

/**
 * The tamper bench.
 *
 * ===========================================================================
 * WHAT MAKES THIS DIFFERENT FROM A BADGE THAT SAYS "INVALID"
 * ===========================================================================
 * The seal is re-milled from the recomputed payload hash and set on the bench
 * beside the original. Change one field and the second disc is visibly a
 * different part -- different sector cuts at different radii, different index
 * notches -- before a single line of hex has been read. A red badge tells you
 * the system decided something; two discs that do not gauge the same let you
 * see it.
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
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">Field</span>
          <select
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setValue(fieldValues[e.target.value] ?? "");
            }}
            className="slot"
          >
            {available.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="label">New value</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} className="slot" />
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void run("clean")} disabled={busy} className="key">
            Verify as stored
          </button>
          <button type="button" onClick={() => void run("tamper")} disabled={busy} className="key key-void">
            Tamper and verify
          </button>
          <button type="button" onClick={() => void run("wrongKey")} disabled={busy} className="key">
            Wrong key
          </button>
          <button type="button" onClick={() => void run("dropSignature")} disabled={busy} className="key">
            No signature
          </button>
        </div>
      </div>

      {/* The two discs sit side by side on the bench. The gauge between them
          reads what it reads: same part, or not the same part. */}
      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-wrap items-start justify-center gap-4">
          <div className="text-center">
            <IdentityDisc hash={originalHash} size={128} />
            <p className="label mt-1">as stored</p>
            <p className="hash">{originalHash.slice(0, 12)}</p>
          </div>

          <div className="flex h-[128px] shrink-0 items-center">
            <span className={"gauge " + (computed === null ? "gauge-idle" : changed ? "gauge-void" : "gauge-same")}>
              {computed === null ? "?" : changed ? "≠" : "="}
            </span>
          </div>

          <div className="text-center">
            {computed ? (
              <>
                <IdentityDisc
                  key={computed}
                  hash={computed}
                  size={128}
                  tone={changed ? "clu" : "lume"}
                  className="lock"
                />
                <p className="label mt-1">{changed ? "after your edit" : "recomputed"}</p>
                <p className={"hash " + (changed ? "t-void" : "")}>{computed.slice(0, 12)}</p>
              </>
            ) : (
              <>
                <div className="blank flex h-[128px] w-[128px] items-center justify-center">
                  <span className="label">uncut blank</span>
                </div>
                <p className="label mt-1">nothing milled yet</p>
              </>
            )}
          </div>
        </div>

        <div className={"relative min-w-0 overflow-hidden " + (busy ? "scanning" : "")}>
          {response ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className={"tag " + (response.result.valid ? "tag-valid" : "tag-void")}>
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
                  <li key={check.name} className="flex min-w-0 gap-2 text-xs leading-snug">
                    <span className={"mono shrink-0 " + (check.passed ? "t-lume" : "t-void")}>
                      {check.passed ? "ok  " : "FAIL"}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{check.name}</span>
                      <span className="t-2"> — {check.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm t-2">
              Nothing has been checked yet. Start with <em>verify as stored</em>: if the untouched receipt does
              not verify, no other result on this page would mean anything.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
