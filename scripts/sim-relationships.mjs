#!/usr/bin/env node
/**
 * npm run sim:relationships — does a couple hold together and grow over several dates? (docs/relationship-sim-evidence.md)
 *
 * For each couple in scripts/sim-pairs.mjs (the same ten characters every run), it starts a fresh local app and:
 *   - books a first date, then each next one as a second date when both wanted another (the other owner says yes,
 *     then the booking owner), or a fresh date between the same two when they didn't;
 *   - airs each date, opens its afterglow, and runs the daily job once (the texts between dates);
 *   - saves the owner's episode view, the afterglow, the relationship edge, both characters' learned memory, story state and the
 *     couple's texts after every date;
 *   - screenshots the couple page and the last date on desktop and phone.
 * Then it writes summary.json: per couple, the edge after each date, endings, and what was remembered.
 *
 * Models:
 *   --model stub   (default) the local stub showrunner: free, fast, the same line every turn. Tests the plumbing.
 *   --model paid   the real model through an OpenAI-compatible endpoint: SIM_LLM_BASE_URL (default
 *                  OpenRouter), SIM_LLM_API_KEY (required, read from the environment only), SIM_MODEL (default
 *                  anthropic/claude-haiku-5.5, what production runs). Costs about 1¢ a date.
 * Options: --pairs 1,4,10 (default all)  --dates 5  --out .data/sim  --no-build  --no-screens
 *   --lessons-ab   the last date twice from the same history (lib/character-lessons.ts): once on a copy of the database
 *                  with CHARACTER_LESSONS=0, once with the characters' lessons in their prompts. Saves the lessons each
 *                  character holds (lessons.json) and both dates (date-N-without-lessons-view.json beside
 *                  date-N-view.json), and what the lessons step cost (run.json lessons_step). The two dates have
 *                  different ids, so the engine may decide them differently: compare what is said, not how it ends.
 *
 * Tokens: each run makes both owners admins with a throwaway password and grants them free dates (/api/admin/tokens),
 * so no code is patched. Needs CHROMIUM_PATH for the screenshots (never downloads a browser).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { appEnv, build, client, freePort, ipFor, persona, ROOT, startApp, startShowrunner, stopApp, WATCH_ADMIN_TOKEN } from "./harness.mjs";
import { PAIRS } from "./sim-pairs.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const MODEL = opt("model", "stub");
const DATES = Number(opt("dates", "5"));
const OUT = opt("out", join(ROOT, ".data", "sim"));
const PICK = opt("pairs", "all");
const LESSONS_AB = flag("lessons-ab");
const ADMIN_PASSWORD = randomBytes(18).toString("hex");
const GATEWAY = "https://openrouter.ai/api/v1";

if (!["stub", "paid"].includes(MODEL)) throw new Error("--model is stub or paid");
if (MODEL === "paid" && !process.env.SIM_LLM_API_KEY) throw new Error("--model paid needs SIM_LLM_API_KEY in the environment");

async function get(base, path, who, headers = {}) {
  const res = await fetch(base + path, { headers: { cookie: who.cookie, "x-forwarded-for": ipFor(who.id), ...headers } });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function post(base, path, body, who, headers = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: who.cookie, origin: base, "x-forwarded-for": ipFor(who.id), ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const must = (r, what, ok = [200, 201]) => {
  if (!ok.includes(r.status)) throw new Error(`${what} → ${r.status} (${r.data?.error ?? "?"}: ${r.data?.message ?? ""})`);
  return r.data;
};

/** The owner's view of the couple, through the MCP tool (identity is an argument there, not a cookie). */
async function relationship(base, who, a, b) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipFor(who.id) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_relationships", arguments: { character_id: a, with: b, agent_id: who.id } } }),
  });
  const body = await res.json();
  return body.result?.structuredContent?.relationships?.[0] ?? null;
}

async function gatewayBalance() {
  if (MODEL !== "paid") return null;
  // OpenRouter's key endpoint: what's left (or minus the usage when the key has no limit), so before − after = spend.
  const res = await fetch(`${process.env.SIM_LLM_BASE_URL || GATEWAY}/key`, { headers: { authorization: `Bearer ${process.env.SIM_LLM_API_KEY}` } }).catch(() => null);
  const data = res?.ok ? (await res.json().catch(() => null))?.data : null;
  return data ? Number(data.limit_remaining ?? -data.usage) : null;
}

function envFor(showrunnerPort, dataDir) {
  const env = appEnv(showrunnerPort, dataDir);
  delete env.INDEXNOW_KEY; // never ping a search engine from a local run
  for (const k of Object.keys(env)) if (/^(RESEND_|EMAIL_|FRONTIER_LLM_|FRONTIER_DEFAULT|SIM_)/.test(k)) delete env[k];
  env.FRONTIER_PASSWORD = ADMIN_PASSWORD;
  // The sim's couples are fixed pairs of people's characters, studied across five dates. The swipe gate
  // (lib/swipe-gate.ts) would want each pair matched first, and each character decides that for itself, so it's off here.
  env.SWIPE_GATE = "0";
  if (MODEL === "paid") {
    env.LLM_BASE_URL = process.env.SIM_LLM_BASE_URL || GATEWAY;
    env.LLM_API_KEY = process.env.SIM_LLM_API_KEY;
    env.LLM_MODEL = process.env.SIM_MODEL || "anthropic/claude-haiku-5.5";
  }
  return env;
}

/**
 * A handle-and-password account for the persona: an admin is a signed-in account (the 2026-11 security review), so the
 * claim below needs one. Its signed session joins the persona's cookie; the visitor id, and so its characters, stay.
 */
async function signUp(base, who) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: who.cookie, origin: base, "x-forwarded-for": ipFor(who.id) },
    body: JSON.stringify({ handle: `sim${randomBytes(4).toString("hex")}`, password: randomBytes(12).toString("hex"), attest: true }),
  });
  if (!res.ok) throw new Error(`sign up → ${res.status}`);
  const sess = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => c.startsWith("bz_sess="));
  if (!sess.length) throw new Error("sign up set no session cookie");
  who.cookie = [who.cookie, ...sess].join("; ");
}

async function grantDates(base, who) {
  await signUp(base, who);
  must(await post(base, "/api/admin/claim", {}, who, { "x-frontier-key": ADMIN_PASSWORD }), "claim admin");
  must(await post(base, "/api/admin/tokens", {}, who), "grant dates");
}

/** Books date n (1-based): a first date, a second date when both wanted another, else a fresh date between them. */
async function book(base, n, prev, ownerA, ownerB, a, b) {
  if (n === 1) return { how: "first", ep: must(await post(base, "/api/episodes", { character_id: a.id, partner_id: b.id }, ownerA), "first date") };
  const state = (await get(base, `/api/episodes/${prev}/second-date`, ownerA)).data;
  if (!state?.can_plan) {
    return { how: `fresh (${state?.reason ?? "?"})`, ep: must(await post(base, "/api/episodes", { character_id: a.id, partner_id: b.id }, ownerA), "fresh date") };
  }
  // The other owner says yes first; the booking owner's yes then books it (or B's books it when A is open to dates).
  const yesB = must(await post(base, `/api/episodes/${prev}/second-date`, {}, ownerB), "B says yes", [200, 201, 202]);
  if (yesB.id) return { how: "second_date", ep: yesB };
  return { how: "second_date", ep: must(await post(base, `/api/episodes/${prev}/second-date`, {}, ownerA), "A says yes") };
}

async function runPair(index, pair, browser) {
  const dir = join(OUT, `${String(index + 1).padStart(2, "0")}-${pair.label.replace(/[^a-z0-9]+/gi, "_")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "db"), { recursive: true });
  const showrunner = await startShowrunner();
  // One environment for every start of this couple's app (a restart keeps its session secret and admin password).
  const env = envFor(showrunner.address().port, join(dir, "db"));
  let app = await startApp(await freePort(), env);
  let base = app.base;
  const call = client(base);
  const log = { label: pair.label, dates: [], edges: [] };
  console.log(`\n== ${index + 1}. ${pair.label} ==`);
  try {
    const ownerA = persona();
    const ownerB = persona();
    // Accounts first (grantDates signs each owner up), so their characters are made by the account that books the dates.
    await grantDates(base, ownerA);
    await grantDates(base, ownerB);
    const a = await call("/api/characters", { ...pair.a, open_to_dates: true, attest: true, keep_name: true }, ownerA);
    const b = await call("/api/characters", { ...pair.b, open_to_dates: true, attest: true, keep_name: true }, ownerB);

    let prev = null;
    for (let n = 1; n <= DATES; n++) {
      const t0 = Date.now();
      if (LESSONS_AB && n === DATES && n > 1) {
        // What each character has learned by now, as its owner's memory route says it.
        const held = async (who, c) => (await get(base, `/api/characters/${c.id}/memory`, who)).data?.lessons ?? { lines: [] };
        const lessons = { a: { name: pair.a.name, ...(await held(ownerA, a)) }, b: { name: pair.b.name, ...(await held(ownerB, b)) } };
        writeFileSync(join(dir, "lessons.json"), JSON.stringify(lessons, null, 2));
        log.lessons = lessons;
        console.log(`  lessons: ${pair.a.name}: ${JSON.stringify(lessons.a.lines)} · ${pair.b.name}: ${JSON.stringify(lessons.b.lines)}`);
        // The same date from the same history, without them: a copy of the database, the switch off.
        await stopApp(app);
        cpSync(join(dir, "db"), join(dir, "db-without"), { recursive: true });
        const off = await startApp(await freePort(), { ...env, PGLITE_DIR: join(dir, "db-without"), CHARACTER_LESSONS: "0" });
        try {
          const without = await book(off.base, n, prev, ownerA, ownerB, a, b);
          const seen = must(await get(off.base, `/api/episodes/${without.ep.id}`, ownerA), "episode (without lessons)");
          writeFileSync(join(dir, `date-${n}-without-lessons-view.json`), JSON.stringify(seen, null, 2));
          log.without_lessons = { n, episode_id: without.ep.id, booked_as: without.how, ending: seen.ending, transcript_turns: seen.transcript?.length ?? 0 };
          console.log(`  ✓ date ${n} without lessons (${without.how}) ${seen.ending}`);
        } catch (err) {
          console.log(`  ✗ date ${n} without lessons: ${err.message}`);
          log.without_lessons = { n, error: err.message };
        } finally {
          await stopApp(off);
        }
        app = await startApp(await freePort(), env);
        base = app.base;
      }
      let booked;
      try {
        booked = await book(base, n, prev, ownerA, ownerB, a, b);
      } catch (err) {
        console.log(`  ✗ date ${n}: ${err.message}`);
        log.dates.push({ n, error: err.message });
        break;
      }
      const id = booked.ep.id;
      prev = id;
      const view = must(await get(base, `/api/episodes/${id}`, ownerA), "episode");
      if (view.status !== "ready") {
        console.log(`  ✗ date ${n}: status ${view.status}`);
        log.dates.push({ n, episode_id: id, error: `status ${view.status}` });
        break;
      }
      // Air it (as whoever booked it), read the afterglow, run the day's texts.
      for (const who of [ownerA, ownerB]) if ((await post(base, `/api/episodes/${id}/reveal`, {}, who)).status === 200) break;
      const afterglow = (await post(base, `/api/episodes/${id}/afterglow`, {}, ownerA)).data;
      const daily = (await get(base, "/api/jobs/daily?backfill=0", ownerA, { "x-jobs-token": WATCH_ADMIN_TOKEN })).data;
      // The job's lessons step, when it wrote any (lib/character-lessons-job.ts): how, and what the calls cost by the
      // provider's own figure (the key's balance trails a call by longer than a run can wait, so it isn't read for this).
      const l = daily?.character_lessons;
      if (LESSONS_AB && l?.written) {
        log.lessons_step = { after_date: n, ...l };
        console.log(
          `  lessons step: ${l.written} written (${l.by_model} by the model, ${l.by_template} by template), ${l.input_tokens} tokens in / ${l.output_tokens} out` +
            `${l.cost_per_character_usd !== null ? `, ${(l.cost_per_character_usd * 100).toFixed(3)}¢ a character` : ""}`,
        );
      }
      const edge = await relationship(base, ownerA, a.id, b.id);
      const edgeB = await relationship(base, ownerB, a.id, b.id);
      const memA = (await get(base, `/api/characters/${a.id}/memory`, ownerA)).data;
      const memB = (await get(base, `/api/characters/${b.id}/memory`, ownerB)).data;
      // Each one's story state (lib/story-state.ts): what it now thinks of the other, from the date that just aired.
      const storyA = (await get(base, `/api/characters/${a.id}/story`, ownerA)).data;
      const storyB = (await get(base, `/api/characters/${b.id}/story`, ownerB)).data;
      for (const [name, data] of Object.entries({ view, afterglow, edge, edgeB, memA, memB, storyA, storyB, daily })) {
        writeFileSync(join(dir, `date-${n}-${name}.json`), JSON.stringify(data, null, 2));
      }
      const bx = view.box_score ?? {};
      const row = {
        n,
        episode_id: id,
        booked_as: booked.how,
        date_number: view.date_number ?? 1,
        ending: view.ending,
        venue: view.venue,
        wants_another_creator: view.debrief?.wants_another ?? null,
        afterglow_verdict: afterglow?.verdict ?? null,
        box_score: Object.fromEntries(["chemistry", "trust", "attraction", "awkwardness"].map((k) => [k, bx[k] ?? null])),
        transcript_turns: view.transcript?.length ?? 0,
        distinct_lines: new Set((view.transcript ?? []).map((t) => t.dialogue)).size,
        afterglow_turns: afterglow?.thread?.length ?? 0,
        texted_couples: daily?.texts?.couples ?? null,
        ms: Date.now() - t0,
      };
      const e = edge ?? {};
      const summary = {
        after_date: n,
        stage: e.stage ?? null,
        chemistry: e.chemistry ?? null,
        trust: e.trust ?? null,
        tie: e.tie ?? null,
        dates: e.dates ?? 0,
        second_dates: e.second_dates ?? 0,
        dates_seen_by_other_owner: edgeB?.dates ?? 0,
        jokes: e.jokes?.length ?? 0,
        told: Object.values(e.told ?? {}).reduce((s, v) => s + (v?.length ?? 0), 0),
        plans: e.plans?.length ?? 0,
        plans_kept: (e.plans ?? []).filter((p) => p.status === "kept").length,
        texts: e.texts?.length ?? 0,
        labels: (e.timeline ?? []).map((t) => t.ending_label),
        // What each thinks of the other after this date (its own view): trust, attraction, and the date it came from.
        thinks: [storyA, storyB].map((x) => {
          const o = x?.story?.thinks?.[0];
          return o ? { trust: o.trust, attraction: o.attraction, basis: o.basis, from_this_date: o.source === id } : null;
        }),
      };
      log.dates.push(row);
      log.edges.push(summary);
      console.log(
        `  ✓ date ${n} (${booked.how}) ${view.ending} · box chem ${bx.chemistry?.start}→${bx.chemistry?.final} trust ${bx.trust?.start}→${bx.trust?.final}` +
          ` · edge ${summary.stage} chem ${summary.chemistry} trust ${summary.trust} tie ${summary.tie}` +
          ` · told ${summary.told} jokes ${summary.jokes} plans ${summary.plans}/${summary.plans_kept} kept texts ${summary.texts} · ${Math.round(row.ms / 1000)}s`,
      );
    }

    if (browser && prev) {
      const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      for (const [tag, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport });
        await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }, { name: "bz_uid", value: ownerA.id, url: base }]);
        const page = await ctx.newPage();
        await page.goto(`${base}/couples/${lo}/${hi}`, { waitUntil: "networkidle" });
        await page.screenshot({ path: join(dir, `couple-${tag}.png`), fullPage: true });
        await page.goto(`${base}/episodes/${prev}`, { waitUntil: "networkidle" });
        await page.screenshot({ path: join(dir, `last-date-${tag}.png`), fullPage: true });
        await ctx.close();
      }
    }
  } finally {
    writeFileSync(join(dir, "run.json"), JSON.stringify(log, null, 2));
    await stopApp(app);
    showrunner.close();
  }
  return log;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!flag("no-build")) build();
  const picked = PICK === "all" ? PAIRS.map((_, i) => i) : PICK.split(",").map((s) => Number(s) - 1);
  let browser = null;
  if (!flag("no-screens")) {
    if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH (or pass --no-screens); this script never downloads a browser.");
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  }
  const before = await gatewayBalance();
  const results = [];
  try {
    for (const i of picked) {
      try {
        results.push(await runPair(i, PAIRS[i], browser));
      } catch (err) {
        console.log(`  ✗ ${PAIRS[i].label}: ${err.message}`);
        results.push({ label: PAIRS[i].label, error: err.message });
      }
      writeFileSync(join(OUT, "summary.json"), JSON.stringify({ model: MODEL, dates: DATES, results }, null, 2));
    }
  } finally {
    await browser?.close();
  }
  const after = await gatewayBalance();
  const spent = before !== null && after !== null ? Number((before - after).toFixed(4)) : null;
  writeFileSync(join(OUT, "summary.json"), JSON.stringify({ model: MODEL, model_name: MODEL === "paid" ? process.env.SIM_MODEL || "anthropic/claude-haiku-5.5" : "stub", dates: DATES, spent_usd: spent, results }, null, 2));
  const ran = results.reduce((s, r) => s + (r.dates?.filter((d) => !d.error).length ?? 0), 0);
  console.log(`\n${results.length} couples, ${ran} dates${spent !== null ? `, $${spent} spent` : ""}. Output: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
