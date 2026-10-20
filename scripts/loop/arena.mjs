// The loop's local Botchelor (docs/self-improving-loop.md): the production build, the real (paid, capped) date model,
// and a cast of people-made characters, on a throwaway database. Prints READY <base> and runs until SIGTERM.
//   node scripts/loop/arena.mjs <outDir> <port>     (needs LOOP_LLM_API_KEY: the gateway key, read from the keychain)
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { appEnv, client, persona, ROOT } from "../harness.mjs";
import { PAIRS } from "../sim-pairs.mjs";

const [out, portArg] = process.argv.slice(2);
const port = Number(portArg || 4420);
if (!out) throw new Error("usage: arena.mjs <outDir> <port>");
if (!process.env.LOOP_LLM_API_KEY) throw new Error("LOOP_LLM_API_KEY needed");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "db"), { recursive: true });

const env = appEnv(0, join(out, "db"));
// Links the server hands out (link_account, the agent guides) point at this arena, not at localhost:3000.
env.SITE_URL = `http://127.0.0.1:${port}`;
// A visit lasts about 30 minutes: public dates air after 5 (not 10), so a visitor sees its predictions scored.
env.BOTCHELOR_AIR_WINDOW_MINUTES = process.env.LOOP_AIR_WINDOW_MINUTES || "5";
// Nothing leaves the machine but date-model calls: no email, no IndexNow, no frontier keys.
for (const k of Object.keys(env)) if (/^(INDEXNOW_KEY|RESEND_|EMAIL_|FRONTIER_LLM_|FRONTIER_DEFAULT|SIM_)/.test(k)) delete env[k];
Object.assign(env, {
  LLM_BASE_URL: "https://ai-gateway.vercel.sh/v1",
  LLM_API_KEY: process.env.LOOP_LLM_API_KEY,
  LLM_MODEL: process.env.LOOP_LLM_MODEL || "anthropic/claude-haiku-5.5",
  BOTCHELOR_AGENT_DAILY_DATES: process.env.LOOP_AGENT_DATES || "12", // a hard ceiling on our-model dates per run
  // So the loop can read the visitors' feedback back (/api/admin/feedback): a throwaway password for a throwaway server.
  FRONTIER_PASSWORD: process.env.LOOP_ADMIN_PASSWORD || "",
});
delete env.BOTCHELOR_INLINE_GENERATION; // like production: dates generate in the background

const log = createWriteStream(join(out, "server.log"));
const child = spawn(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log);
child.stderr.pipe(log);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`${base}/legal`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
const call = client(base);
const made = [];
for (const pair of PAIRS.slice(0, 9)) {
  const ids = [];
  for (const c of [pair.a, pair.b]) {
    const who = persona();
    const r = await call("/api/characters", { ...c, open_to_dates: true, attest: true }, who);
    ids.push({ id: r.id, who });
  }
  made.push(ids);
}
console.log(`READY ${base}`);

// #343 (David, 2026-10-19: seed it): a fresh arena had an empty feed, so a visitor had nothing to predict and an empty
// leaderboard. Three public blind dates for the cast, booked as their people: once written, one airs (the record and the
// leaderboard) and two stay open to predict. In the background, so the visitors aren't held up; three date-model calls.
(async () => {
  const booked = [];
  // Blind dates (the show picks a house partner): no match needed, whatever the swipe gate says.
  for (const [a] of made.slice(0, 3)) {
    const r = await call("/api/episodes", { character_id: a.id, blind: true, visibility: "public" }, a.who, [200, 201]).catch(() => null);
    if (r?.id) booked.push({ id: r.id, who: a.who });
  }
  for (let i = 0; i < 120 && booked.length; i++) {
    const states = await Promise.all(booked.map((e) => fetch(`${base}/api/episodes/${e.id}`, { headers: { cookie: e.who.cookie } }).then((x) => x.json()).catch(() => ({}))));
    if (states.every((st) => st.status === "ready")) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (booked[0]) await call(`/api/episodes/${booked[0].id}/reveal`, {}, booked[0].who, [200, 201, 409]).catch(() => null);
  console.log(`SEEDED ${booked.length} dates`);
  // The two left open air about 12 minutes in, so the predictions visitors make on them are scored while they're here.
  await new Promise((r) => setTimeout(r, 12 * 60_000));
  for (const e of booked.slice(1)) await call(`/api/episodes/${e.id}/reveal`, {}, e.who, [200, 201, 409]).catch(() => null);
  console.log("SEEDED dates aired");
})();
const stop = () => { child.kill("SIGTERM"); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
