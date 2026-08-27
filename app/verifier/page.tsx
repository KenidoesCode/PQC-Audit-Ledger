import { asc, desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { auditReceipts } from "@/db/schema";
import { listPublicKeys } from "@/crypto/keys";
import { verifyChain } from "@/audit/ledger";
import { CANONICALIZATION } from "@/crypto/canonical";
import { HASH_ALGORITHM } from "@/crypto/hash";
import { MERKLE_ALGORITHM } from "@/crypto/merkle";
import { SUITE } from "@/crypto/mldsa";
import { Plate, Stamp } from "@/ui/plate";
import { DemoRunner } from "@/ui/demo-runner";

export const dynamic = "force-dynamic";

export default async function VerifierPage() {
  await ensureBootstrapped();
  const db = await getDb();

  const keys = await listPublicKeys(db);
  const chain = await verifyChain(db);
  const [first] = await db.select().from(auditReceipts).orderBy(asc(auditReceipts.sequence)).limit(1);
  const [last] = await db.select().from(auditReceipts).orderBy(desc(auditReceipts.sequence)).limit(1);

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Independent verification</p>
        <h1 className="text-2xl">Check this ledger without trusting this ledger</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-intaglio-mid)]">
          Download the bundle, download the verifier, run it offline. It makes no network calls and opens no
          database — it reads a file and decides. If it and this website ever disagree about a receipt, believe
          the verifier.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Plate title="Three commands">
          <pre className="hash overflow-x-auto whitespace-pre bg-[color-mix(in_oklab,var(--color-intaglio)_5%,transparent)] p-3">
{`curl -O https://<this-host>/api/bundle
curl -O https://<this-host>/ledger-verify.mjs
node ledger-verify.mjs audit-bundle.json`}
          </pre>

          <p className="mt-4 text-sm">
            Exit code 0 means every receipt verified and the chain is intact. Exit 1 means something did not,
            and the output names which receipt and which check.
          </p>

          <p className="mt-3 text-sm">
            To prove the bundle&apos;s own key is not privileged, hand it a different one:
          </p>
          <pre className="hash mt-2 overflow-x-auto whitespace-pre bg-[color-mix(in_oklab,var(--color-intaglio)_5%,transparent)] p-3">
{`node ledger-verify.mjs audit-bundle.json --key $(printf '0f%.0s' {1..1952})`}
          </pre>
          <p className="mt-2 text-sm text-[var(--color-intaglio-mid)]">
            Every receipt must fail. If any survives a wrong key, the signature is not bound to the key and
            nothing else on this site is worth reading.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/api/bundle"
              className="border-2 border-[var(--color-intaglio)] px-4 py-2 font-[family-name:var(--font-ledger)] text-[0.625rem] uppercase tracking-[0.18em] hover:bg-[color-mix(in_oklab,var(--color-intaglio)_8%,transparent)]"
            >
              Download audit bundle
            </a>
            <a
              href="/ledger-verify.mjs"
              download
              className="border-2 border-[var(--color-intaglio)] px-4 py-2 font-[family-name:var(--font-ledger)] text-[0.625rem] uppercase tracking-[0.18em] hover:bg-[color-mix(in_oklab,var(--color-intaglio)_8%,transparent)]"
            >
              Download ledger-verify.mjs
            </a>
          </div>

          <p className="mt-4 text-xs text-[var(--color-intaglio-soft)]">
            One file, no install, no dependencies. It is <em>not</em> an independent reimplementation: it is the
            same canonicalizer, hash, signature and Merkle code as the service, compiled offline. A bug in the
            canonicalizer would be present in both and they would agree about a receipt they were both wrong
            about. Defending against that needs a second implementation by someone else, which is why the
            canonicalization rules are written out in full in the source.
          </p>
        </Plate>

        <div className="space-y-5">
          <Plate title="Suite">
            <div className="space-y-1.5">
              <Row label="Signature" value={SUITE.algorithm} />
              <Row label="Standard" value={SUITE.standard} />
              <Row label="Security category" value={String(SUITE.securityCategory)} />
              <Row label="Library" value={SUITE.library + " " + SUITE.libraryVersion} />
              <Row label="Signature size" value={SUITE.signatureBytes + " bytes"} />
              <Row label="Public key size" value={SUITE.publicKeyBytes + " bytes"} />
              <Row label="Hash" value={HASH_ALGORITHM} />
              <Row label="Canonicalization" value={CANONICALIZATION.name} />
              <Row label="Merkle" value={MERKLE_ALGORITHM} />
            </div>
          </Plate>

          <Plate title="This ledger">
            <div className="space-y-1.5">
              <Row label="Receipts" value={String(chain.receiptCount)} />
              <Row label="First sequence" value={String(first?.sequence ?? 0)} />
              <Row label="Head sequence" value={String(last?.sequence ?? 0)} />
              <Row label="Broken links" value={String(chain.brokenLinks.length)} />
              <Row label="Missing sequences" value={String(chain.missingSequences.length)} />
            </div>
            <div className="mt-3">
              <Stamp kind={chain.intact ? "valid" : "void"}>
                {chain.intact ? "Chain intact" : "Chain broken"}
              </Stamp>
            </div>
          </Plate>

          <Plate title="Public keys">
            {keys.map((key) => (
              <div key={key.id} className="mb-3 last:mb-0">
                <p className="mono">{key.id}</p>
                <p className="label">
                  {key.state} · {key.custody}
                </p>
                <p className="hash mt-1">{key.publicKey.slice(0, 64)}…</p>
              </div>
            ))}
          </Plate>
        </div>
      </div>

      <Plate title="The five demonstrations">
        <DemoRunner />
      </Plate>

      <Plate title="What a valid signature does and does not prove">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="label mb-2">It proves</p>
            <ul className="space-y-1.5 text-sm">
              <li>These exact bytes were signed by the holder of that private key.</li>
              <li>Not one byte has changed since.</li>
              <li>The receipt names the key that signed it, so it cannot be re-attributed.</li>
              <li>It sat in this position in the chain, after that receipt and before this one.</li>
              <li>It was in the ledger when the batch root was published.</li>
            </ul>
          </div>
          <div>
            <p className="label mb-2">It does not prove</p>
            <ul className="space-y-1.5 text-sm text-[var(--color-vermilion)]">
              <li>That the merchant was legitimate.</li>
              <li>That the buyer actually wanted the purchase.</li>
              <li>That the policy encoded a sensible rule.</li>
              <li>That the agent understood the instruction.</li>
              <li>That the payment was a good idea.</li>
            </ul>
            <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
              A signed receipt of a bad decision is a reliable record of a bad decision. Integrity is not
              judgement, and this system claims only the first.
            </p>
          </div>
        </div>
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
