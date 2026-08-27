import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { merkleBatches, merkleLeaves } from "@/db/schema";
import { buildLevels, buildProof, verifyProof } from "@/crypto/merkle";
import { unanchoredCount } from "@/audit/ledger";
import { Hash, Plate, Stamp } from "@/ui/plate";

export const dynamic = "force-dynamic";

/**
 * The Merkle page draws the actual tree, not a picture of one.
 *
 * Every node rendered below is computed from the stored leaves by the same
 * function the proof generator uses. A tree drawn from a diagram would be a
 * claim; this one is the object.
 *
 * The odd-leaf rule is visible in the drawing: a promoted node sits at the same
 * horizontal position on two adjacent levels and is marked. That rule is the
 * difference between this tree and the Bitcoin-style duplicate-last tree that
 * admits CVE-2012-2459, and it is worth being able to point at.
 */
export default async function MerklePage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  await ensureBootstrapped();
  const db = await getDb();
  const params = await searchParams;

  const batches = await db.select().from(merkleBatches).orderBy(desc(merkleBatches.createdAt));
  const selected = params.batch ? batches.find((b) => b.id === params.batch) : batches[0];
  const unanchored = await unanchoredCount(db);

  if (!selected) {
    return (
      <Plate title="Merkle ledger">
        <p className="text-sm">
          No batch has been sealed. {unanchored} receipts are signed and chained but not yet anchored.
        </p>
      </Plate>
    );
  }

  const leaves = await db
    .select()
    .from(merkleLeaves)
    .where(eq(merkleLeaves.batchId, selected.id))
    .orderBy(asc(merkleLeaves.leafIndex));

  const payloadHashes = leaves.map((l) => l.payloadHash);
  const levels = buildLevels(payloadHashes);
  const rebuiltRoot = levels[levels.length - 1]?.[0] ?? "";
  const rootMatches = rebuiltRoot === selected.root;

  // One proof, verified live, so the page is not merely asserting that proofs
  // work. The first leaf is used because it is the one an odd-node promotion is
  // least likely to touch, which makes the sibling count easy to reason about.
  const sampleIndex = 0;
  const sampleProof = payloadHashes.length > 0 ? buildProof(payloadHashes, sampleIndex) : null;
  const sampleCheck =
    sampleProof && payloadHashes[sampleIndex]
      ? verifyProof(payloadHashes[sampleIndex] as string, sampleProof, selected.root)
      : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Merkle anchoring</p>
          <h1 className="text-2xl">
            Batch of {selected.treeSize}, sequences {selected.fromSequence}–{selected.toSequence}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-intaglio-mid)]">
            The signature says who wrote a receipt and that it has not changed. The root says the receipt was in
            the ledger when this batch was sealed. Two different statements, made at two different times over
            two different things — this page is about the second one.
          </p>
        </div>
        <Stamp kind={rootMatches ? "valid" : "void"}>
          {rootMatches ? "Root rebuilds" : "Root does not rebuild"}
        </Stamp>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Plate title="The tree">
          <div className="space-y-4 overflow-x-auto">
            {[...levels].reverse().map((level, reversedIndex) => {
              const levelIndex = levels.length - 1 - reversedIndex;
              const below = levels[levelIndex - 1];
              return (
                <div key={levelIndex}>
                  <p className="label mb-1">
                    {levelIndex === 0
                      ? "leaves — SHA-256(0x00 || payload hash)"
                      : levelIndex === levels.length - 1
                        ? "root"
                        : "level " + levelIndex}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {level.map((node, nodeIndex) => {
                      const promoted =
                        below !== undefined && below.length % 2 === 1 && nodeIndex === level.length - 1;
                      return (
                        <span
                          key={node + nodeIndex}
                          title={node}
                          className={
                            "settle border px-1.5 py-1 font-[family-name:var(--font-ledger)] text-[0.625rem] " +
                            (levelIndex === levels.length - 1
                              ? "border-[var(--color-intaglio)] bg-[color-mix(in_oklab,var(--color-intaglio)_10%,transparent)]"
                              : promoted
                                ? "border-dashed border-[var(--color-ochre)] text-[var(--color-ochre)]"
                                : "border-[color-mix(in_oklab,var(--color-intaglio)_28%,transparent)]")
                          }
                          style={{ animationDelay: Math.min(nodeIndex, 30) * 14 + "ms" }}
                        >
                          {node.slice(0, 8)}
                          {promoted && " ↑"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-[var(--color-intaglio-soft)]">
            A node marked <span className="text-[var(--color-ochre)]">↑</span> was promoted: an odd node at that
            level, carried up unchanged rather than hashed against a duplicate of itself. Duplicate-last is the
            Bitcoin rule and it admits two distinct leaf sets that produce the same root. Promotion has no such
            collision.
          </p>
        </Plate>

        <div className="space-y-5">
          <Plate title="Root">
            <p className="hash break-all">{selected.root}</p>
            <div className="mt-3 space-y-1.5">
              <Row label="Algorithm" value={selected.algorithm} />
              <Row label="Tree size" value={String(selected.treeSize)} />
              <Row label="Levels" value={String(levels.length)} />
              <Row label="Rebuilds" value={rootMatches ? "yes" : "NO"} />
              <Row label="Unanchored" value={String(unanchored)} />
            </div>
          </Plate>

          {sampleProof && sampleCheck && (
            <Plate title="A proof, checked here">
              <p className="text-xs text-[var(--color-intaglio-soft)]">
                Leaf 0, folded {sampleProof.siblings.length} times.
              </p>
              <ol className="mt-2 space-y-1">
                {sampleProof.siblings.map((sibling, i) => (
                  <li key={sibling + i} className="flex items-baseline gap-2 text-[0.6875rem]">
                    <span className="label w-12 shrink-0">{sampleProof.directions[i]}</span>
                    <Hash value={sibling} chars={22} />
                  </li>
                ))}
              </ol>
              <div className="mt-3">
                <Stamp kind={sampleCheck.valid ? "valid" : "void"}>
                  {sampleCheck.valid ? "Reproduces the root" : String(sampleCheck.reason)}
                </Stamp>
              </div>
              <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
                Fetch any receipt&apos;s proof at{" "}
                <code className="mono">/api/merkle/proof/&lt;receiptId&gt;</code> and check it yourself with the
                offline verifier.
              </p>
            </Plate>
          )}

          <Plate title="Batches">
            <ul className="space-y-1.5">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <Link
                    href={"/merkle?batch=" + batch.id}
                    className={"mono underlink " + (batch.id === selected.id ? "font-semibold" : "")}
                  >
                    {batch.treeSize} leaves · {batch.root.slice(0, 12)}
                  </Link>
                </li>
              ))}
            </ul>
          </Plate>
        </div>
      </div>

      <Plate title="Leaves in this batch">
        <table className="register">
          <thead>
            <tr>
              <th>Index</th>
              <th>Receipt</th>
              <th>Payload hash</th>
              <th>Leaf hash</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map((leaf) => (
              <tr key={leaf.batchId + leaf.leafIndex}>
                <td className="text-[var(--color-intaglio-faint)]">{leaf.leafIndex}</td>
                <td>
                  <Link href={"/receipts/" + leaf.receiptId} className="underlink">
                    {leaf.receiptId}
                  </Link>
                </td>
                <td>
                  <Hash value={leaf.payloadHash} />
                </td>
                <td>
                  <Hash value={leaf.leafHash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
