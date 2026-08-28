import type { Metadata } from "next";

import "./globals.css";
import { Derez } from "@/ui/derez";
import { Shell } from "@/ui/shell";

export const metadata: Metadata = {
  title: "PQC Audit Ledger",
  description:
    "Post-quantum signed, tamper-evident audit receipts for agentic payments. ML-DSA-65 signatures, Merkle anchoring, and an offline verifier.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Derez />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
