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
import { Dim, Panel, Tag } from "@/ui/panel";
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
      <div className="min-w-0">
        <p className="label">Independent verification</p>
        <h1 className="title mt-1">Check this ledger without trusting this ledger</h1>
        <p className="lede mt-2 max-w-3xl">
          Download the bundle, download the verifier, run it offline. It makes no network calls and opens no
          database — it reads a file and decides. If it and this website ever disagree about a receipt, believe
          the verifier.
        </p>
      </div>

      <Panel title="Take the evidence with you">
        <div className="flex flex-wrap gap-3">
          <a href="/api/bundle" className="key key-lume">
            Download audit bundle
          </a>
          <a href="/ledger-verify.mjs" download className="key key-lume">
            Download ledger-verify.mjs
          </a>
        </div>
        <p className="mt-4 text-xs t-2">
          One file, no install, no dependencies. It is <em>not</em> an independent reimplementation: it is the
          same canonicalizer, hash, signature and Merkle code as the service, compiled offline. A bug in the
          canonicalizer would be present in both and they would agree about a receipt they were both wrong
          about. Defending against that needs a second implementation by someone else, which is why the
          canonicalization rules are written out in full in the source.
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Three commands">
          <pre className="term">
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
          <pre className="term mt-2">
{`node ledger-verify.mjs audit-bundle.json --key $(printf '0f%.0s' {1..1952})`}
          </pre>
          <p className="lede mt-2 text-sm">
            Every receipt must fail. If any survives a wrong key, the signature is not bound to the key and
            nothing else on this site is worth reading.
          </p>
        </Panel>

        <div className="space-y-5">
          <Panel title="Suite">
            <div className="space-y-1.5">
              <Dim label="Signature" value={SUITE.algorithm} />
              <Dim label="Standard" value={SUITE.standard} />
              <Dim label="Security category" value={String(SUITE.securityCategory)} />
              <Dim label="Library" value={SUITE.library + " " + SUITE.libraryVersion} />
              <Dim label="Signature size" value={SUITE.signatureBytes + " bytes"} />
              <Dim label="Public key size" value={SUITE.publicKeyBytes + " bytes"} />
              <Dim label="Hash" value={HASH_ALGORITHM} />
              <Dim label="Canonicalization" value={CANONICALIZATION.name} />
              <Dim label="Merkle" value={MERKLE_ALGORITHM} />
            </div>
          </Panel>

          <Panel title="This ledger">
            <div className="space-y-1.5">
              <Dim label="Receipts" value={String(chain.receiptCount)} />
              <Dim label="First sequence" value={String(first?.sequence ?? 0)} />
              <Dim label="Head sequence" value={String(last?.sequence ?? 0)} />
              <Dim label="Broken links" value={String(chain.brokenLinks.length)} />
              <Dim label="Missing sequences" value={String(chain.missingSequences.length)} />
            </div>
            <div className="mt-3">
              <Tag kind={chain.intact ? "valid" : "void"}>{chain.intact ? "Chain intact" : "Chain broken"}</Tag>
            </div>
          </Panel>

          <Panel title="Public keys">
            {keys.map((key) => (
              <div key={key.id} className="mb-3 min-w-0 last:mb-0">
                <p className="mono">{key.id}</p>
                <p className="label">
                  {key.state} · {key.custody}
                </p>
                <p className="hash mt-1">{key.publicKey.slice(0, 64)}…</p>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      <Panel title="The five demonstrations">
        <DemoRunner />
      </Panel>

      <Panel title="What a valid signature does and does not prove">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="min-w-0">
            <p className="label mb-2">It proves</p>
            <ul className="space-y-1.5 text-sm">
              <li>These exact bytes were signed by the holder of that private key.</li>
              <li>Not one byte has changed since.</li>
              <li>The receipt names the key that signed it, so it cannot be re-attributed.</li>
              <li>It sat in this position in the chain, after that receipt and before this one.</li>
              <li>It was in the ledger when the batch root was published.</li>
            </ul>
          </div>
          <div className="min-w-0">
            <p className="label mb-2">It does not prove</p>
            <ul className="space-y-1.5 text-sm t-void">
              <li>That the merchant was legitimate.</li>
              <li>That the buyer actually wanted the purchase.</li>
              <li>That the policy encoded a sensible rule.</li>
              <li>That the agent understood the instruction.</li>
              <li>That the payment was a good idea.</li>
            </ul>
            <p className="mt-3 text-xs t-2">
              A signed receipt of a bad decision is a reliable record of a bad decision. Integrity is not
              judgement, and this system claims only the first.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
