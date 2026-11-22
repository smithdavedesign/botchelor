#!/usr/bin/env node
/**
 * npm run gate: the quick local check before pushing a PR (a few minutes, one vitest worker for the 16 GB Mac).
 *
 *   1. tsc --noEmit over the whole project (about a minute)
 *   2. oxlint over the whole project (npm run lint, under a second)
 *   3. the test files this branch changed against origin/main (committed or not), and the tests that import a changed
 *      module directly, plus the CSS checks (css-tokens, css-balance) when a .css file changed
 *
 * The full suite, the typecheck and the lint run on GitHub's free runners for every PR and every push to main
 * (.github/workflows/ci.yml, sharded), so this script doesn't repeat them. Merge once every PR check is green.
 *
 *   BASE=<ref> npm run gate   compare against another ref (default origin/main)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

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

// The tests to run: changed test files, plus every test that imports a changed module directly (`@/lib/x`, `@/app/…`).
// Not `vitest related`: it follows imports transitively, and a shared module (lib/db.ts, lib/media-tools/ffmpeg.ts)
// pulls in most of the suite, which is CI's job. Plus the CSS checks when CSS changed (CSS has no importers).
const testFiles = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).map((f) => `tests/${f}`);
const sources = new Map(testFiles.map((f) => [f, readFileSync(f, "utf8")]));
const modules = changed.filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("tests/") && !f.startsWith("scripts/"));
const picked = new Set(changed.filter((f) => sources.has(f)));
for (const m of modules) {
  const spec = `@/${m.replace(/\.(ts|tsx)$/, "").replace(/\/index$/, "")}`;
  const re = new RegExp(`["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  for (const [f, src] of sources) if (re.test(src)) picked.add(f);
}
if (changed.some((f) => f.endsWith(".css"))) ["tests/css-tokens.test.ts", "tests/css-balance.test.ts"].forEach((f) => picked.add(f));
const targets = [...picked].sort();

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
step("lint", "npm", ["run", "--silent", "lint"]);
if (targets.length) {
  step(`${targets.length} test file(s) touching the change`, "npx", ["vitest", "run", "--maxWorkers=1", ...targets]);
} else {
  console.log("\nNo test imports the change directly: CI's full suite covers it.");
}
console.log("\nGate passed. Push, open the PR; CI runs the full suite on GitHub.");
