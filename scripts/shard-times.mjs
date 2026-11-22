#!/usr/bin/env node
/**
 * Refreshes tests/shard-times.json, the per-file times CI's four test shards are balanced by (tests/shards.mjs), from
 * the newest green CI run on main (or the run given): each shard's log lists every file it ran and how long it took.
 * Needs the GitHub CLI (`gh`, signed in). Worth running when a shard trails the others by a minute or more.
 *
 *   node scripts/shard-times.mjs [run-id]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const REPO = "smithdavedesign/botchelor";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const run =
  process.argv[2] ??
  JSON.parse(gh("run", "list", "--repo", REPO, "--workflow", "ci.yml", "--branch", "main", "--status", "success", "--limit", "1", "--json", "databaseId"))[0]?.databaseId;
if (!run) throw new Error("no green CI run on main found");

const jobs = JSON.parse(gh("run", "view", String(run), "--repo", REPO, "--json", "jobs")).jobs.filter((j) => /^test \(\d\/\d\)$/.test(j.name));
const times = {};
for (const job of jobs) {
  // A file's line: " ✓ tests/x.test.ts (12 tests) 3456ms" (colour codes come through as ^[[…m).
  // eslint-disable-next-line no-control-regex -- the colour codes' escape character is what it strips
  const log = gh("run", "view", String(run), "--repo", REPO, "--log", "--job", String(job.databaseId)).replace(/(\x1b|\^\[)\[[0-9;]*m/g, "");
  for (const m of log.matchAll(/[✓❯×] (tests\/\S+\.test\.ts) \(\d+ tests?[^)]*\)(?: \d+ (?:failed|skipped))? *(\d+)ms/g)) times[m[1]] = Number(m[2]);
}
const files = Object.keys(times).filter((f) => existsSync(f)).sort();
if (files.length < 100) throw new Error(`only ${files.length} file times in run ${run}: not a full CI run?`);
const before = JSON.parse(readFileSync("tests/shard-times.json", "utf8"));
writeFileSync("tests/shard-times.json", `${JSON.stringify(Object.fromEntries(files.map((f) => [f, times[f]])), null, 1)}\n`);
console.log(`tests/shard-times.json: ${files.length} files from run ${run} (was ${Object.keys(before).length})`);
