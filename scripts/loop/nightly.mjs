// Botchelor's self-improving loop, one run (docs/self-improving-loop.md). launchd starts it each morning at 06:10,
// after RepoHQ's last factory cycle (06:00) and before its 09:00 research, and it gives up by LOOP_DEADLINE_MIN.
//
//   1. build origin/main in the loop's own clone (~/.botchelor-loop/repo; launchd can't read ~/Documents);
//   2. a local Botchelor on a throwaway database, the date model capped, plus a seeded agent that swipes back;
//   3. a few uninstructed visitors (claude -p, on the subscription) explore it and report;
//   4. triage (claude -p) turns their feedback, and real agents' feedback from botchelor.com, into GitHub issues;
//   5. one fixer (claude -p) works the top issues: a PR each, merged once every check is green.
// One run at a time (a lock), events to the system log, and a summary under ~/.botchelor-loop/runs/<date>/.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const HOME_DIR = process.env.LOOP_HOME || join(homedir(), ".botchelor-loop");
const env = (k, d) => process.env[k] ?? d;
const VISITORS = Number(env("LOOP_VISITORS", "2"));
const VISITOR_MINUTES = Number(env("LOOP_VISITOR_MINUTES", "30"));
const MAX_ISSUES = Number(env("LOOP_MAX_ISSUES", "5"));
const MAX_FIXES = Number(env("LOOP_MAX_FIXES", "3"));
const FIX = env("LOOP_FIX", "1") !== "0";
const DEADLINE = Date.now() + Number(env("LOOP_DEADLINE_MIN", "160")) * 60_000; // 06:10 + 2h40 = 08:50
const VISITOR_MODEL = env("LOOP_VISITOR_MODEL", "sonnet");
const TRIAGE_MODEL = env("LOOP_TRIAGE_MODEL", "sonnet");
const FIX_MODEL = env("LOOP_FIX_MODEL", "opus");
const PORT = Number(env("LOOP_PORT", "4420"));
const day = new Date().toISOString().slice(0, 10);
const RUN = join(HOME_DIR, "runs", day);
const STATE = join(HOME_DIR, "state.json");
const LOCK = join(HOME_DIR, "lock");

const log = (...a) => console.log(new Date().toISOString(), ...a);
const emit = (event, status, message) => {
  try {
    execFileSync(join(homedir(), "ai-stack/bin/emit-event"), ["botchelor", "loop", event, status, message], { stdio: "ignore" });
  } catch {
    /* the system log is best-effort */
  }
};
const keychain = (name) => execFileSync("security", ["find-generic-password", "-s", name, "-w"], { encoding: "utf8" }).trim();
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

/** Claude Code headless, on the subscription: ANTHROPIC_API_KEY stripped so it can never fall back to API credit. */
function claude(prompt, { cwd, model, tools, timeoutMin, out }) {
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  const args = ["-p", prompt, "--model", model, "--output-format", "text"];
  if (tools === "all") args.push("--dangerously-skip-permissions");
  else args.push("--permission-mode", "acceptEdits", "--allowedTools", ...tools);
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), Math.min(timeoutMin * 60_000, Math.max(60_000, DEADLINE - Date.now())));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (out) writeFileSync(out, text);
      resolve({ code, text });
    });
  });
}

function startProcess(script, args, extraEnv, onLine) {
  const child = spawn(process.execPath, [join(HERE, script), ...args], { cwd: REPO, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => String(d).split("\n").forEach((l) => l && onLine?.(l)));
  child.stderr.on("data", (d) => String(d).split("\n").forEach((l) => l && log(`[${script}]`, l)));
  return child;
}

async function credits(key) {
  try {
    const r = await fetch("https://ai-gateway.vercel.sh/v1/credits", { headers: { authorization: `Bearer ${key}` } });
    return Number((await r.json()).balance);
  } catch {
    return NaN;
  }
}

async function feedbackFrom(base, password, since) {
  try {
    const r = await fetch(`${base}/api/admin/feedback`, { headers: { "x-frontier-key": password } });
    if (!r.ok) return [];
    const rows = (await r.json()).feedback ?? [];
    return rows.filter((f) => !since || f.created_at > since);
  } catch {
    return [];
  }
}

async function main() {
  mkdirSync(RUN, { recursive: true });
  if (existsSync(LOCK)) {
    const age = Date.now() - Number(readFileSync(LOCK, "utf8").split(" ")[1] || 0);
    if (age < 6 * 3_600_000) return log("another run holds the lock; skipping");
  }
  writeFileSync(LOCK, `${process.pid} ${Date.now()}`);
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
  const summary = { day, started_at: new Date().toISOString() };
  emit("run_started", "info", `visitors=${VISITORS} fix=${FIX}`);
  let arena, agent;
  try {
    // 1. A clean build of main.
    sh("git", ["fetch", "-q", "origin"]);
    sh("git", ["checkout", "-q", "--detach", "origin/main"]);
    const sha = sh("git", ["rev-parse", "HEAD"]).trim();
    summary.sha = sha;
    if (state.built_sha !== sha) {
      sh("npm", ["ci", "--silent"], { stdio: "ignore" });
      sh("npx", ["next", "build"], { stdio: "ignore" });
      state.built_sha = sha;
    }

    const gatewayKey = keychain("vault/botchelor/FRONTIER_LLM_API_KEY");
    const before = await credits(gatewayKey);
    const arenaPassword = randomBytes(18).toString("hex");

    // 2. The arena and the agent that swipes back.
    if (VISITORS > 0) {
      let base = null;
      arena = startProcess("arena.mjs", [join(RUN, "arena"), String(PORT)], { LOOP_LLM_API_KEY: gatewayKey, LOOP_ADMIN_PASSWORD: arenaPassword }, (l) => {
        if (l.startsWith("READY ")) base = l.slice(6).trim();
      });
      for (let i = 0; i < 400 && !base; i++) await new Promise((r) => setTimeout(r, 500));
      if (!base) throw new Error("arena never came up");
      agent = startProcess("swipe-back-agent.mjs", [base, String((VISITOR_MINUTES + 15) * 60)], { LOOP_LLM_API_KEY: gatewayKey }, (l) => log("[agent]", l));

      // 3. The visitors, side by side, each in its own folder.
      const brief = readFileSync(join(HERE, "visitor-brief.md"), "utf8");
      const runs = [];
      for (let i = 0; i < VISITORS; i++) {
        const dir = join(RUN, `visitor-${i + 1}`);
        mkdirSync(dir, { recursive: true });
        const prompt = brief.replaceAll("{{BASE}}", base).replaceAll("{{DIR}}", dir).replaceAll("{{MINUTES}}", String(VISITOR_MINUTES));
        runs.push(
          claude(prompt, {
            cwd: dir,
            model: VISITOR_MODEL,
            tools: ["Read", "Write", "Edit", "Bash(curl:*)", "Bash(python3:*)", "Bash(node:*)", "Bash(jq:*)", "Bash(cat:*)", "Bash(ls:*)", "Bash(sleep:*)", "Bash(mkdir:*)"],
            timeoutMin: VISITOR_MINUTES + 20,
            out: join(RUN, `visitor-${i + 1}.md`),
          }),
        );
      }
      await Promise.all(runs);
      summary.visitors = VISITORS;
      const local = await feedbackFrom(base, arenaPassword, null);
      writeFileSync(join(RUN, "feedback-local.json"), JSON.stringify(local, null, 2));
      summary.feedback_local = local.length;
    }
    agent?.kill("SIGTERM");
    arena?.kill("SIGTERM");
    summary.model_spend_usd = Math.round(((before - (await credits(gatewayKey))) || 0) * 10000) / 10000;

    // 4. Triage: tonight's feedback plus real agents' on botchelor.com since the last run.
    let live = [];
    try {
      live = await feedbackFrom("https://botchelor.com", keychain("vault/botchelor/FRONTIER_PASSWORD"), state.last_live_feedback_at ?? null);
    } catch {
      /* no password: local feedback only */
    }
    writeFileSync(join(RUN, "feedback-live.json"), JSON.stringify(live, null, 2));
    summary.feedback_live = live.length;
    const newest = live.map((f) => f.created_at).sort().at(-1);
    const reports = Array.from({ length: VISITORS }, (_, i) => join(RUN, `visitor-${i + 1}.md`)).filter(existsSync);
    if (summary.feedback_local || live.length || reports.length) {
      const triage = readFileSync(join(HERE, "triage-prompt.md"), "utf8")
        .replaceAll("{{FEEDBACK}}", `${join(RUN, "feedback-local.json")} and ${join(RUN, "feedback-live.json")}`)
        .replaceAll("{{REPORTS}}", reports.join(", ") || "(none)")
        .replaceAll("{{MAX_ISSUES}}", String(MAX_ISSUES))
        .replaceAll("{{OUT}}", join(RUN, "triage.md"));
      await claude(triage, {
        cwd: REPO,
        model: TRIAGE_MODEL,
        tools: ["Read", "Grep", "Glob", `Write(${RUN}/**)`, "Bash(gh issue:*)", "Bash(gh label:*)", "Bash(git log:*)", "Bash(git show:*)"],
        timeoutMin: 25,
        out: join(RUN, "triage.log"),
      });
    }
    if (newest) state.last_live_feedback_at = newest;

    // 5. One fixer.
    if (FIX && Date.now() < DEADLINE - 20 * 60_000) {
      const fix = readFileSync(join(HERE, "fix-prompt.md"), "utf8").replaceAll("{{MAX_FIXES}}", String(MAX_FIXES)).replaceAll("{{OUT}}", join(RUN, "fixes.md"));
      await claude(fix, { cwd: REPO, model: FIX_MODEL, tools: "all", timeoutMin: Math.floor((DEADLINE - Date.now()) / 60_000), out: join(RUN, "fix.log") });
      sh("git", ["checkout", "-q", "--detach", "origin/main"]);
    }
    summary.finished_at = new Date().toISOString();
    emit("run_finished", "ok", `visitors=${summary.visitors ?? 0} feedback=${(summary.feedback_local ?? 0) + summary.feedback_live} spend=$${summary.model_spend_usd}`);
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    emit("run_failed", "fail", summary.error);
  } finally {
    agent?.kill("SIGTERM");
    arena?.kill("SIGTERM");
    writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(STATE, JSON.stringify(state, null, 2));
    rmSync(join(RUN, "arena", "db"), { recursive: true, force: true }); // the throwaway database
    rmSync(LOCK, { force: true });
  }
}

await main();
