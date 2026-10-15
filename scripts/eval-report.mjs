#!/usr/bin/env node
/**
 * Compares date-quality eval runs side by side: node scripts/eval-report.mjs [--rescore] docs/eval/a.json docs/eval/b.json …
 * Prints a markdown table (headline numbers, then the judge's dimensions) for docs/date-quality.md.
 *
 * --rescore recomputes every run's deterministic metrics with the current lib/quality.ts (loaded through Vite's
 * module runner, the same TypeScript the tests run), so runs saved by older versions compare like for like.
 * The judge's scores are kept as recorded.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rescore = process.argv.includes("--rescore");
const runs = process.argv.slice(2).filter((a) => a !== "--rescore").map((p) => JSON.parse(readFileSync(p, "utf8")));
if (!runs.length) throw new Error("pass one or more docs/eval/*.json files");
if (rescore) {
  const { runnerImport } = await import("vite");
  const { module: evalLib } = await runnerImport(join(ROOT, "lib/eval.ts"), {
    configFile: false,
    root: ROOT,
    logLevel: "error",
    resolve: { alias: [{ find: /^@\//, replacement: `${ROOT}/` }] },
  });
  for (const run of runs) for (const r of run.results) if (r.transcript?.length) r.metrics = evalLib.rescoreResult(r);
}
const mean = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "–");
const rows = [
  ["Genuineness index (0-100)", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.index))],
  ["Judge mean (1-5)", (r) => mean(r.results.filter((x) => x.judge_mean != null).map((x) => x.judge_mean))],
  ["…in character (A/B avg)", (r) => mean(r.results.filter((x) => x.judge).map((x) => (x.judge.in_character_a + x.judge.in_character_b) / 2))],
  ["…natural", (r) => mean(r.results.filter((x) => x.judge).map((x) => x.judge.natural))],
  ["…motivated ending", (r) => mean(r.results.filter((x) => x.judge).map((x) => x.judge.motivated))],
  ["…specific", (r) => mean(r.results.filter((x) => x.judge).map((x) => x.judge.specific))],
  ["…distinct voices", (r) => mean(r.results.filter((x) => x.judge).map((x) => x.judge.distinct))],
  ["…engaging", (r) => mean(r.results.filter((x) => x.judge).map((x) => x.judge.engaging))],
  ["Profile-reading lines / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.profile_reading))],
  ["Judge flagged profile-reading", (r) => `${r.results.filter((x) => x.judge?.profile_reading).length}/${r.results.filter((x) => x.judge).length}`],
  ["Self-labels + self-quotes / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => (x.metrics.self_labels ?? 0) + (x.metrics.self_quotes ?? 0)))],
  ["Repeated openers / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.repeated_openers ?? 0))],
  ["Repeated stage directions / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.repeated_actions ?? 0))],
  ["Name tics / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.name_tics ?? 0))],
  ["Misgendering (lines / date)", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.misgendered))],
  ["Abrupt flips / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.abrupt_flips))],
  ["Judge flagged abrupt turn", (r) => `${r.results.filter((x) => x.judge?.abrupt_turn).length}/${r.results.filter((x) => x.judge).length}`],
  ["Question rate", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.question_rate))],
  ["Responsiveness", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.responsiveness))],
  ["Distinct vocabulary", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.distinctness))],
  ["Words per line", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.avg_words))],
  ["Line-length spread (words)", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.metrics.length_spread ?? 0))],
  ["Model calls / date", (r) => mean(r.results.filter((x) => x.metrics).map((x) => x.model_calls))],
  ["Conversations failed", (r) => `${r.results.filter((x) => x.conversation_error || x.error).length}/${r.results.length}`],
];
console.log(`| Metric | ${runs.map((r) => r.label).join(" | ")} |`);
console.log(`|---|${runs.map(() => "---").join("|")}|`);
for (const [name, f] of rows) console.log(`| ${name} | ${runs.map(f).join(" | ")} |`);
