"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The derez.
 *
 * On a route change a light-cycle ribbon crosses the viewport and the page it
 * left behind comes apart into the lattice for a fifth of a second. It is the
 * only motion on the site that passes over content, and it is built so that it
 * cannot strand a reader:
 *
 *   - The overlay is fixed and pointer-events: none, always. A transition that
 *     swallows a click is worse than no transition.
 *   - Nothing renders until the pathname has actually changed. On a cold load
 *     there is no overlay in the markup at all, so a first paint can never
 *     flash a ribbon across the page.
 *   - The ribbon's resting transform is off-screen and the veil's resting
 *     opacity is zero, so a page at rest has no overlay over any part of it
 *     even if the animation never runs -- which is exactly what happens under
 *     prefers-reduced-motion, where both elements are display: none.
 *   - Two divs, two compositor properties. No library, no canvas, no per-frame
 *     JavaScript.
 *
 * 520ms, which is about how long a cycle takes to cross a screen and short
 * enough that it never reads as the site being slow.
 */
export function Derez() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (previous.current === null) {
      previous.current = pathname;
      return;
    }
    if (previous.current === pathname) return;
    previous.current = pathname;
    setCycle((current) => current + 1);
  }, [pathname]);

  return (
    <div className="derez" aria-hidden="true">
      {cycle > 0 && (
        <>
          <div key={"v" + cycle} className="derez-veil" />
          <div key={"r" + cycle} className="derez-ribbon" />
        </>
      )}
    </div>
  );
}
