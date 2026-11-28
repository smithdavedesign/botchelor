import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// npm run sweep:characters: the read-only report of saved characters today's save checks would refuse
// (scripts/sweep-characters.sim.ts), on vitest so it can import the TypeScript checks. Not part of the test suite.
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }] },
  test: { root, environment: "node", include: ["scripts/sweep-characters.sim.ts"], testTimeout: 30 * 60_000 },
});
