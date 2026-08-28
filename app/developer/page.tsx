import { asc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { auditReceipts } from "@/db/schema";
import { receiptCanonicalString, type ReceiptBody } from "@/audit/receipt";
import { CANONICALIZATION } from "@/crypto/canonical";
import { MERKLE_ALGORITHM } from "@/crypto/merkle";
import { HASH_ALGORITHM } from "@/crypto/hash";
import { Plate } from "@/ui/plate";

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/agent/act",
    body: '{ "text": "Order coffee from Blue Tokai for INR 899", "authority": "standard" }',
    note: "Runs the whole flow and returns the receipt ids.",
  },
  {
    method: "POST",
    path: "/api/policy/validate",
    body: '{ "toolName": "payments.create_order", "merchantId": "mrc_blue_tokai", "amountMinor": 89900, "currency": "INR" }',
    note: "Evaluates policy without writing anything. Returns every rule.",
  },
  {
    method: "POST",
    path: "/api/verify",
    body: '{ "receiptId": "rcp_...", "tamper": { "field": "event.amountMinor", "value": "999999" } }',
    note: "Verify as stored, or with a tamper, a wrong key, or no signature.",
  },
  {
    method: "GET",
    path: "/api/audit?limit=100&order=asc",
    body: null,
    note: "The ledger, including each receipt body.",
  },
  {
    method: "GET",
    path: "/api/merkle/proof/<receiptId>",
    body: null,
    note: "Leaf, siblings, directions, root, batch.",
  },
  {
    method: "POST",
    path: "/api/evaluate",
    body: '{ "split": "held-out" }',
    note: "Runs the mutation evaluation and stores the result.",
  },
  {
    method: "POST",
    path: "/api/demo/<scenario>",
    body: null,
    note: "One of the five demonstrations, run live.",
  },
  { method: "GET", path: "/api/bundle", body: null, note: "Downloads the offline audit bundle." },
  { method: "GET", path: "/api/health", body: null, note: "Suite, keys, chain state." },
];

export default async function DeveloperPage() {
  await ensureBootstrapped();
  const db = await getDb();
  const [sample] = await db.select().from(auditReceipts).orderBy(asc(auditReceipts.sequence)).limit(1);
  const canonical = sample ? receiptCanonicalString(sample.body as unknown as ReceiptBody) : "";

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <p className="label">Developer</p>
        <h1 className="h-part mt-1">Everything this system does is reachable over HTTP</h1>
      </div>

      <Plate title="Endpoints">
        <div className="space-y-3">
          {ENDPOINTS.map((endpoint) => (
            <div key={endpoint.path} className="border-l-2 border-[rgba(45,52,58,0.32)] pl-3">
              <p className="mono">
                <span className="t-void">{endpoint.method}</span> {endpoint.path}
              </p>
              {endpoint.body && <p className="hash mt-0.5">{endpoint.body}</p>}
              <p className="mt-0.5 text-xs t-2">{endpoint.note}</p>
            </div>
          ))}
        </div>
      </Plate>

      <div className="pair-grid">
        <Plate title="Canonicalization, in full">
          <ol className="list-inside list-decimal space-y-1.5 text-sm">
            <li>Object keys sorted by UTF-16 code unit, ascending.</li>
            <li>No insignificant whitespace.</li>
            <li>Arrays keep their order. Order is data.</li>
            <li>
              <code className="mono">null</code> is serialized. <code className="mono">undefined</code> is
              rejected, not dropped.
            </li>
            <li>Non-finite numbers are rejected.</li>
            <li>Integers outside the exact-integer range are rejected.</li>
            <li>Standard JSON string escaping.</li>
            <li>UTF-8. Nothing downstream re-encodes.</li>
          </ol>
          <p className="mt-3 text-xs t-2">
            {CANONICALIZATION.name} — {CANONICALIZATION.reference}. Written out here rather than left
            implicit, because the only real defence against a canonicalizer bug is somebody else implementing
            these rules from the description and getting the same bytes.
          </p>
        </Plate>

        <Plate title="Merkle rules, in full">
          <ul className="space-y-1.5 text-sm">
            <li>
              <strong>Leaf:</strong> SHA-256(0x00 || receipt payload hash). Not the receipt id.
            </li>
            <li>
              <strong>Node:</strong> SHA-256(0x01 || left || right).
            </li>
            <li>
              <strong>Domain separation:</strong> the prefix bytes are the defence against presenting an
              internal node as a leaf (RFC 6962). They cost one byte.
            </li>
            <li>
              <strong>Odd node:</strong> promoted unchanged. Not duplicate-last, which admits CVE-2012-2459.
            </li>
            <li>
              <strong>Ordering:</strong> ledger sequence. Not sorted.
            </li>
            <li>
              <strong>Encoding:</strong> lowercase hex, 64 characters, never truncated in stored data.
            </li>
            <li>
              <strong>Empty tree:</strong> rejected.
            </li>
          </ul>
          <p className="mt-3 text-xs t-2">{MERKLE_ALGORITHM}</p>
        </Plate>
      </div>

      <Plate title="A receipt, canonicalized">
        <p className="mb-2 text-xs t-2">
          {HASH_ALGORITHM} over exactly these bytes is the payload hash. ML-DSA-65 over exactly these bytes is
          the signature.
        </p>
        <pre className="trough trough-wrap max-h-[20rem] overflow-auto">{canonical}</pre>
      </Plate>

      <Plate title="Running the offline verifier">
        <pre className="trough">
          {`# download the evidence and the checker
curl -O https://<this-host>/api/bundle
curl -O https://<this-host>/ledger-verify.mjs

# check it
node ledger-verify.mjs audit-bundle.json          # human output
node ledger-verify.mjs audit-bundle.json --json   # machine output

# prove the bundle's key is not privileged: every receipt must fail
node ledger-verify.mjs audit-bundle.json --key 0f0f0f...`}
        </pre>
      </Plate>
    </div>
  );
}
