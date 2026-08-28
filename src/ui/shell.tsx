"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Rail } from "./rail";

/**
 * Two shells, one layout.
 *
 * The landing is full-bleed and carries its own header, so the rail and the
 * page gutter are both wrong for it. Everything else is the console.
 *
 * `children` arrives as a prop from the server layout, so wrapping it in a
 * client component does not pull any page into the client bundle.
 */
export function Shell({ children }: { children: ReactNode }) {
  const landing = usePathname() === "/";
  return (
    <>
      {!landing && <Rail />}
      <main className={landing ? "bleed" : "page"}>{children}</main>
    </>
  );
}
