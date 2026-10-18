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
for (const pair of PAIRS.slice(0, 9)) for (const c of [pair.a, pair.b]) await call("/api/characters", { ...c, open_to_dates: true, attest: true }, persona());
console.log(`READY ${base}`);
const stop = () => { child.kill("SIGTERM"); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
