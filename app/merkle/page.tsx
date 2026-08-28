import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { merkleBatches, merkleLeaves } from "@/db/schema";
import { buildLevels, buildProof, verifyProof } from "@/crypto/merkle";
import { unanchoredCount } from "@/audit/ledger";
import { Dim, Hash, Panel, Tag } from "@/ui/panel";
import { MerkleRings } from "@/ui/rings";

export const dynamic = "force-dynamic";

/**
 * The Merkle page draws the actual tree, not a picture of one.
 *
 * Every node the wheel pack divides a ring into is computed from the stored
 * leaves by the same function the proof generator uses. A tree drawn from a
 * diagram would be a claim; this one is the object.
 *
 * The odd-leaf rule is visible in the drawing: a promoted node is marked in
 * oxide on its ring, and marked with an arrow in the node listing. That rule is
 * the difference between this tree and the Bitcoin-style duplicate-last tree
 * that admits CVE-2012-2459, and it is worth being able to point at.
 *
 * WHAT IS CAPPED AND WHY. The whole tree is computed. The node listing renders
 * the first NODES_SHOWN nodes of each level and says how many it left out,
 * because a level of four hundred sixty-four-character nodes is a quarter of a
 * megabyte of HTML that nobody reads. The wheel pack is drawn from every level
 * at its true node count, and the complete tree is in the bundle and in
 * /api/merkle/proof.
 */

const NODES_SHOWN = 32;
const LEAVES_SHOWN = 50;

export default async function MerklePage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  await ensureBootstrapped();
  const db = await getDb();
  const params = await searchParams;

  const batches = await db.select().from(merkleBatches).orderBy(desc(merkleBatches.createdAt));
  const selected = params.batch ? batches.find((b) => b.id === params.batch) : batches[0];
  const unanchored = await unanchoredCount(db);

  if (!selected) {
    return (
      <Panel title="Merkle ledger">
        <p className="text-sm">
          No batch has been sealed. {unanchored} receipts are signed and chained but not yet anchored.
        </p>
      </Panel>
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
        <div className="min-w-0">
          <p className="label">Merkle anchoring</p>
          <h1 className="title mt-1">
            Batch of {selected.treeSize}, sequences {selected.fromSequence}–{selected.toSequence}
          </h1>
          <p className="lede mt-2 max-w-3xl">
            The signature says who wrote a receipt and that it has not changed. The root says the receipt was in
            the ledger when this batch was sealed. Two different statements, made at two different times over
            two different things — this page is about the second one.
          </p>
        </div>
        <Tag kind={rootMatches ? "valid" : "void"}>
          {rootMatches ? "Root rebuilds" : "Root does not rebuild"}
        </Tag>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="The wheel pack">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
            <MerkleRings levels={levels} proofIndex={sampleIndex} />

            <div className="min-w-0 space-y-4">
              {[...levels].reverse().map((level, reversedIndex) => {
                const levelIndex = levels.length - 1 - reversedIndex;
                const below = levels[levelIndex - 1];
                const promotedIndex =
                  below !== undefined && below.length % 2 === 1 ? level.length - 1 : null;
                const shown = level.slice(0, NODES_SHOWN);
                const hidden = level.length - shown.length;
                return (
                  <div key={levelIndex} className="min-w-0">
                    <p className="label mb-1">
                      {levelIndex === 0
                        ? "leaves — SHA-256(0x00 ‖ payload hash) — " + level.length + " nodes"
                        : levelIndex === levels.length - 1
                          ? "root"
                          : "level " + levelIndex + " — " + level.length + " nodes"}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {shown.map((node, nodeIndex) => {
                        const promoted = promotedIndex !== null && nodeIndex === promotedIndex;
                        return (
                          <span
                            key={node + nodeIndex}
                            title={node}
                            className={
                              "node" +
                              (levelIndex === levels.length - 1 ? " node-root" : promoted ? " node-promoted" : "")
                            }
                          >
                            {node.slice(0, 8)}
                            {promoted && " ↑"}
                          </span>
                        );
                      })}
                      {hidden > 0 && (
                        <span className="node node-more">
                          + {hidden} more
                          {promotedIndex !== null && promotedIndex >= NODES_SHOWN
                            ? ", including the promoted node at index " + promotedIndex
                            : ""}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-4 text-xs t-2">
            A node marked <span className="t-void">↑</span> was promoted: an odd node at that level, carried up
            unchanged rather than hashed against a duplicate of itself. Duplicate-last is the Bitcoin rule and
            it admits two distinct leaf sets that produce the same root. Promotion has no such collision.
          </p>
          <p className="mt-2 text-xs t-3">
            The tree is computed in full and the wheel pack is drawn from every level at its true node count.
            The listing prints the first {NODES_SHOWN} nodes of each level and says how many it left out. The
            complete tree is in the audit bundle and at <code className="mono">/api/merkle/proof</code>.
          </p>
        </Panel>

        <div className="space-y-5">
          <Panel title="Root">
            <p className="hash">{selected.root}</p>
            <div className="mt-3 space-y-1.5">
              <Dim label="Algorithm" value={selected.algorithm} />
              <Dim label="Tree size" value={String(selected.treeSize)} />
              <Dim label="Levels" value={String(levels.length)} />
              <Dim label="Rebuilds" value={rootMatches ? "yes" : "NO"} tone={rootMatches ? undefined : "void"} />
              <Dim label="Unanchored" value={String(unanchored)} />
            </div>
          </Panel>

          {sampleProof && sampleCheck && (
            <Panel title="A proof, checked here">
              <p className="text-xs t-2">Leaf 0, folded {sampleProof.siblings.length} times.</p>
              <ol className="mt-2 space-y-1">
                {sampleProof.siblings.map((sibling, i) => (
                  <li key={sibling + i} className="flex min-w-0 items-baseline gap-2">
                    <span className="label w-12 shrink-0">{sampleProof.directions[i]}</span>
                    <Hash value={sibling} chars={22} />
                  </li>
                ))}
              </ol>
              <div className="mt-3">
                <Tag kind={sampleCheck.valid ? "valid" : "void"}>
                  {sampleCheck.valid ? "Reproduces the root" : String(sampleCheck.reason)}
                </Tag>
              </div>
              <p className="mt-3 text-xs t-2">
                Fetch any receipt&apos;s proof at{" "}
                <code className="mono">/api/merkle/proof/&lt;receiptId&gt;</code> and check it yourself with the
                offline verifier.
              </p>
            </Panel>
          )}

          <Panel title="Batches">
            <ul className="space-y-1.5">
              {batches.map((batch) => (
                <li key={batch.id} className="min-w-0">
                  <Link
                    href={"/merkle?batch=" + batch.id}
                    className={"mono underlink " + (batch.id === selected.id ? "font-semibold" : "")}
                  >
                    {batch.treeSize} leaves · {batch.root.slice(0, 12)}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Leaves in this batch">
        <div className="scrollx">
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
              {leaves.slice(0, LEAVES_SHOWN).map((leaf) => (
                <tr key={leaf.batchId + leaf.leafIndex}>
                  <td className="t-3">{leaf.leafIndex}</td>
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
        </div>
        <p className="mt-3 text-xs t-3">
          {leaves.length <= LEAVES_SHOWN
            ? "All " + leaves.length + " leaves in this batch, in ledger order."
            : "Showing leaves 0–" +
              (LEAVES_SHOWN - 1) +
              " of " +
              leaves.length +
              ", in ledger order. Every leaf is in the audit bundle; none of them is omitted from the root."}
        </p>
      </Panel>
    </div>
  );
}
