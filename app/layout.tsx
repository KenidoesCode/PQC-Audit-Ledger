import type { Metadata } from "next";

import "./globals.css";
import { Faceplate } from "@/ui/faceplate";
import { VaultDoor } from "@/ui/vault-door";

export const metadata: Metadata = {
  title: "PQC Audit Ledger",
  description:
    "Post-quantum signed, tamper-evident audit receipts for agentic payments. ML-DSA-65 signatures, Merkle anchoring, and an offline verifier.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Faceplate />
        <VaultDoor />
        <main className="mx-auto max-w-[1500px] px-6 py-7">{children}</main>
      </body>
    </html>
  );
}
