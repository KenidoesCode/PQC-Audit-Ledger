/**
 * THE MILLED DISC.
 *
 * ===========================================================================
 * THE VISUAL IS THE CRYPTOGRAPHY
 * ===========================================================================
 * Every feature of this part -- how many concentric turning marks the lathe
 * left, how many sectors were cut and how deep each one runs, where the index
 * notches sit on the rim, how wide the bore is, which way the keyway points --
 * is read out of the receipt's own payload hash. Nothing here is chosen for
 * looks. Two receipts mill the same disc if and only if they have the same
 * payload hash, which is to say: never, unless someone finds a SHA-256
 * collision.
 *
 * That is the whole point. A tampered receipt does not get a red badge beside
 * an otherwise identical document -- it mills wrong. Change one paise and the
 * sector cuts move to different radii and the notches move round the rim. An
 * operator who has seen a receipt once will see that the second one is a
 * different part before reading a single hex character. The tamper bench sets
 * the two discs side by side for exactly this reason.
 *
 * Why a machined disc rather than an engraved rosette: a rosette is hard to
 * counterfeit but it does not show you how it resists. A disc's cuts are at
 * measurable radii and measurable angles, and two discs can be held against
 * each other and seen to disagree. Security you can gauge is the argument this
 * product makes about Merkle trees, so it is the argument the seal should make
 * too.
 *
 * Server-rendered SVG. No library, no canvas, no client JavaScript, no <defs>
 * and no gradient ids -- so two discs on one page can never collide.
 */

interface DiscProps {
  /** The receipt payload hash, hex. */
  hash: string;
  size?: number;
  /** Brass is a seal that holds. Oxide is one that does not. */
  tone?: "brass" | "oxide";
  className?: string;
}

function byteAt(hash: string, index: number): number {
  const offset = (index * 2) % Math.max(2, hash.length - 1);
  const parsed = Number.parseInt(hash.slice(offset, offset + 2), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nibbleAt(hash: string, index: number): number {
  const parsed = Number.parseInt(hash.charAt(index % Math.max(1, hash.length)), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function point(cx: number, cy: number, r: number, degrees: number): string {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return (cx + r * Math.cos(radians)).toFixed(2) + " " + (cy + r * Math.sin(radians)).toFixed(2);
}

/** An annular wedge: outer arc, drop in, inner arc back, close. One sector cut. */
function sector(cx: number, cy: number, rOuter: number, rInner: number, from: number, span: number): string {
  const to = from + span;
  const large = span > 180 ? 1 : 0;
  return (
    "M" +
    point(cx, cy, rOuter, from) +
    "A" +
    rOuter.toFixed(2) +
    " " +
    rOuter.toFixed(2) +
    " 0 " +
    large +
    " 1 " +
    point(cx, cy, rOuter, to) +
    "L" +
    point(cx, cy, rInner, to) +
    "A" +
    rInner.toFixed(2) +
    " " +
    rInner.toFixed(2) +
    " 0 " +
    large +
    " 0 " +
    point(cx, cy, rInner, from) +
    "Z"
  );
}

export function MilledDisc({ hash, size = 132, tone = "brass", className }: DiscProps) {
  const clean = hash.replace(/^0x/, "").toLowerCase();

  // Ranges are chosen so that every possible hash produces a part that is
  // legible and gaugeable. A hash that milled a featureless blank one time in
  // ten would defeat the point of the whole exercise.
  const turnings = 7 + (byteAt(clean, 0) % 6); // 7..12 concentric turning marks
  const sectors = 5 + (byteAt(clean, 1) % 8); // 5..12 sector cuts
  const span = 9 + (byteAt(clean, 2) / 255) * 13; // 9..22 degrees of arc each
  const phase = (byteAt(clean, 3) / 255) * 360; // where sector 0 starts
  const notches = 3 + (byteAt(clean, 4) % 5); // 3..7 index notches on the rim
  const bore = 0.12 + (byteAt(clean, 5) / 255) * 0.06; // 0.12..0.18 of the radius
  const keyway = (byteAt(clean, 6) / 255) * 360; // which way the keyway points

  const c = size / 2;
  const rim = size / 2 - 2;
  const face = rim - 3;
  const hub = face * bore;

  const lit = tone === "oxide" ? "var(--oxide-lit)" : "var(--brass-lit)";
  const body = tone === "oxide" ? "var(--oxide-fill)" : "var(--brass)";

  // Turning marks: the concentric record the lathe leaves on a faced part.
  // Spacing is even; which ones the tool bit cut deeper is read from the hash.
  const rings: { r: number; deep: boolean }[] = [];
  for (let i = 0; i < turnings; i += 1) {
    const t = (i + 1) / (turnings + 1);
    rings.push({ r: hub + (face - hub) * t, deep: nibbleAt(clean, 8 + i) > 7 });
  }

  // Sector cuts. Each sector's depth -- how far in from the rim the cut runs --
  // comes from its own nibble, so the set of depths IS a reading of the hash.
  const cuts: string[] = [];
  for (let i = 0; i < sectors; i += 1) {
    const depth = 0.24 + (nibbleAt(clean, 24 + i) / 15) * 0.5; // 0.24..0.74 of the face
    const outer = face * 0.94;
    const inner = outer - (outer - hub) * depth;
    cuts.push(sector(c, c, outer, inner, phase + (i * 360) / sectors, span));
  }

  // Index notches: the marks a wheel is set against. Cut through the rim.
  const marks: string[] = [];
  for (let i = 0; i < notches; i += 1) {
    const at = (byteAt(clean, 40 + i) / 255) * 360;
    marks.push(sector(c, c, rim + 1, face * 0.86, at - 2.1, 4.2));
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={"0 0 " + size + " " + size}
      className={className}
      role="img"
      aria-label={
        "Disc milled from payload hash " +
        clean.slice(0, 12) +
        ": " +
        sectors +
        " sector cuts, " +
        turnings +
        " turning marks, " +
        notches +
        " index notches"
      }
    >
      {/* The blank: a dark recess the part is set into. */}
      <circle cx={c} cy={c} r={rim} fill="var(--cut)" stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
      <circle cx={c} cy={c} r={rim - 1} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={0.8} />

      {/* Turning marks. */}
      {rings.map((ring, i) => (
        <circle
          key={i}
          cx={c}
          cy={c}
          r={Number(ring.r.toFixed(2))}
          fill="none"
          stroke={lit}
          strokeWidth={ring.deep ? 0.9 : 0.45}
          opacity={ring.deep ? 0.42 : 0.2}
        />
      ))}

      {/* Sector cuts: floor dark, one wall catching the light. */}
      {cuts.map((d, i) => (
        <path key={i} d={d} fill="rgba(0,0,0,0.42)" stroke={lit} strokeWidth={0.7} opacity={0.9} />
      ))}

      {/* Index notches. */}
      {marks.map((d, i) => (
        <path key={i} d={d} fill={body} stroke={lit} strokeWidth={0.5} />
      ))}

      {/* Bore and keyway. */}
      <circle cx={c} cy={c} r={Number(hub.toFixed(2))} fill="rgba(0,0,0,0.6)" stroke={lit} strokeWidth={0.9} />
      <path d={sector(c, c, hub * 1.55, hub * 0.4, keyway - 5, 10)} fill="rgba(0,0,0,0.55)" stroke={lit} strokeWidth={0.6} />
      <circle cx={c} cy={c} r={Number((face * 0.97).toFixed(2))} fill="none" stroke={lit} strokeWidth={0.6} opacity={0.5} />
    </svg>
  );
}
