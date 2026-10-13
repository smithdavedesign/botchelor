import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGlite (WASM Postgres) boots in about a second; leave headroom on slow CI.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
