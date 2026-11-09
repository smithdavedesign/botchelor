import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// npm run sim:companion: the companion quality gate (scripts/sim-companion.sim.ts), on vitest so it runs the real engine
// on a throwaway PGlite database. Not part of the test suite (its include is tests/**).
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }] },
  test: {
    root,
    environment: "node",
    include: ["scripts/sim-companion.sim.ts"],
    setupFiles: ["tests/setup-no-live-checks.ts"],
    testTimeout: 4 * 60 * 60_000,
    hookTimeout: 60_000,
  },
});
