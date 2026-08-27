import type { ReactNode } from "react";

export function Plate({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"plate " + (className ?? "")}>
      {title && (
        <div className="plate-title flex items-baseline justify-between gap-3">
          <span>{title}</span>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Figure({ value, caption, tone }: { value: string; caption: string; tone?: "void" | "plain" }) {
  return (
    <div>
      <p className={"figure " + (tone === "void" ? "text-[var(--color-vermilion)]" : "")}>{value}</p>
      <p className="label mt-1">{caption}</p>
    </div>
  );
}

export function Stamp({
  kind,
  children,
}: {
  kind: "valid" | "void" | "pending" | "note";
  children: ReactNode;
}) {
  return <span className={"stamp stamp-" + kind}>{children}</span>;
}

/**
 * A hash, shown truncated with the full value available on hover and to a
 * screen reader.
 *
 * Truncation is display only. Nothing in this system stores or compares a
 * truncated hash: a 12-character prefix has 48 bits of collision resistance,
 * which is fine for recognising a document by eye and nowhere near enough to
 * decide it is the same one.
 */
export function Hash({ value, chars = 16 }: { value: string | null; chars?: number }) {
  if (!value) return <span className="hash text-[var(--color-intaglio-faint)]">(none)</span>;
  return (
    <span className="hash" title={value}>
      {value.length <= chars ? value : value.slice(0, chars) + "…"}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-[color-mix(in_oklab,var(--color-intaglio)_30%,transparent)] px-4 py-6 text-center text-sm text-[var(--color-intaglio-soft)]">
      {children}
    </p>
  );
}

/** Money, always from minor units. There is no float anywhere in this path. */
export function inr(minor: number): string {
  const rupees = Math.trunc(minor / 100);
  const paise = Math.abs(minor % 100);
  return "₹" + rupees.toLocaleString("en-IN") + "." + String(paise).padStart(2, "0");
}
