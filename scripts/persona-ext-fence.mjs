#!/usr/bin/env node
/**
 * The CI path fence for character requests (docs/persona-ext.md). The self-improving loop's fixer builds a feature a
 * character asked for on a branch named `loop/ext-<issue>-<slug>`; such a branch may change only an extension's own
 * folder, the registry and its tests. The contract (types.ts) and everything else stay out of its reach. Run by CI's
 * typecheck job with the PR's branch: `HEAD_REF=<branch> node scripts/persona-ext-fence.mjs` lists the changed files
 * from `git diff HEAD^1 HEAD` (the PR's merge commit against its base) and fails on any outside the fence.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const EXT_BRANCH = /^loop\/ext-/;

/** The changed paths a branch may not change: none unless it's a character-request branch. */
export function fencePaths(branch, paths) {
  if (!EXT_BRANCH.test(branch ?? "")) return [];
  return paths.filter((p) => !(/^lib\/persona-ext\/[a-z][a-z0-9_]{2,31}\/[^/]+(\/[^/]+)*\.ts$/.test(p) || p === "lib/persona-ext/index.ts" || /^tests\/persona-ext\/[a-z][a-z0-9_]{2,31}\.test\.ts$/.test(p)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const branch = process.env.HEAD_REF ?? "";
  if (!EXT_BRANCH.test(branch)) process.exit(0);
  const paths = execFileSync("git", ["diff", "--name-only", "HEAD^1", "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const out = fencePaths(branch, paths);
  if (out.length) {
    console.error(`A character-request branch (${branch}) may change only lib/persona-ext/<slug>/, lib/persona-ext/index.ts and tests/persona-ext/<slug>.test.ts. Outside the fence:\n${out.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`persona-ext fence: ${paths.length} files, all inside.`);
}
