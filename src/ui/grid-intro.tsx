"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * THE LANDING.
 *
 * ===========================================================================
 * A MERKLE TREE IS A CIRCUIT, SO IT IS DRAWN AS ONE
 * ===========================================================================
 * One canvas behind the whole landing. A perspective Grid recedes to a
 * horizon; the ledger's Merkle lattice stands on that horizon; and as you
 * scroll, light traces run up the lattice edge by edge, level by level, until
 * the root seals and holds.
 *
 * The shape is the real shape: n leaves fold in pairs, a node at index j goes
 * into the parent at floor(j/2), and the traces from one leaf to the root are
 * exactly the path a proof walks. Nothing is drawn that the tree does not do.
 *
 * PERFORMANCE. Everything is transform-free canvas work on one layer:
 *   - No scroll listener. The loop reads window.scrollY once per frame and
 *     writes nothing that affects layout, so there is no read/write thrash.
 *   - The scroll denominator is cached and recomputed on resize, so
 *     scrollHeight is never read in the loop.
 *   - Device pixel ratio is capped (1.5 on a phone, 2 elsewhere). An uncapped
 *     DPR on a 3x phone is nine times the fill for no visible gain.
 *   - About a hundred stroke operations a frame at any viewport.
 *
 * REDUCED MOTION. No loop at all. One frame is drawn with the lattice fully
 * traced and the root sealed, and it is redrawn only on resize. The scenes are
 * shown outright by the stylesheet. Nothing moves and nothing is missing.
 */

/** Leaf count drawn. Not the ledger's real batch size -- this is the landing,
 *  and 64 leaves at 360px is a grey smear. The real tree is on /merkle. */
const LEAVES_WIDE = 16;
const LEAVES_NARROW = 8;

interface Node {
  x: number;
  y: number;
}

function buildLattice(w: number, h: number, horizon: number): Node[][] {
  const leaves = w < 560 ? LEAVES_NARROW : LEAVES_WIDE;
  const levels: Node[][] = [];
  const top = h * 0.13;
  const spanX = w * 0.78;
  const x0 = w * 0.11;

  let count = leaves;
  let level = 0;
  const depth = Math.log2(leaves) + 1;
  while (count >= 1) {
    const row: Node[] = [];
    for (let i = 0; i < count; i += 1) {
      row.push({
        x: x0 + (spanX * (i + 0.5)) / count,
        y: horizon - (horizon - top) * (level / (depth - 1)),
      });
    }
    levels.push(row);
    if (count === 1) break;
    count = Math.ceil(count / 2);
    level += 1;
  }
  return levels;
}

/** How far the traces have run at scroll progress p, for one level of edges. */
function edgeProgress(p: number, level: number): number {
  const start = 0.05 + level * 0.115;
  return Math.min(1, Math.max(0, (p - start) / 0.17));
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, p: number, t: number): void {
  ctx.clearRect(0, 0, w, h);
  const horizon = h * 0.68;

  // ---- The floor. Verticals converge on the vanishing point; horizontals are
  // spaced by a power law so they crowd toward the horizon the way a real
  // perspective does, and drift toward the viewer with time.
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(124, 232, 255, 0.16)";
  ctx.beginPath();
  const cols = 24;
  for (let i = 0; i <= cols; i += 1) {
    const x = w / 2 + (i - cols / 2) * ((w * 3.2) / cols);
    ctx.moveTo(x, h + 2);
    ctx.lineTo(w / 2, horizon);
  }
  ctx.stroke();

  const rows = 15;
  const drift = ((t * 0.00006) % 1) + 1e-4;
  for (let i = 0; i < rows; i += 1) {
    const z = (i + drift) / rows;
    const y = horizon + (h - horizon) * Math.pow(z, 2.7);
    ctx.strokeStyle = "rgba(124, 232, 255, " + (0.05 + 0.2 * z).toFixed(3) + ")";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // The horizon itself: the brightest line on the Grid.
  ctx.strokeStyle = "rgba(160, 244, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(w, horizon);
  ctx.stroke();

  // ---- The lattice.
  const levels = buildLattice(w, h, horizon);
  const depth = levels.length;

  for (let l = 0; l < depth - 1; l += 1) {
    const row = levels[l];
    const above = levels[l + 1];
    if (!row || !above) continue;
    const f = edgeProgress(p, l);

    for (let i = 0; i < row.length; i += 1) {
      const a = row[i];
      const b = above[i >> 1];
      if (!a || !b) continue;

      // The unlit edge is always there. The tree exists before the light does.
      ctx.strokeStyle = "rgba(124, 232, 255, 0.13)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      if (f <= 0) continue;
      const hx = a.x + (b.x - a.x) * f;
      const hy = a.y + (b.y - a.y) * f;
      ctx.strokeStyle = "rgba(190, 248, 255, 0.85)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      // The head of the trace, while it is still running.
      if (f < 1) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(hx, hy, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Nodes. A node lights when the level below it has finished folding into it.
  for (let l = 0; l < depth; l += 1) {
    const row = levels[l];
    if (!row) continue;
    const on = l === 0 ? 1 : edgeProgress(p, l - 1);
    const size = l === 0 ? 2.2 : 3;
    ctx.fillStyle =
      on >= 1 ? "rgba(220, 250, 255, 0.95)" : "rgba(124, 232, 255, " + (0.2 + 0.3 * on).toFixed(3) + ")";
    for (const node of row) {
      ctx.fillRect(node.x - size / 2, node.y - size / 2, size, size);
    }
  }

  // ---- The root seal. It locks once every trace beneath it has arrived, and
  // then it pulses -- which is the only thing on this page that repeats.
  const root = levels[depth - 1]?.[0];
  if (root) {
    const seal = Math.min(1, Math.max(0, (p - 0.05 - (depth - 2) * 0.115 - 0.17) / 0.1));
    if (seal > 0) {
      ctx.strokeStyle = "rgba(220, 250, 255, " + (0.4 + 0.6 * seal).toFixed(3) + ")";
      ctx.lineWidth = 1.5 + seal;
      ctx.beginPath();
      ctx.arc(root.x, root.y, 8 + 16 * seal, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (seal >= 1) {
      const pulse = ((t % 2600) / 2600) ** 0.6;
      ctx.strokeStyle = "rgba(124, 232, 255, " + (0.5 * (1 - pulse)).toFixed(3) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(root.x, root.y, 24 + 46 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export function GridIntro({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = rootRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let maxScroll = 1;
    let frame = 0;

    function size(): void {
      if (!canvas || !ctx) return;
      w = window.innerWidth;
      h = window.innerHeight;
      // Capped: an uncapped ratio on a 3x phone is nine times the fill rate for
      // no visible gain on hairlines.
      const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      maxScroll = Math.max(1, document.documentElement.scrollHeight - h);
    }

    function still_frame(): void {
      if (!ctx) return;
      draw(ctx, w, h, 1, 0);
    }

    function loop(now: number): void {
      if (!ctx) return;
      const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      draw(ctx, w, h, p, now);
      frame = window.requestAnimationFrame(loop);
    }

    size();
    if (still) still_frame();
    else frame = window.requestAnimationFrame(loop);

    function onResize(): void {
      size();
      if (still) still_frame();
    }
    window.addEventListener("resize", onResize);

    // Scene reveals. An observer, not a scroll handler: the browser does the
    // geometry off the main thread and the class flip is one style write.
    const scenes = Array.from(container.querySelectorAll<HTMLElement>(".scene"));
    let observer: IntersectionObserver | null = null;
    if (still) {
      for (const scene of scenes) scene.classList.add("on");
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) entry.target.classList.add("on");
          }
        },
        // Fires when a third of the scene is up. Tuned by eye, not derived:
        // lower and the copy arrives before the reader is looking at it.
        { threshold: 0.33 },
      );
      for (const scene of scenes) observer.observe(scene);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef}>
      <canvas ref={canvasRef} className="grid-canvas" aria-hidden="true" />
      {children}
    </div>
  );
}
