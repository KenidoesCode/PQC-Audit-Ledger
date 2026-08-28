"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The vault door.
 *
 * On a route change, two leaves are already closed across the viewport and are
 * driven apart on their screws to reveal the new page. It is the only motion on
 * the site that covers content, and it is built so that it cannot strand a
 * reader:
 *
 *   - The overlay is fixed and pointer-events: none, always. A curtain that
 *     swallows a click is worse than no curtain.
 *   - Nothing renders until the pathname has actually changed. On a cold load
 *     there is no overlay in the markup at all, so a first paint can never
 *     flash a closed door.
 *   - The animation is two CSS transforms on two divs. No library, no canvas,
 *     no per-frame JavaScript.
 *   - The resting transform is off-screen and the animation only ever moves
 *     away from centre, so a page at rest has no overlay over any part of it
 *     even if the animation never runs -- which is exactly what happens under
 *     prefers-reduced-motion.
 *
 * 420ms, which is about as long as a real door takes to clear and short enough
 * that it never reads as the site being slow.
 */
export function VaultDoor() {
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
    <div className="vault" aria-hidden="true">
      {cycle > 0 && (
        <>
          <div key={"l" + cycle} className="vault-leaf vault-leaf-left" />
          <div key={"r" + cycle} className="vault-leaf vault-leaf-right" />
        </>
      )}
    </div>
  );
}
