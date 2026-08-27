import { writeFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

/**
 * Bundles the offline verifier into one file with no install step.
 *
 * The output is a single ESM file that `node` can run directly. Everything --
 * the canonicalizer, SHA-256, the ML-DSA implementation, the Merkle code -- is
 * inlined, because a verifier that requires `npm install` before an auditor can
 * check anything is a verifier most auditors will not run.
 */
async function main(): Promise<void> {
  mkdirSync("public", { recursive: true });

  const result = await build({
    entryPoints: ["verifier-cli/main.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: "public/ledger-verify.mjs",
    banner: {
      js: [
        "#!/usr/bin/env node",
        "// ledger-verify -- offline verifier for a PQC audit bundle.",
        "// Single file, no dependencies, no network. Run:",
        "//   node ledger-verify.mjs bundle.json",
        "// Exit 0 = every receipt verified. Exit 1 = something did not.",
      ].join("\n"),
    },
    legalComments: "inline",
    metafile: true,
  });

  const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
  writeFileSync("public/ledger-verify.version.txt", new Date().toISOString() + "\n");
  process.stdout.write("public/ledger-verify.mjs  " + bytes + " bytes\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
