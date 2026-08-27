import { readFileSync } from "node:fs";

import { verifyReceipt } from "../src/verify/verifier";
import { verifyChainOffline } from "./chain";
import type { AuditBundle } from "../src/verify/bundle";

/**
 * ledger-verify -- the offline audit verifier.
 *
 * Usage:  node ledger-verify.mjs <bundle.json> [--json] [--key <publicKeyHex>]
 *
 * WHAT "INDEPENDENT" MEANS HERE, EXACTLY
 * ---------------------------------------------------------------------------
 * This binary makes no network calls and opens no database. It reads a file and
 * decides. It cannot ask the service whether a receipt is good, which is the
 * property section 33 is actually asking for.
 *
 * What it is NOT: an independent reimplementation. It is the same
 * canonicalization, hashing, signature and Merkle code as the service, compiled
 * into one file. That is a real limitation and it is stated here rather than
 * left for someone to discover: a bug in the canonicalizer would be present in
 * both, and this verifier would agree with the service about a receipt they
 * were both wrong about. Defending against that needs a second implementation
 * by someone else, which is exactly why the canonicalization rules are written
 * out in full in the source rather than left implicit.
 *
 * EXIT CODES
 *   0  every receipt verified, chain intact
 *   1  at least one receipt failed
 *   2  the bundle could not be read or was not a bundle
 */

function fail(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  const keyOverrideIndex = args.indexOf("--key");
  const keyOverride = keyOverrideIndex >= 0 ? args[keyOverrideIndex + 1] : undefined;

  if (!path) {
    fail(
      "ledger-verify -- offline verifier for a PQC audit bundle\n\n" +
        "  node ledger-verify.mjs <bundle.json> [--json] [--key <publicKeyHex>]\n\n" +
        "  --json   machine-readable output\n" +
        "  --key    verify against a public key you supply instead of the one in the\n" +
        "           bundle. Use this to prove the bundle's own key is not privileged:\n" +
        "           a wrong key must make every receipt fail.\n",
    );
  }

  let bundle: AuditBundle;
  try {
    bundle = JSON.parse(readFileSync(path, "utf8")) as AuditBundle;
  } catch (error) {
    fail("Could not read " + path + ": " + (error instanceof Error ? error.message : String(error)));
  }

  if (bundle.format !== "pqc-audit-bundle/1") {
    fail("Not a pqc-audit-bundle/1 file (found: " + String(bundle.format) + ").");
  }

  const keysById = new Map(bundle.keys.map((k) => [k.id, k] as const));

  const results = bundle.receipts.map((receipt, index) => {
    const key = keysById.get(receipt.body.signingKeyId);
    const previous = index > 0 ? bundle.receipts[index - 1] : undefined;

    const verdict = verifyReceipt({
      body: receipt.body,
      signature: receipt.signature,
      signatureAlgorithm: receipt.signatureAlgorithm,
      storedPayloadHash: receipt.payloadHash,
      publicKeyHex: keyOverride ?? key?.publicKey ?? null,
      publicKeyId: keyOverride ? null : (key?.id ?? null),
      previousReceiptPayloadHash: index === 0 ? null : (previous?.payloadHash ?? null),
      merkle: receipt.merkle ? { proof: receipt.merkle.proof, root: receipt.merkle.root } : null,
    });

    return {
      sequence: receipt.sequence,
      receiptId: receipt.body.receiptId,
      eventType: receipt.body.eventType,
      valid: verdict.valid,
      reasons: verdict.reasons,
      checks: verdict.checks,
    };
  });

  const chain = verifyChainOffline(bundle);
  const failed = results.filter((r) => !r.valid);
  const ok = failed.length === 0 && chain.intact;

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          bundle: { generatedAt: bundle.generatedAt, receipts: bundle.receipts.length },
          suite: bundle.suite,
          chain,
          verified: results.length - failed.length,
          failed: failed.length,
          results,
          verdict: ok ? "VERIFIED" : "FAILED",
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(ok ? 0 : 1);
  }

  const line = "-".repeat(76);
  const out: string[] = [];
  out.push(line);
  out.push("  LEDGER-VERIFY -- offline audit verification");
  out.push(line);
  out.push("  bundle generated   " + bundle.generatedAt);
  out.push("  receipts           " + bundle.receipts.length);
  out.push("  signature suite    " + bundle.suite.signature.algorithm + " (" + bundle.suite.signature.standard + ")");
  out.push("  hash               " + bundle.suite.hash);
  out.push("  canonicalization   " + bundle.suite.canonicalization.name);
  out.push("  merkle             " + bundle.suite.merkle);
  if (keyOverride) out.push("  key override       supplied on the command line");
  out.push(line);

  for (const result of results) {
    const mark = result.valid ? "  ok  " : " FAIL ";
    out.push(
      mark +
        String(result.sequence).padStart(5) +
        "  " +
        result.eventType.padEnd(20) +
        "  " +
        result.receiptId,
    );
    if (!result.valid) {
      for (const check of result.checks.filter((c) => !c.passed)) {
        out.push("          -> " + check.name + ": " + check.detail);
      }
    }
  }

  out.push(line);
  out.push("  chain              " + (chain.intact ? "intact across " + chain.length + " receipts" : "BROKEN"));
  for (const breakage of chain.breaks) {
    out.push("          -> sequence " + breakage.sequence + ": " + breakage.detail);
  }
  out.push("  verified           " + (results.length - failed.length) + " / " + results.length);
  out.push(line);
  out.push(ok ? "  VERDICT: VERIFIED" : "  VERDICT: FAILED -- " + failed.length + " receipt(s) did not verify");
  out.push(line);
  // Said every time, not only on success. A verdict of VERIFIED means the bytes
  // are authentic and unmodified relative to the signing key. It does not mean
  // the payment was wise, the merchant was real, or the policy was sensible.
  out.push("  A pass means these receipts are authentic and unmodified relative to the");
  out.push("  signing key in the bundle. It does not mean the underlying decisions were");
  out.push("  correct. A signature cannot make a bad payment good.");
  out.push(line);

  process.stdout.write(out.join("\n") + "\n");
  process.exit(ok ? 0 : 1);
}

main();
