#!/usr/bin/env node
/**
 * Judges a saved eval run again with today's judge prompt, so every run is scored by the same judge:
 *
 *   CRON_SECRET=… node scripts/eval-rejudge.mjs docs/eval/v2-lite.json --judge gemini-3.5-flash-lite
 *       [--times 2] [--label v2-lite.j2] [--base https://botchelor.vercel.app] [--gap 4]
 *
 * Each transcript goes to POST /api/jobs/eval as { case, judge, transcript }: nothing is generated and no
 * stored data is touched. --times N judges every transcript N times and averages the scores (the booleans by
 * majority), which damps the judge's own noise. Writes docs/eval/<label>.json (default: <run>.rejudged) with
 * the original transcripts and metrics and the new judge scores. Compare with scripts/eval-report.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [file, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1] ?? ""]] : pairs), []));
if (!file) throw new Error("pass a docs/eval/*.json run");
const base = (args.base || "https://botchelor.vercel.app").replace(/\/+$/, "");
const judge = args.judge;
const times = Math.max(1, Math.min(5, Number(args.times ?? 1)));
const gap = Number(args.gap ?? 4) * 1000;
const secret = process.env.CRON_SECRET;
if (!judge) throw new Error("--judge is required");
if (!secret) throw new Error("CRON_SECRET must be set (it gates the internal eval route)");

const run = JSON.parse(readFileSync(file, "utf8"));
const label = args.label || `${basename(file, ".json")}.rejudged`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCORES = ["in_character_a", "in_character_b", "natural", "motivated", "specific", "distinct", "engaging"];
const FLAGS = ["profile_reading", "misgendering", "abrupt_turn"];

async function judgeOnce(r) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/api/jobs/eval`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ case: r.case, judge, transcript: r.transcript }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      if (body.judge) return body.judge;
      throw new Error("the judge returned no verdict");
    } catch (err) {
      console.error(`  ${r.case}: ${err.message}${attempt === 0 ? " — retrying in 30s" : ""}`);
      if (attempt === 0) await sleep(30_000);
    }
  }
  return null;
}

/** The mean of N verdicts: each score averaged (2 decimals), each flag true if at least half said so. */
function combine(verdicts) {
  const out = {};
  for (const k of SCORES) out[k] = Math.round((verdicts.reduce((s, v) => s + v[k], 0) / verdicts.length) * 100) / 100;
  for (const k of FLAGS) out[k] = verdicts.filter((v) => v[k]).length * 2 >= verdicts.length;
  out.note = verdicts[0].note;
  return out;
}

const results = [];
let first = true;
for (const r of run.results) {
  if (!r.transcript?.length) { results.push(r); continue; }
  const verdicts = [];
  for (let i = 0; i < times; i++) {
    if (!first) await sleep(gap);
    first = false;
    const v = await judgeOnce(r);
    if (v) verdicts.push(v);
  }
  const verdict = verdicts.length ? combine(verdicts) : null;
  const mean = verdict ? Math.round((SCORES.reduce((s, k) => s + verdict[k], 0) / SCORES.length) * 100) / 100 : null;
  results.push({ ...r, judge: verdict, judge_mean: mean, judge_runs: verdicts.length });
  console.log(`${r.case.padEnd(16)} judge ${mean ?? "-"} (${verdicts.length}/${times}) | was ${r.judge_mean ?? "-"}`);
}

const judged = results.filter((x) => x.judge_mean != null);
const judgeMean = judged.length ? Math.round((judged.reduce((s, x) => s + x.judge_mean, 0) / judged.length) * 100) / 100 : null;
const out = { ...run, label, rejudged_at: new Date().toISOString(), rejudged_from: basename(file), models: { ...run.models, judge }, judge_times: times, results };
out.summary = { ...run.summary, judge_mean: judgeMean };
const path = join(ROOT, "docs", "eval", `${label}.json`);
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\n${label}: judge_mean ${judgeMean} (was ${run.summary?.judge_mean ?? "-"})\nwrote ${path}`);
