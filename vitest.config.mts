import { defineConfig } from "vitest/config";
import path from "node:path";

const here = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Each test file opens its own in-memory PostgreSQL. Sequential files keep
    // memory bounded and make a failure attributable to one file.
    fileParallelism: false,
    sequence: { concurrent: false },
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      DATABASE_URL: "pglite://:memory:",
      PAYMENT_MODE: "SIMULATED",
    },
    reporters: ["default"],
  },
  resolve: {
    alias: { "@": path.resolve(here, "./src"), "~": path.resolve(here, "./") },
  },
});
