#!/usr/bin/env node
/**
 * Runs the date-quality eval (lib/eval.ts) against a deployment and writes the results.
 *
 *   CRON_SECRET=… node scripts/eval-dates.mjs --label baseline [--base https://botchelor.vercel.app]
 *       [--actor gemini-…] [--director gemini-…] [--judge gemini-…] [--cases a,b] [--gap 20] [--repeat 2]
 *       [--shared-quota yes]
 *
 * Each case is one POST /api/jobs/eval (built in memory on the server: no stored data is read or written).
 * Requests are spaced (--gap seconds) to stay inside the free tier's per-minute quota. --repeat N runs the
 * whole set N times (the same engine outcomes, fresh words), since one sample per case is noisy. Writes
 * docs/eval/<label>.json (every transcript, metric and judge score) and prints a summary table. It refuses to run
 * on the live show's quota unless the deployment has EVAL_GOOGLE_API_KEY or you pass --shared-quota yes.
 * Compare runs with scripts/eval-report.mjs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1] ?? ""]] : pairs), []),
);
const base = (args.base || "https://botchelor.vercel.app").replace(/\/+$/, "");
const label = args.label;
const gap = Number(args.gap ?? 20) * 1000;
const secret = process.env.CRON_SECRET;
if (!label) throw new Error("--label is required");
if (!secret) throw new Error("CRON_SECRET must be set (it gates the internal eval route)");

const ALL = ["thin-oc-juniper", "rafe-juniper", "mira-dex", "teo-ines", "orin-sable", "kaz-nell"];
const cases = args.cases ? args.cases.split(",") : ALL;
const models = { actor: args.actor || undefined, director: args.director || undefined, judge: args.judge || undefined };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An eval on production's key spends the live show's free daily quota (~14 calls a date): on 2026-10-15 a few
// back-to-back runs spent the day's quota and live dates failed until the reset. Refuse unless the deployment
// has its own eval key, or the caller explicitly accepts sharing.
async function checkQuota() {
  const res = await fetch(`${base}/api/jobs/eval`, { headers: { authorization: `Bearer ${secret}` } }).catch(() => null);
  const info = res?.ok ? await res.json() : null;
  if (info?.quota === "eval") return;
  if (args["shared-quota"] === "yes") {
    console.error("warning: this eval spends the live show's free daily quota (no EVAL_GOOGLE_API_KEY on the deployment)");
    return;
  }
  console.error(
    "refusing: this deployment has no EVAL_GOOGLE_API_KEY, so an eval would spend the live show's free daily quota.\n" +
      "Set EVAL_GOOGLE_API_KEY on the deployment (a separate free project), or pass --shared-quota yes to accept that.",
  );
  process.exit(2);
}
await checkQuota();
const repeat = Math.max(1, Math.min(5, Number(args.repeat ?? 1)));
const queue = Array.from({ length: repeat }, () => cases).flat();
const results = [];
for (const [i, id] of queue.entries()) {
  if (i > 0) await sleep(gap);
  const t0 = Date.now();
  let result = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      const res = await fetch(`${base}/api/jobs/eval`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ case: id, ...models }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      result = await res.json();
    } catch (err) {
      console.error(`  ${id}: ${err.message}${attempt === 0 ? " — retrying in 60s" : ""}`);
      if (attempt === 0) await sleep(60_000);
    }
  }
  if (!result) { results.push({ case: id, error: "failed" }); continue; }
  results.push(result);
  const m = result.metrics;
  console.log(
    `${id.padEnd(16)} ${result.ending.padEnd(14)} turns ${String(m.turns).padStart(2)} index ${String(m.index).padStart(3)} ` +
      `judge ${result.judge_mean ?? "-"} | profile ${m.profile_reading} flips ${m.abrupt_flips} q ${m.question_rate} ` +
      `resp ${m.responsiveness} distinct ${m.distinctness} | ${result.model_calls} calls ${((Date.now() - t0) / 1000).toFixed(0)}s` +
      (result.conversation_error ? ` | conversation failed: ${result.conversation_error}` : ""),
  );
}

const ok = results.filter((r) => r.metrics);
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const summary = {
  index: mean(ok.map((r) => r.metrics.index)),
  judge_mean: mean(ok.filter((r) => r.judge_mean !== null).map((r) => r.judge_mean)),
  profile_reading: mean(ok.map((r) => r.metrics.profile_reading)),
  abrupt_flips: mean(ok.map((r) => r.metrics.abrupt_flips)),
  misgendered: mean(ok.map((r) => r.metrics.misgendered)),
  question_rate: mean(ok.map((r) => r.metrics.question_rate)),
  responsiveness: mean(ok.map((r) => r.metrics.responsiveness)),
  distinctness: mean(ok.map((r) => r.metrics.distinctness)),
  model_calls: mean(ok.map((r) => r.model_calls)),
  conversations_failed: ok.filter((r) => r.conversation_error).length,
};
mkdirSync(join(ROOT, "docs", "eval"), { recursive: true });
const out = join(ROOT, "docs", "eval", `${label}.json`);
writeFileSync(out, JSON.stringify({ label, ran_at: new Date().toISOString(), base, models, summary, results }, null, 2) + "\n");
console.log(`\n${label}: ${JSON.stringify(summary)}\nwrote ${out}`);
