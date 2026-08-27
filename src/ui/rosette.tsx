/**
 * The guilloché rosette.
 *
 * ===========================================================================
 * THE VISUAL IS THE CRYPTOGRAPHY
 * ===========================================================================
 * Every parameter of this figure -- the two frequencies, the phase, the radial
 * amplitude, the number of strokes, the ink weight -- is read out of the
 * receipt's own payload hash. Nothing about it is chosen. Two receipts engrave
 * the same rosette if and only if they have the same payload hash, which is to
 * say: never, unless someone finds a SHA-256 collision.
 *
 * The consequence is the reason this exists. A tampered receipt does not
 * display a warning badge next to an otherwise identical document -- it engraves
 * a visibly different seal. Change one paise and the whole figure redraws. An
 * operator who has looked at a receipt once will notice the second one is not
 * the same document before reading a single hex character, which is a kind of
 * checking that no amount of monospace text achieves.
 *
 * This is exactly the job guilloché has done on banknotes since the 1820s: a
 * pattern that is trivial to generate from a plate and impractical to
 * reproduce without it. Here the plate is the hash.
 *
 * The curve is an epitrochoid-like sum of two harmonics in polar form, drawn as
 * an SVG path. No library, no canvas, no client JavaScript -- it renders on the
 * server and ships as markup.
 */

interface RosetteProps {
  /** The receipt payload hash, hex. */
  hash: string;
  size?: number;
  /** Ink colour. Vermilion is used where a receipt failed verification. */
  tone?: "intaglio" | "vermilion" | "ochre";
  className?: string;
}

function byteAt(hash: string, index: number): number {
  const offset = (index * 2) % Math.max(2, hash.length - 1);
  const parsed = Number.parseInt(hash.slice(offset, offset + 2), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Rosette({ hash, size = 132, tone = "intaglio", className }: RosetteProps) {
  const clean = hash.replace(/^0x/, "").toLowerCase();

  // Each parameter reads a different byte. The ranges are chosen so that every
  // possible hash produces a figure that is legible -- a rosette that degenerates
  // into a circle for one hash in ten would defeat the point.
  const petals = 5 + (byteAt(clean, 0) % 11); // 5..15
  const inner = 3 + (byteAt(clean, 1) % 7); // 3..9
  const amplitude = 0.16 + (byteAt(clean, 2) / 255) * 0.2; // 0.16..0.36
  const phase = (byteAt(clean, 3) / 255) * Math.PI * 2;
  const rings = 4 + (byteAt(clean, 4) % 4); // 4..7
  const twist = (byteAt(clean, 5) / 255) * 0.5;
  const stroke = 0.45 + (byteAt(clean, 6) / 255) * 0.35;

  const stops = 480;
  const radius = size / 2 - 4;

  const paths: string[] = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const scale = 1 - ring * (0.62 / rings);
    const ringPhase = phase + ring * twist;
    let d = "";
    for (let i = 0; i <= stops; i += 1) {
      const t = (i / stops) * Math.PI * 2;
      const r =
        radius *
        scale *
        (1 - amplitude + amplitude * Math.cos(petals * t + ringPhase) * Math.cos(inner * t - ringPhase * 0.5));
      const x = size / 2 + r * Math.cos(t);
      const y = size / 2 + r * Math.sin(t);
      d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    }
    paths.push(d + "Z");
  }

  const colour =
    tone === "vermilion"
      ? "var(--color-vermilion)"
      : tone === "ochre"
        ? "var(--color-ochre)"
        : "var(--color-intaglio-mid)";

  return (
    <svg
      width={size}
      height={size}
      viewBox={"0 0 " + size + " " + size}
      className={className}
      role="img"
      aria-label={"Guilloché seal engraved from payload hash " + clean.slice(0, 12)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius + 3}
        fill="none"
        stroke={colour}
        strokeWidth={0.7}
        opacity={0.55}
      />
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          opacity={0.34 + (i / paths.length) * 0.5}
        />
      ))}
    </svg>
  );
}
