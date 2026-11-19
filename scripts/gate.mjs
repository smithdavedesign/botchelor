#!/usr/bin/env node
/**
 * npm run gate: the quick local check before pushing a PR (a few minutes, one vitest worker for the 16 GB Mac).
 *
 *   1. tsc --noEmit over the whole project (about a minute)
 *   2. vitest related on the files this branch changed against origin/main, committed or not, plus the CSS checks
 *      (css-tokens, css-balance) when a .css file changed, since CSS has no importers for `related` to find
 *
 * The full suite and the typecheck run on GitHub's free runners for every PR and every push to main
 * (.github/workflows/ci.yml, sharded), so this script doesn't repeat them. Merge once every PR check is green.
 *
 *   BASE=<ref> npm run gate   compare against another ref (default origin/main)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const BASE = process.env.BASE || "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

const mergeBase = git("merge-base", "HEAD", BASE);
const changed = [
  ...new Set([
    ...lines(git("diff", "--name-only", mergeBase)),
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ]),
].filter((f) => existsSync(f));

const code = changed.filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f) && !f.startsWith("scripts/"));
const css = changed.some((f) => f.endsWith(".css"));
const targets = [...code, ...(css ? ["tests/css-tokens.test.ts", "tests/css-balance.test.ts"] : [])];

function step(name, cmd, args) {
  const t = Date.now();
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  const secs = Math.round((Date.now() - t) / 1000);
  if (r.status !== 0) {
    console.error(`✗ ${name} failed (${secs}s)`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${name} (${secs}s)`);
}

console.log(`${changed.length} changed file(s) against ${BASE}`);
step("typecheck", "npx", ["tsc", "--noEmit", "-p", "."]);
if (targets.length) {
  step(`tests related to ${targets.length} file(s)`, "npx", [
    "vitest", "related", "--run", "--maxWorkers=1", "--passWithNoTests", ...targets,
  ]);
} else {
  console.log("\nNo code or CSS changed: no tests to run.");
}
console.log("\nGate passed. Push, open the PR; CI runs the full suite on GitHub.");
