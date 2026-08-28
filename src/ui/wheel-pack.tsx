/**
 * THE COMBINATION WHEEL PACK.
 *
 * ===========================================================================
 * A MERKLE BATCH IS A WHEEL PACK, AND NOT BY ANALOGY
 * ===========================================================================
 * A combination lock is a stack of wheels. Each wheel carries a gate cut into
 * its edge. The lock opens when, and only when, every gate in the stack lines
 * up on one radius so the fence can drop through all of them at once. Nobody
 * takes the locksmith's word for that: you look at where the gates are.
 *
 * A Merkle proof is the same object. One ring per level of the tree, divided
 * into exactly as many sectors as that level has nodes. The receipt's own node
 * at each level is its gate. Because a node at index j folds into the parent at
 * index floor(j / 2), the gates for one receipt sit on one radius through the
 * whole pack -- outer ring to root. If any of them were somewhere else the
 * proof would not reproduce the root, and the fence would not drop.
 *
 * Everything drawn is the real tree. The ring count is the real level count,
 * the sector count on each ring is the real node count at that level, the gates
 * are the real proof path, the second brass arc on each ring is the real
 * sibling the proof folds in, and the oxide arcs are the real promoted odd
 * nodes. Nothing here is illustrative.
 *
 * On drawing the divisions: a ring is one <circle> whose stroke-dasharray is
 * computed to cut it into n sectors -- so a ring of four hundred leaves costs
 * the same handful of bytes as a ring of two. Where a level has so many nodes
 * that its divisions would fall below the width of the line, the ring is drawn
 * solid and the caption says which rings those were, rather than the drawing
 * quietly showing a number of divisions that is not the number of nodes.
 *
 * Server-rendered SVG. No client JavaScript.
 */

interface WheelPackProps {
  /** Every level of the real tree, leaves first, root last. */
  levels: string[][];
  /** The leaf whose proof path is being shown as the gates. */
  proofIndex: number;
  size?: number;
}

/** 0 degrees is the +x axis; the whole pack is rotated so it lands at twelve. */
function pt(c: number, r: number, degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return (c + r * Math.cos(radians)).toFixed(2) + " " + (c + r * Math.sin(radians)).toFixed(2);
}

function arc(c: number, r: number, from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  return "M" + pt(c, r, from) + "A" + r.toFixed(2) + " " + r.toFixed(2) + " 0 " + large + " 1 " + pt(c, r, to);
}

export function WheelPack({ levels, proofIndex, size = 340 }: WheelPackProps) {
  const c = size / 2;
  const count = levels.length;
  const rOuter = c - 8;
  const rInner = Math.max(16, rOuter * 0.16);
  const step = count > 1 ? (rOuter - rInner) / (count - 1) : 0;
  const thickness = Math.max(3, Math.min(9, step - 2.5));

  const rings = levels.map((level, i) => {
    const r = rOuter - i * step;
    const nodes = level.length;
    const perSector = (2 * Math.PI * r) / nodes;
    const kerf = Math.min(3, Math.max(0.8, perSector * 0.22));
    // Below this the divisions would be finer than the line that draws them.
    const solid = perSector - kerf < 0.9;

    const sweep = 360 / nodes;
    const gateIndex = Math.min(nodes - 1, Math.floor(proofIndex / 2 ** i));
    // A sibling is what the proof actually carries: the node folded in beside
    // this one. The last node of an odd level has none -- it is promoted.
    const siblingIndex = gateIndex % 2 === 0 ? gateIndex + 1 : gateIndex - 1;
    const hasSibling = i < count - 1 && siblingIndex >= 0 && siblingIndex < nodes;

    const below = levels[i - 1];
    const promoted = below !== undefined && below.length % 2 === 1 ? nodes - 1 : null;

    return {
      r,
      solid,
      dash: (perSector - kerf).toFixed(2) + " " + kerf.toFixed(2),
      gate: arc(c, r, gateIndex * sweep + sweep * 0.06, gateIndex * sweep + sweep * 0.94),
      sibling: hasSibling
        ? arc(c, r, siblingIndex * sweep + sweep * 0.06, siblingIndex * sweep + sweep * 0.94)
        : null,
      promotedArc:
        promoted !== null ? arc(c, r, promoted * sweep + sweep * 0.06, promoted * sweep + sweep * 0.94) : null,
    };
  });

  const solidLevels = rings.map((ring, i) => (ring.solid ? i : -1)).filter((i) => i >= 0);
  const promotedLevels = rings.map((ring, i) => (ring.promotedArc ? i : -1)).filter((i) => i >= 0);

  return (
    <figure className="m-0">
      <div className="flex justify-center">
        <svg
          width="100%"
          viewBox={"0 0 " + size + " " + size}
          style={{ maxWidth: size, height: "auto" }}
          role="img"
          aria-label={
            "Combination wheel pack of " +
            count +
            " rings, one per level of the Merkle tree. The outermost ring is divided into " +
            (levels[0]?.length ?? 0) +
            " leaves and the centre is the root. The gates for leaf " +
            proofIndex +
            " line up on one radius."
          }
        >
          {/* Rotated so ring divisions and gates both start at twelve o'clock. */}
          <g transform={"rotate(-90 " + c + " " + c + ")"}>
            {/* The fence: the radius every gate has to line up on for the proof
                to reproduce the root. Drawn under the wheels, as a fence sits. */}
            <line
              x1={c}
              y1={c}
              x2={c + rOuter + 4}
              y2={c}
              stroke="var(--brass)"
              strokeWidth={1}
              opacity={0.45}
              strokeDasharray="3 3"
            />

            {rings.map((ring, i) => (
              <g key={i}>
                <circle
                  cx={c}
                  cy={c}
                  r={Number(ring.r.toFixed(2))}
                  fill="none"
                  stroke="var(--cut)"
                  strokeWidth={thickness}
                  strokeDasharray={ring.solid ? undefined : ring.dash}
                  opacity={0.85}
                />
                {ring.sibling && (
                  <path d={ring.sibling} fill="none" stroke="var(--brass)" strokeWidth={thickness} opacity={0.6} />
                )}
                {ring.promotedArc && (
                  <path d={ring.promotedArc} fill="none" stroke="var(--oxide-fill)" strokeWidth={thickness} />
                )}
                <path d={ring.gate} fill="none" stroke="var(--brass-lit)" strokeWidth={thickness} />
              </g>
            ))}

            {/* The root, seated at the centre of the pack. */}
            <circle
              cx={c}
              cy={c}
              r={Number((rInner * 0.55).toFixed(2))}
              fill="var(--brass)"
              stroke="var(--cut)"
              strokeWidth={1.5}
            />
          </g>
        </svg>
      </div>

      <figcaption className="mt-3 space-y-1.5 text-xs t-2">
        <p>
          One ring per level, outermost the {levels[0]?.length ?? 0} leaves, centre the root. Each ring is cut
          into one sector per node at that level.
        </p>
        <p>
          <span className="wp-swatch wp-gate" /> the gates — leaf {proofIndex} and every node it folds into.
          They line up on one radius because a node at index j folds into the parent at floor(j/2), and that
          alignment is the proof.{" "}
          <span className="wp-swatch wp-sibling" /> the siblings the proof actually carries.
        </p>
        {promotedLevels.length > 0 && (
          <p>
            <span className="wp-swatch wp-promoted" /> promoted odd nodes, at level
            {promotedLevels.length === 1 ? " " : "s "}
            {promotedLevels.join(", ")} — carried up unchanged rather than hashed against a duplicate of
            themselves.
          </p>
        )}
        {solidLevels.length > 0 && (
          <p className="t-void">
            Level{solidLevels.length === 1 ? " " : "s "}
            {solidLevels.join(", ")} {solidLevels.length === 1 ? "has" : "have"} more nodes than the line can
            divide, so {solidLevels.length === 1 ? "that ring is" : "those rings are"} drawn solid. The node
            counts beside the tree are the real ones.
          </p>
        )}
      </figcaption>
    </figure>
  );
}
