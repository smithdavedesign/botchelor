#!/usr/bin/env node
// The house crowd's weekly report (docs/house-crowd.md): what the prompt tests have learned (the ledger on this Mac,
// scripts/crowd/policy.mjs), how the welcome experiment is doing and what the crowd did and drew (the site's owner-only
// /api/admin/crowd-report). Written to ~/.botchelor-crowd/reports/<date>.md, one line to the system log. launchd runs it
// on Monday mornings (scripts/crowd/install.sh); run it by hand any time:  node scripts/crowd/weekly-report.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { probabilityBest, tally, VARIANTS } from "./policy.mjs";

const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${Math.round(x * 1000) / 10}%`);
const share = (hits, n) => (n ? `${hits}/${n} (${pct(hits / n)})` : "–");
/** The bandit has a winner when one variant is this likely to be the best. */
export const WINNER_AT = 0.9;
/** Below this many people per arm the experiment can't say much yet. */
export const ENOUGH_PER_ARM = 100;

/** How many of `n`, as "3 (25%)"; a dash when there's nobody to count from. */
const ofN = (k, n) => (n ? `${k} (${Math.round((100 * k) / n)}%)` : "–");

/**
 * The week's visitors by where they came from, with how far each source's people got (lib/engagement.ts `sources`:
 * started a date, watched one end). The 2026-11-11 growth plan: channels are judged by people who finish a date, not
 * by clicks, and whatever brings nobody after two weeks is cut. Null engagement (the site couldn't be read) → []. Pure.
 */
export function channelLines(engagement) {
  const rows = (engagement?.sources ?? []).filter((s) => s.visitors > 0).sort((a, b) => b.visitors - a.visitors).slice(0, 12);
  if (!rows.length) return [];
  const out = ["## By channel (last 7 days)", "", "Real visitors by first source; each step is how many of that source's visitors did it. Loads nobody saw and our own traffic are left out.", ""];
  out.push("| Source | Visitors | Clicked | Made a character | Started a date | Watched it end | Signed up |", "|---|---|---|---|---|---|---|");
  for (const s of rows) out.push(`| ${s.source} | ${s.visitors} | ${ofN(s.engaged, s.visitors)} | ${ofN(s.created, s.visitors)} | ${ofN(s.started ?? 0, s.visitors)} | ${ofN(s.watched ?? 0, s.visitors)} | ${ofN(s.signups, s.visitors)} |`);
  const quiet = rows.filter((s) => !(s.started || s.watched)).map((s) => s.source);
  out.push("", quiet.length ? `No date started or watched from: ${quiet.join(", ")}.` : "Every source above brought someone who started or watched a date.", "");
  return out;
}

/**
 * The report as markdown, from the ledger, the site's crowd report and its engagement report (each null when it
 * couldn't be read). Pure.
 * @param {{ ledger: any[]; server: any; engagement?: any; now?: Date; rng?: () => number }} input
 */
export function buildReport({ ledger, server, engagement = null, now = new Date(), rng = Math.random }) {
  const lines = [`# House crowd: week to ${now.toISOString().slice(0, 10)}`, ""];
  lines.push(...channelLines(engagement));

  lines.push("## Prompt tests", "", "Scored by whether the other side wrote back themselves within a day (an agent, or a person on their own key; never a text the show wrote for them).", "");
  for (const dimension of Object.keys(VARIANTS)) {
    const t = tally(ledger, dimension);
    const best = probabilityBest(ledger, dimension, { samples: 4000, rng });
    const total = Object.values(t).reduce((n, v) => n + v.sent, 0);
    lines.push(`### ${dimension === "opener" ? "Openers" : "Text length"} (${total} settled)`, "", "| Variant | Settled | Wrote back | Still open | Chance it's best |", "|---|---|---|---|---|");
    for (const v of VARIANTS[dimension]) lines.push(`| ${v.id} | ${t[v.id].sent} | ${share(t[v.id].replied, t[v.id].sent)} | ${t[v.id].open} | ${pct(best[v.id])} |`);
    const [leader, chance] = Object.entries(best).sort((a, b) => b[1] - a[1])[0];
    lines.push(
      "",
      chance >= WINNER_AT
        ? `**${leader}** is winning (${pct(chance)} likely the best): the crowd already plays it most, and it can become the default.`
        : `No winner yet (the leader, ${leader}, is ${pct(chance)} likely the best): the crowd keeps exploring.`,
      "",
    );
  }

  lines.push("## Welcome experiment", "");
  if (!server) lines.push("Couldn't read the site's crowd report this week (see the log).", "");
  else {
    const w = server.welcome;
    const [tr, ct] = w.arms;
    lines.push(
      `${w.experiment}, from ${w.from.slice(0, 10)}: half of people's new characters get a like from the crowd's best fits (treatment), half don't (control).`,
      "",
      "| | Treatment | Control | Lift | p |",
      "|---|---|---|---|---|",
      `| Enrolled | ${tr.enrolled} | ${ct.enrolled} | | |`,
      `| Matched within 7 days | ${share(tr.matched_7d, tr.enrolled)} | ${share(ct.matched_7d, ct.enrolled)} | ${pct(w.lift.matched_7d.diff)} | ${w.lift.matched_7d.p?.toFixed(3) ?? "–"} |`,
      `| Booked a date within 7 days | ${share(tr.booked_7d, tr.enrolled)} | ${share(ct.booked_7d, ct.enrolled)} | ${pct(w.lift.booked_7d.diff)} | ${w.lift.booked_7d.p?.toFixed(3) ?? "–"} |`,
      `| Came back on day 1–2 | ${share(tr.d1_returned, tr.d1_eligible)} | ${share(ct.d1_returned, ct.d1_eligible)} | ${pct(w.lift.d1_returned.diff)} | ${w.lift.d1_returned.p?.toFixed(3) ?? "–"} |`,
      `| Came back on day 7–14 | ${share(tr.d7_returned, tr.d7_eligible)} | ${share(ct.d7_returned, ct.d7_eligible)} | ${pct(w.lift.d7_returned.diff)} | ${w.lift.d7_returned.p?.toFixed(3) ?? "–"} |`,
      "",
      Math.min(tr.enrolled, ct.enrolled) < ENOUGH_PER_ARM
        ? `Too early to call: ${Math.min(tr.enrolled, ct.enrolled)} in the smaller arm, and about ${ENOUGH_PER_ARM} each are needed before a difference means much.`
        : w.lift.d7_returned.p !== null && w.lift.d7_returned.p < 0.05
          ? `Day-7 return differs by ${pct(w.lift.d7_returned.diff)} (p ${w.lift.d7_returned.p.toFixed(3)}): ${w.lift.d7_returned.diff > 0 ? "the welcome helps; worth keeping and growing" : "the welcome hurts; worth switching off"}.`
          : "No clear difference in coming back yet.",
      "",
    );
    const a = server.activity;
    lines.push(
      `## What the crowd did (last ${server.days} days)`,
      "",
      `- ${a.bots} bots on the show.`,
      `- Likes given: ${a.bot_likes}. Likes received from everyone else: ${a.likes_for_bots}.`,
      `- Matches with people: ${a.matches_with_people}. With agents: ${a.matches_with_agents}.`,
      `- Dates with people: ${a.dates_with_people}. With agents: ${a.dates_with_agents}. Bot-vs-bot: ${a.bot_bot_dates}.`,
      `- Texts sent to the crowd by the other side: ${a.texts_to_bots}.`,
      "",
    );
  }
  // How likes are answered, by who was liked (lib/away.ts likeReturnStats): the deck's health for people and agents.
  if (server?.likes?.rows?.length) {
    const LABEL = { house_cast: "The house cast", house_bot: "The house crowd", agent: "Agents' characters", person: "People's characters" };
    lines.push(
      `## Likes answered (last ${server.likes.days} days)`,
      "",
      "| Liked | Likes | Back within an hour | Within a day | Passed | Still waiting |",
      "|---|---|---|---|---|---|",
      ...server.likes.rows.map((r) => `| ${LABEL[r.liked] ?? r.liked} | ${r.likes} | ${share(r.within_hour, r.likes)} | ${share(r.within_day, r.likes)} | ${r.passed} | ${r.waiting} |`),
      "",
      "Goal: over 80% within an hour for the house cast and crowd, and nothing left waiting on characters whose owner is away.",
      "",
    );
  }
  return lines.join("\n");
}

function adminKey() {
  if (process.env.FRONTIER_PASSWORD) return process.env.FRONTIER_PASSWORD;
  return execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"], { encoding: "utf8" }).trim();
}

async function main() {
  const home = process.env.CROWD_HOME || join(homedir(), ".botchelor-crowd");
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  let ledger = [];
  try {
    ledger = JSON.parse(readFileSync(join(home, "ledger.json"), "utf8"));
  } catch {
    /* no passes yet */
  }
  let server = null;
  try {
    const res = await fetch(`${base}/api/admin/crowd-report?days=7`, { headers: { "x-frontier-key": adminKey(), "user-agent": "botchelor-crowd-report/1.0" } });
    if (res.ok) server = await res.json();
    else console.error(`crowd-report: HTTP ${res.status}`);
  } catch (e) {
    console.error(`crowd-report: ${e.message}`);
  }
  // The same key reads the engagement report (app/api/admin/engagement): the week by source.
  let engagement = null;
  try {
    const day = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 10);
    const res = await fetch(`${base}/api/admin/engagement?from=${day(7 * 86_400_000)}&to=${day(0)}`, { headers: { "x-frontier-key": adminKey(), "user-agent": "botchelor-crowd-report/1.0" } });
    if (res.ok) engagement = await res.json();
    else console.error(`engagement: HTTP ${res.status}`);
  } catch (e) {
    console.error(`engagement: ${e.message}`);
  }
  const md = buildReport({ ledger, server, engagement });
  mkdirSync(join(home, "reports"), { recursive: true });
  const file = join(home, "reports", `${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, md);
  const w = server?.welcome?.arms;
  const summary = `report ${file}${w ? `; welcome ${w[0].enrolled}/${w[1].enrolled} enrolled` : ""}; ${ledger.length} texts in the prompt tests`;
  try {
    execFileSync(join(homedir(), "ai-stack", "bin", "emit-event"), ["botchelor", "house-crowd", "weekly-report", server ? "ok" : "fail", summary], { stdio: "ignore", timeout: 5000 });
  } catch {
    /* no ai-stack */
  }
  console.log(md);
  console.log(`\nSaved to ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
