"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The faceplate.
 *
 * A machine does not have a sidebar. It has a front panel: one gunmetal rail
 * with the plant name struck into it and the sections indexed along it in
 * condensed caps, and a brass notch cut under the one you are standing at. The
 * notch is the same language as the index notches on the discs, which is the
 * point -- the whole site is one instrument.
 */

const SECTIONS = [
  { href: "/overview", label: "Overview" },
  { href: "/activity", label: "Activity" },
  { href: "/receipts", label: "Ledger" },
  { href: "/verifier", label: "Verifier" },
  { href: "/merkle", label: "Merkle" },
  { href: "/evaluation", label: "Evaluation" },
  { href: "/failures", label: "Failures" },
  { href: "/review", label: "Review" },
  { href: "/developer", label: "Developer" },
  { href: "/settings", label: "Settings" },
];

export function Faceplate() {
  const pathname = usePathname();

  return (
    <header className="faceplate">
      <div className="faceplate-inner">
        <Link href="/overview" className="faceplate-mark mr-3 shrink-0">
          PQC Audit Ledger
        </Link>
        {/* Layout lives in .faceplate-nav, not in utilities: below 720px the
            rail becomes one horizontally scrolling strip, and a flex-wrap
            utility would sit in a later cascade layer and win. */}
        <nav aria-label="Sections" className="faceplate-nav">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              aria-current={
                pathname === section.href || pathname.startsWith(section.href + "/") ? "page" : undefined
              }
              className="index-mark"
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <span className="tag tag-void ml-auto shrink-0">Simulated — no live money</span>
      </div>
    </header>
  );
}
