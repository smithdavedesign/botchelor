#!/usr/bin/env node
/**
 * npm run screenshots:moves — visual proof of mid-date moves (lib/moves.ts). Builds the app, starts it on a throwaway
 * local database, and drives a real self-performed date over MCP whose two characters agree, mid-date, to go back to
 * one of their places (the marquee "come back to mine?" case). It plays through the real pipeline — the move is settled
 * by my code, not faked — then airs it and screenshots the episode theater (the scene changes to the home backdrop) and
 * the recorded thread (the "📍 They head to …" divider), desktop and iPhone, into docs/screenshots/.
 *
 * No real infrastructure or model: a solo own-date supplies every line itself (both souls are the agent's), so no key
 * is needed. Chromium comes from CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "move-screenshots");

/** One MCP client against the local app, keeping its session id. */
function mcp(base) {
  let session = null, id = 0;
  async function rpc(method, params) {
    const res = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    session = res.headers.get("mcp-session-id") ?? session;
    const text = await res.text();
    const json = JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:")).slice(5) : text);
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.result;
  }
  return {
    init: () => rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-move-screenshots" } }),
    call: async (name, args) => {
      const r = await rpc("tools/call", { name, arguments: args });
      if (r.isError) throw new Error(r.content?.[0]?.text ?? "tool error");
      return r.structuredContent;
    },
  };
}

const sheet = (name, bio, traits, want) => ({ name, age: 32, bio, traits, want, dealbreaker: "someone who won't try anything new", attest: true });
const CHUD = sheet("Chud Marlo", "A bridge engineer who treats every meal as a structural problem.", ["playful", "bold", "warm"], "Someone who'll follow a good idea anywhere");
const NELL = sheet("Nell Abiodun", "A museum conservator who measures everything twice and laughs once.", ["precise", "dry", "curious"], "Someone who makes the careful thing feel reckless");

/** Clean, distinct lines; the move is proposed/accepted at the right beats (no repetition for the critic to chew on). */
const LINES = [
  "You look like someone who reads the plaques at museums out of order.",
  "Only to annoy the people reading them in order. Guilty.",
  "A woman after my own blueprint. What dragged you out tonight?",
  "Curiosity, and a friend who bet I wouldn't. What about you?",
  "Same bet, different friend. We should introduce them and charge admission.",
  "They'd argue over the ticket pricing for a week.",
  "Honestly? It's loud here. Come back to mine — I'll cook, you judge the structural integrity of my shelves.",
  "Lead the way. I've been told my shelf critiques are devastating.",
  "The kitchen's this way. Mind the one cupboard that opens like it has opinions.",
  "Every good kitchen has one dramatic cupboard. It's the law.",
  "Taste this and tell me it isn't the best thing a bridge engineer has ever burned.",
  "It's… alarmingly good. I may have to revise my whole theory of you.",
  "Revise away. I like being a work in progress.",
  "Then we're well matched. I restore things that were nearly lost.",
  "Keep talking like that and I'll never let you leave this kitchen.",
  "Good. The shelves and I have decided you're staying for dessert.",
];
const step = (i, extra = {}) => ({ dialogue: LINES[i % LINES.length], action: "", emotion: "warm", interest_signal: 0.65, ...extra });
const recap = {
  setting: "A rooftop bar at golden hour, before they slipped away to one of their kitchens.",
  goals: ["Chud wants someone who'll follow a good idea anywhere.", "Nell wants the careful thing to feel reckless."],
  scenes: [
    "They meet at the rooftop bar and trade museum confessions over the city going gold.",
    "It gets loud, so Chud suggests going back to his place to cook — and Nell says yes.",
    "In his kitchen they taste something alarmingly good and decide the night isn't nearly over.",
  ],
  twist: "The dramatic cupboard swings open on cue, like it approves.",
  finale: "They stay for dessert, neither in any hurry to leave the kitchen.",
  best_line: "Keep talking like that and I'll never let you leave this kitchen.",
  confessionals: ["I suggested my place and I'm so glad she came.", "I followed him home and revised my whole theory of him."],
};

async function playMovingDate(base) {
  const a = mcp(base);
  await a.init();
  const x = (await a.call("create_character", CHUD)).character.id;
  const y = (await a.call("create_character", { ...NELL, agent_id: undefined })).character.id;
  let s = (await a.call("start_own_date", { character_id: x, partner_id: y, visibility: "public" })).step;
  const episodeId = s.episode_id;
  let i = 0, moved = false, guard = 0;
  while (s.stage === "turn" && guard++ < 60) {
    let out;
    if (s.answer_their_suggestion) out = step(i, { dialogue: "Lead the way. I've been told my shelf critiques are devastating.", accept_move: true });
    else if (!moved && s.act_index >= 1 && s.where && !/place$/.test(s.where)) { out = step(6, { dialogue: LINES[6], move: "my place" }); moved = true; }
    else out = step(i);
    i++;
    s = (await a.call("submit_own_date_step", { episode_id: episodeId, output: out })).step;
  }
  if (s.stage === "recap") s = (await a.call("submit_own_date_step", { episode_id: episodeId, output: recap })).step;
  await a.call("air_date", { episode_id: episodeId });
  return episodeId;
}

async function shoot(base, episodeId) {
  const { chromium, devices } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const [label, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["mobile", devices["iPhone 13"]]]) {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await page.goto(`${base}/episodes/${episodeId}`, { waitUntil: "networkidle" });
      // The recorded thread, with the move divider.
      const divider = page.getByText(/They head to/i).first();
      await divider.scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: join(OUT_DIR, `move-thread-${label}.png`), fullPage: true });
      // The cinematic theater: play it a little so the scene has reached the new place.
      const watch = page.getByRole("button", { name: /Watch in theater/i });
      if (await watch.count()) {
        await watch.first().click();
        await page.locator(".theater").waitFor();
        await page.getByRole("button", { name: /Skip to the end/i }).click().catch(() => {});
        await page.waitForTimeout(1200);
        await page.screenshot({ path: join(OUT_DIR, `move-theater-${label}.png`) });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("set CHROMIUM_PATH to a Chrome/Chromium binary");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  build();
  const showrunner = await startShowrunner();
  const port = await freePort();
  const app = await startApp(port, { ...appEnv(showrunner.address().port, DATA_DIR), SWIPE_GATE: "0" });
  try {
    const episodeId = await playMovingDate(app.base);
    console.log("moved date:", episodeId);
    await shoot(app.base, episodeId);
    console.log("screenshots written to docs/screenshots/move-*.png");
  } finally {
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
