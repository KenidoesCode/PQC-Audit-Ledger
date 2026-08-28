"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The rail.
 *
 * The Grid does not have a sidebar. It has a beam across the top: the system
 * name struck at one end with the disc glyph beside it, the sections laid along
 * it in wide-tracked caps, and the one you are standing in lit from underneath.
 *
 * It is sticky. The ledger runs to sixty rows a page and the Merkle listing
 * longer than that, and losing the way out of a long table is a real cost that
 * a fixed 44px of chrome is worth paying.
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

export function Rail() {
  const pathname = usePathname();

  return (
    <header className="rail">
      <div className="rail-inner">
        <Link href="/" className="rail-mark mr-3 shrink-0">
          PQC Audit Ledger
        </Link>
        {/* Layout lives in .rail-nav, not in utilities: below 1280px the rail
            becomes one horizontally scrolling strip, and a flex-wrap utility
            would sit in a later cascade layer and win. */}
        <nav aria-label="Sections" className="rail-nav">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              aria-current={
                pathname === section.href || pathname.startsWith(section.href + "/") ? "page" : undefined
              }
              className="rail-link"
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
