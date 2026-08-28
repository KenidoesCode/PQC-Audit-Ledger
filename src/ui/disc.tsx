/**
 * THE IDENTITY DISC.
 *
 * ===========================================================================
 * THE VISUAL IS THE CRYPTOGRAPHY
 * ===========================================================================
 * On the Grid a program's disc is its complete record -- everything it has
 * done, carried on its back, readable by anyone who takes it. That is this
 * product's claim about a receipt, so the receipt is drawn as a disc.
 *
 * Every feature of it -- how many circuit rings are lit, how many arc segments
 * are cut and how deep each one runs, where the index marks sit on the rim, how
 * wide the hub is, which way the keyway points -- is read out of the receipt's
 * own payload hash. Nothing here is chosen for looks. Two receipts rez the same
 * disc if and only if they have the same payload hash, which is to say: never,
 * unless someone finds a SHA-256 collision.
 *
 * That is the whole point. A tampered receipt does not get a red badge beside
 * an otherwise identical document -- it rezzes wrong. Change one paise and the
 * arc segments move to different radii and the index marks move round the rim.
 * An operator who has seen a receipt once will see that the second one is a
 * different object before reading a single hex character. The tamper bench sets
 * the two discs side by side for exactly this reason.
 *
 * The rim is drawn with a gap in it. A disc with a closed rim is a wheel; the
 * gap is what makes it the thing you take off your back and hand to someone,
 * which is the only claim this whole system makes.
 *
 * Server-rendered SVG. No library, no canvas, no client JavaScript, no <defs>
 * and no gradient ids -- so two discs on one page can never collide.
 */

interface DiscProps {
  /** The receipt payload hash, hex. */
  hash: string;
  size?: number;
  /** Lume is a record that checks out. Clu is one that does not. */
  tone?: "lume" | "clu";
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

/** An annular wedge: outer arc, drop in, inner arc back, close. One arc cut. */
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

/** One open arc, used for the rim -- the gap is the seam of the disc. */
function openArc(cx: number, cy: number, r: number, from: number, span: number): string {
  const to = from + span;
  const large = span > 180 ? 1 : 0;
  return (
    "M" +
    point(cx, cy, r, from) +
    "A" +
    r.toFixed(2) +
    " " +
    r.toFixed(2) +
    " 0 " +
    large +
    " 1 " +
    point(cx, cy, r, to)
  );
}

export function IdentityDisc({ hash, size = 132, tone = "lume", className }: DiscProps) {
  const clean = hash.replace(/^0x/, "").toLowerCase();

  // Ranges are chosen so that every possible hash produces a disc that is
  // legible and comparable. A hash that rezzed a featureless blank one time in
  // ten would defeat the point of the whole exercise.
  const rings = 7 + (byteAt(clean, 0) % 6); // 7..12 concentric circuit rings
  const segments = 5 + (byteAt(clean, 1) % 8); // 5..12 arc segments
  const span = 9 + (byteAt(clean, 2) / 255) * 13; // 9..22 degrees of arc each
  const phase = (byteAt(clean, 3) / 255) * 360; // where segment 0 starts
  const marks = 3 + (byteAt(clean, 4) % 5); // 3..7 index marks on the rim
  const bore = 0.12 + (byteAt(clean, 5) / 255) * 0.06; // 0.12..0.18 of the radius
  const keyway = (byteAt(clean, 6) / 255) * 360; // which way the keyway points
  const seam = (byteAt(clean, 7) / 255) * 360; // where the rim's gap sits

  const c = size / 2;
  const rim = size / 2 - 2;
  const face = rim - 4;
  const hub = face * bore;

  const lit = tone === "clu" ? "var(--clu-hot)" : "var(--lume-hot)";
  const body = tone === "clu" ? "var(--clu)" : "var(--lume)";

  // Circuit rings: the concentric traces on the face. Spacing is even; which
  // ones carry current is read from the hash.
  const traces: { r: number; hot: boolean }[] = [];
  for (let i = 0; i < rings; i += 1) {
    const t = (i + 1) / (rings + 1);
    traces.push({ r: hub + (face - hub) * t, hot: nibbleAt(clean, 8 + i) > 7 });
  }

  // Arc segments. Each segment's depth -- how far in from the rim it runs --
  // comes from its own nibble, so the set of depths IS a reading of the hash.
  const cuts: string[] = [];
  for (let i = 0; i < segments; i += 1) {
    const depth = 0.24 + (nibbleAt(clean, 24 + i) / 15) * 0.5; // 0.24..0.74 of the face
    const outer = face * 0.94;
    const inner = outer - (outer - hub) * depth;
    cuts.push(sector(c, c, outer, inner, phase + (i * 360) / segments, span));
  }

  // Index marks: where the rim is read against. Cut through it.
  const index: string[] = [];
  for (let i = 0; i < marks; i += 1) {
    const at = (byteAt(clean, 40 + i) / 255) * 360;
    index.push(sector(c, c, rim + 1, face * 0.86, at - 2.1, 4.2));
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={"0 0 " + size + " " + size}
      /* .disc is max-width:100%; height:auto -- the attributes above are the
         disc's nominal size, and the viewBox lets it give way if the column it
         sits in is ever narrower than that. */
      className={"disc " + (className ?? "")}
      role="img"
      aria-label={
        "Identity disc rezzed from payload hash " +
        clean.slice(0, 12) +
        ": " +
        segments +
        " arc segments, " +
        rings +
        " circuit rings, " +
        marks +
        " index marks"
      }
    >
      {/* The dark the disc is cut out of. */}
      <circle cx={c} cy={c} r={rim} fill="var(--well)" stroke="rgba(124,232,255,0.16)" strokeWidth={1} />

      {/* Circuit rings. */}
      {traces.map((trace, i) => (
        <circle
          key={i}
          cx={c}
          cy={c}
          r={Number(trace.r.toFixed(2))}
          fill="none"
          stroke={lit}
          strokeWidth={trace.hot ? 1 : 0.5}
          opacity={trace.hot ? 0.5 : 0.22}
        />
      ))}

      {/* Arc segments: dark floor, lit edge. */}
      {cuts.map((d, i) => (
        <path key={i} d={d} fill="rgba(0,0,0,0.55)" stroke={lit} strokeWidth={0.8} opacity={0.95} />
      ))}

      {/* Index marks. */}
      {index.map((d, i) => (
        <path key={i} d={d} fill={body} stroke={lit} strokeWidth={0.5} opacity={0.9} />
      ))}

      {/* Hub and keyway. */}
      <circle cx={c} cy={c} r={Number(hub.toFixed(2))} fill="rgba(0,0,0,0.75)" stroke={lit} strokeWidth={1} />
      <path
        d={sector(c, c, hub * 1.55, hub * 0.4, keyway - 5, 10)}
        fill="rgba(0,0,0,0.6)"
        stroke={lit}
        strokeWidth={0.6}
      />

      {/* The rim, open at the seam. The brightest thing on the disc. */}
      <path
        d={openArc(c, c, rim - 0.5, seam + 9, 342)}
        fill="none"
        stroke={lit}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path
        d={openArc(c, c, rim - 0.5, seam + 9, 342)}
        fill="none"
        stroke={body}
        strokeWidth={5}
        strokeLinecap="round"
        opacity={0.22}
      />
      <circle cx={c} cy={c} r={Number((face * 0.97).toFixed(2))} fill="none" stroke={lit} strokeWidth={0.6} opacity={0.4} />
    </svg>
  );
}
