"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The spine.
 *
 * A printed instrument does not have a sidebar. It has a header rule with the
 * issuing authority on the left and the instrument's class along it, and that
 * is what this is: one double rule across the top of every page, section names
 * set in letterpress small caps.
 */

const LINKS = [
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

export function Spine() {
  const pathname = usePathname();

  return (
    <header className="spine">
      <div className="spine-inner">
        <Link href="/overview" className="mr-4 shrink-0">
          <span className="font-[family-name:var(--font-ledger)] text-[0.6875rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-intaglio)]">
            PQC Audit Ledger
          </span>
        </Link>
        <nav aria-label="Sections" className="flex flex-wrap gap-x-5 gap-y-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href || pathname.startsWith(link.href + "/") ? "page" : undefined}
              className="spine-link"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="spine-link ml-auto text-[var(--color-vermilion)]">Simulated — no live money</span>
      </div>
    </header>
  );
}
