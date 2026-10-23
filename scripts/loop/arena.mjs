// The loop's local Botchelor (docs/self-improving-loop.md): the production build, the real (paid, capped) date model,
// a cast of people-made characters, and a crowd of background agents (crowd.mjs), on a throwaway database. Prints
// READY <base> and runs until SIGTERM.
//   node scripts/loop/arena.mjs <outDir> <port>     (needs LOOP_LLM_API_KEY: the gateway key, read from the keychain)
//   LOOP_STUB=1 node scripts/loop/arena.mjs <outDir> <port>     (no key, nothing paid: the stub date model, for a check)
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { appEnv, client, persona, ROOT, startShowrunner } from "../harness.mjs";
import { PAIRS } from "../sim-pairs.mjs";
import { brainFromEnv, CROWD, httpTransport, runCrowd, seedCrowd } from "./crowd.mjs";

const [out, portArg] = process.argv.slice(2);
const port = Number(portArg || 4420);
if (!out) throw new Error("usage: arena.mjs <outDir> <port>");
// LOOP_STUB=1: the harness's stub showrunner plays the date model (canned lines, $0), for checking the arena itself.
const STUB = process.env.LOOP_STUB === "1";
if (!STUB && !process.env.LOOP_LLM_API_KEY) throw new Error("LOOP_LLM_API_KEY needed (or LOOP_STUB=1)");
const num = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : Number(process.env[k]));
const SEED_DATES = num("LOOP_SEED_DATES", 5);
const CROWD_AGENTS = num("LOOP_CROWD_AGENTS", CROWD.length);
// A two-agent date's recap runs on the date model, so the crowd only asks visitors out itself when that's free.
const CROWD_BOOKS = num("LOOP_CROWD_BOOKS", STUB ? 3 : 0);
// When the seeded public dates air, in minutes after READY: spread over the visit, so a visitor's picks are scored
// while it's here.
const REVEALS = String(process.env.LOOP_REVEAL_MINUTES || "4,10,18").split(",").map(Number).filter((n) => n > 0);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "db"), { recursive: true });

const stub = STUB ? await startShowrunner() : null;
const env = appEnv(stub ? stub.address().port : 0, join(out, "db"));
// Links the server hands out (link_account, the agent guides) point at this arena, not at localhost:3000.
env.SITE_URL = `http://127.0.0.1:${port}`;
// A visit lasts 20 to 30 minutes: public dates air after 5 (not 10), so a visitor sees its predictions scored.
env.BOTCHELOR_AIR_WINDOW_MINUTES = process.env.LOOP_AIR_WINDOW_MINUTES || "5";
// Nothing leaves the machine but date-model calls: no email, no IndexNow, no frontier keys.
for (const k of Object.keys(env)) if (/^(INDEXNOW_KEY|RESEND_|EMAIL_|FRONTIER_LLM_|FRONTIER_DEFAULT|SIM_)/.test(k)) delete env[k];
Object.assign(env, {
  ...(STUB
    ? {}
    : {
        LLM_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        LLM_API_KEY: process.env.LOOP_LLM_API_KEY,
        LLM_MODEL: process.env.LOOP_LLM_MODEL || "anthropic/claude-haiku-5.5",
      }),
  BOTCHELOR_AGENT_DAILY_DATES: process.env.LOOP_AGENT_DATES || "12", // a hard ceiling on our-model dates per run
  // So the loop can read the visitors' feedback back (/api/admin/feedback): a throwaway password for a throwaway server.
  FRONTIER_PASSWORD: process.env.LOOP_ADMIN_PASSWORD || "",
});
delete env.BOTCHELOR_INLINE_GENERATION; // like production: dates generate in the background

// Something already answering on the port is another arena (the nightly loop's, on the paid date model): seeding
// and auditing into it by mistake cost real dates on 2026-10-21. Refuse rather than share it.
if (await fetch(`http://127.0.0.1:${port}/legal`).then(() => true, () => false)) {
  console.error(`arena: port ${port} is already in use by another server; pick a free port`);
  process.exit(2);
}
const log = createWriteStream(join(out, "server.log"));
const child = spawn(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log);
child.stderr.pipe(log);
const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 200 && !up; i++) {
  // Our own server must still be running: if it died (EADDRINUSE, a bad build), nothing here is ours to seed.
  if (child.exitCode !== null) {
    console.error(`arena: next start exited with code ${child.exitCode}; see ${join(out, "server.log")}`);
    process.exit(2);
  }
  try { up = (await fetch(`${base}/legal`)).ok; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 300));
}
if (!up) {
  console.error(`arena: the app never answered on ${base}`);
  child.kill("SIGTERM");
  process.exit(2);
}
const call = client(base);
const made = [];
for (const pair of PAIRS.slice(0, 9)) {
  const ids = [];
  for (const c of [pair.a, pair.b]) {
    const who = persona();
    const r = await call("/api/characters", { ...c, open_to_dates: true, attest: true, keep_name: true }, who);
    ids.push({ id: r.id, who });
  }
  made.push(ids);
}
// #343 (David, 2026-10-19: seed it): a fresh arena had an empty feed, so a visitor had nothing to predict and an empty
// leaderboard. Five public blind dates for the cast (LOOP_SEED_DATES), booked as their people and written BEFORE the
// visitors arrive (seeding after READY left them "still being written"). One airs at once (the record and the
// leaderboard); the rest stay open to predict and air in stages over the visit (LOOP_REVEAL_MINUTES). Five date-model calls.
const booked = [];
for (const [a] of made.slice(0, SEED_DATES)) {
  // Blind dates (the show picks a house partner): no match needed, whatever the swipe gate says.
  const r = await call("/api/episodes", { character_id: a.id, blind: true, visibility: "public" }, a.who, [200, 201]).catch(() => null);
  if (r?.id) booked.push({ id: r.id, who: a.who });
}
// David, 2026-10-20 ("busier, longer sims"): visitors said the world felt empty. The crowd (crowd.mjs) is house-run
// bots, each with its own client name and personality, already mid-season when visitors connect: finished dates,
// second dates under way, matches and texts waiting. Seeded while the blind dates are written. Its lines and texts come
// from a free local model on this Mac (the ai-stack's LiteLLM, verified local with no fallbacks), or from its script
// when that's off: LOOP_STUB=1, or LiteLLM not answering within 2 seconds. It never calls the show's model.
const crowdLog = (m) => console.error(`crowd ${m}`);
const brain = CROWD_AGENTS > 0 ? await brainFromEnv(process.env, { log: crowdLog }) : null;
const crowd =
  CROWD_AGENTS > 0
    ? await seedCrowd(httpTransport(base), { agents: CROWD_AGENTS, log: crowdLog, brain, seedBudgetMs: num("LOOP_CROWD_SEED_SECONDS", 240) * 1000 }).catch(
        (e) => (crowdLog(`seeding failed: ${e.message}`), null),
      )
    : null;
for (let i = 0; i < 60 && booked.length; i++) {
  const states = await Promise.all(booked.map((e) => fetch(`${base}/api/episodes/${e.id}`, { headers: { cookie: e.who.cookie } }).then((x) => x.json()).catch(() => ({}))));
  if (states.every((st) => st.status === "ready")) break;
  await new Promise((r) => setTimeout(r, 5000));
}
if (booked[0]) await call(`/api/episodes/${booked[0].id}/reveal`, {}, booked[0].who, [200, 201, 409]).catch(() => null);
const world = { blind_dates: booked.length, people_characters: made.length * 2, ...(crowd?.world ?? {}), crowd_books: CROWD_BOOKS, stub: STUB };
// crowd_brain: which path the crowd's replies took (model or script) and why, so a quiet fallback to the script can't
// pass for "visitors still call it canned". world.json has it as at READY and is rewritten with the latest counts as
// the run goes; crowd.json beside it has the same block with the crowd's activity, every minute and when the arena stops.
const writeCrowd = (stats) => {
  if (!brain) return;
  world.crowd_brain = brain.summary();
  try {
    writeFileSync(join(out, "world.json"), JSON.stringify(world, null, 2));
    writeFileSync(join(out, "crowd.json"), JSON.stringify({ crowd_brain: world.crowd_brain, stats: stats ?? null, updated_at: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.error(`crowd: couldn't write crowd.json: ${e.message}`);
  }
};
writeFileSync(join(out, "world.json"), JSON.stringify(world, null, 2));
writeCrowd(null);
console.log(`READY ${base}`);
console.error(`SEEDED ${booked.length} dates; world ${JSON.stringify(world)}`);
// The crowd stays busy for as long as the arena runs: likes, answers, texts and its side of dates.
const busy = crowd ? runCrowd(crowd.agents, { books: CROWD_BOOKS, log: crowdLog }) : null;
const crowdTimer = brain ? setInterval(() => writeCrowd(busy?.stats), 60_000) : null;
(async () => {
  const rest = booked.slice(1);
  const per = Math.ceil(rest.length / Math.max(1, REVEALS.length));
  let before = 0;
  for (const [i, at] of REVEALS.entries()) {
    const batch = rest.slice(i * per, (i + 1) * per);
    if (!batch.length) break;
    await new Promise((r) => setTimeout(r, (at - before) * 60_000));
    before = at;
    for (const e of batch) await call(`/api/episodes/${e.id}/reveal`, {}, e.who, [200, 201, 409]).catch(() => null);
    console.error(`SEEDED ${batch.length} aired at ${at} minutes`);
  }
})();
const stop = () => {
  busy?.stop();
  if (crowdTimer) clearInterval(crowdTimer);
  writeCrowd(busy?.stats);
  if (busy) console.error(`crowd stats ${JSON.stringify(busy.stats)}; brain ${JSON.stringify(brain?.summary())}`);
  stub?.close();
  child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
