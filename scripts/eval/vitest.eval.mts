import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The paid date evals that run the real pipeline in-process (scripts/eval/living-dates.eval.ts): never part of the test
 * suite (tests/**), run by hand with `npx vitest run --config scripts/eval/vitest.eval.mts`. No setup file: these talk
 * to a real model on purpose, with a key read from the keychain into the environment.
 */
const root = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }] },
  test: { environment: "node", include: ["scripts/eval/**/*.eval.ts"], testTimeout: 3_600_000, hookTimeout: 60_000 },
});
