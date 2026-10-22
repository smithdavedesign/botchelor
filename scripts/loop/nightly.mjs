// Botchelor's self-improving loop, one run (docs/self-improving-loop.md). launchd starts it each morning at 06:10,
// after RepoHQ's last factory cycle (06:00) and before its 09:00 research, and it gives up by LOOP_DEADLINE_MIN.
//
//   1. build origin/main in the loop's own clone (~/.botchelor-loop/repo; launchd can't read ~/Documents);
//   2. a local Botchelor on a throwaway database, the date model capped, a scripted crowd of background agents
//      (crowd.mjs, free), plus a seeded agent that swipes back;
//   3. a few uninstructed visitors (claude -p, on the subscription) explore it for 20 to 30 minutes and report;
//   4. triage (claude -p) turns their feedback, and real agents' feedback from botchelor.com, into GitHub issues;
//   5. one fixer (claude -p) works the top issues: a PR each, merged once every check is green;
//   then the visitors' ratings go to botchelor.com for /admin/analytics (post-ratings.mjs).
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
// David, 2026-10-20 ("busier, longer sims"): visitors used to wrap up after 5 to 10 minutes. One that writes its report
// before this many minutes is asked to carry on (VISITOR_NUDGES times at most), in the same conversation.
const VISITOR_MIN_MINUTES = Math.min(VISITOR_MINUTES, Number(env("LOOP_VISITOR_MIN_MINUTES", "20")));
const VISITOR_NUDGES = Number(env("LOOP_VISITOR_NUDGES", "3"));
const MAX_ISSUES = Number(env("LOOP_MAX_ISSUES", "5"));
const MAX_FIXES = Number(env("LOOP_MAX_FIXES", "3"));
const FIX = env("LOOP_FIX", "1") !== "0";
const DEADLINE = Date.now() + Number(env("LOOP_DEADLINE_MIN", "160")) * 60_000; // 06:10 + 2h40 = 08:50
const VISITOR_MODEL = env("LOOP_VISITOR_MODEL", "sonnet");
const TRIAGE_MODEL = env("LOOP_TRIAGE_MODEL", "sonnet");
const FIX_MODEL = env("LOOP_FIX_MODEL", "opus");
const PORT = Number(env("LOOP_PORT", "4420"));
// Local date and time: an on-demand run and the morning one get their own folders.
const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const day = stamp.slice(0, 10);
const RUN = join(HOME_DIR, "runs", stamp);
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

/**
 * Claude Code headless, on the subscription: ANTHROPIC_API_KEY stripped so it can never fall back to API credit.
 * resume: carry on the most recent conversation in `cwd` (claude --continue) instead of starting a new one.
 */
function claude(prompt, { cwd, model, tools, timeoutMin, out, resume = false }) {
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  const args = ["-p", prompt, ...(resume ? ["--continue"] : []), "--model", model, "--output-format", "text"];
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

/**
 * Which path the crowd's replies took tonight (scripts/loop/crowd.mjs, #544): the model, or the scripted fallback, and
 * why. In the summary, so a quiet fallback can't read as "visitors still call the crowd canned".
 */
function crowdBrain() {
  try {
    return JSON.parse(readFileSync(join(RUN, "arena", "crowd.json"), "utf8")).crowd_brain ?? undefined;
  } catch {
    return undefined; // no crowd file (an older arena, or it never came up)
  }
}

async function feedbackFrom(base, password, since) {
  try {
    const r = await fetch(`${base}/api/admin/feedback`, { headers: { "x-frontier-key": password } });
    if (!r.ok) return [];
    const rows = (await r.json()).feedback ?? [];
    // The loop's own visitors' feedback is posted to botchelor.com too (below); it was triaged the night it came in.
    // Hidden from the board by the owner: not triaged either.
    // Imported feedback (POST /api/admin/feedback: the loop's own and hand-run visitor tests, no session) isn't live.
    return rows.filter((f) => (!since || f.created_at > since) && !(f.session_id === null && /^(loop |visitor run )/.test(String(f.client_name ?? ""))) && !f.hidden_at);
  } catch {
    return [];
  }
}

/** Days without any activity (a fix, a comment with new evidence) before an agent-feedback issue is closed as stale. */
const STALE_DAYS = Number(env("LOOP_STALE_DAYS", "14"));
/** #team-agents, where the system log's alerts go (RepoHQ factory.config.json alerts.slackChannel). */
const SLACK_CHANNEL = env("LOOP_SLACK_CHANNEL", "C0C85QYP4MN");

const ghJson = (args) => JSON.parse(sh("gh", args));

/**
 * Closes agent-feedback issues nobody has touched in STALE_DAYS (not needs-david, not in-progress: those wait on a
 * person), and once a day posts the open needs-david issues to #team-agents so a decision doesn't sit unseen.
 */
async function housekeeping(state) {
  const open = ghJson(["issue", "list", "--label", "agent-feedback", "--state", "open", "--limit", "200", "--json", "number,title,updatedAt,labels,url"]);
  const has = (i, name) => i.labels.some((l) => l.name === name);
  const cutoff = Date.now() - STALE_DAYS * 86_400_000;
  let closed = 0;
  for (const i of open) {
    if (has(i, "needs-david") || has(i, "in-progress") || new Date(i.updatedAt).getTime() > cutoff) continue;
    sh("gh", [
      "issue", "close", String(i.number), "--reason", "not planned", "--comment",
      `Closed by the self-improving loop: no new evidence or activity in ${STALE_DAYS} days. If agents hit this again, triage opens it afresh.`,
    ]);
    closed++;
  }
  const waiting = open.filter((i) => has(i, "needs-david"));
  let nudged = false;
  if (waiting.length && state.last_nudge_day !== day) {
    const text =
      `🙋 *Botchelor: ${waiting.length} agent-feedback decision${waiting.length === 1 ? "" : "s"} waiting on David* (the loop's fixer leaves these alone)\n` +
      waiting.map((i) => `• <${i.url}|#${i.number}> ${i.title}`).join("\n");
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${keychain("system-events-slack-token")}` },
        body: JSON.stringify({ channel: SLACK_CHANNEL, text, unfurl_links: false }),
      });
      nudged = Boolean((await res.json()).ok);
    } catch {
      nudged = false;
    }
    if (nudged) state.last_nudge_day = day;
  }
  return { stale_closed: closed, needs_david: waiting.length, nudged };
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
    // LOOP_NO_CHECKOUT=1 tests the code as it stands in this folder (a branch before it merges), not origin/main.
    if (env("LOOP_NO_CHECKOUT", "0") !== "1") {
      sh("git", ["fetch", "-q", "origin"]);
      sh("git", ["checkout", "-q", "--detach", "origin/main"]);
    }
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
      // The arena writes its sample dates and seeds the crowd before READY (up to ~5 minutes), so allow 10.
      for (let i = 0; i < 1200 && !base; i++) await new Promise((r) => setTimeout(r, 500));
      if (!base) throw new Error("arena never came up");
      try {
        summary.world = JSON.parse(readFileSync(join(RUN, "arena", "world.json"), "utf8")); // what the visitors walked into
      } catch {
        /* an older arena writes none */
      }
      agent =startProcess("swipe-back-agent.mjs", [base, String((VISITOR_MINUTES + 15) * 60)], { LOOP_LLM_API_KEY: gatewayKey }, (l) => log("[agent]", l));

      // 3. The visitors, side by side, each in its own folder, for VISITOR_MIN_MINUTES to VISITOR_MINUTES each.
      const brief = readFileSync(join(HERE, "visitor-brief.md"), "utf8");
      const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
      const visit = async (i) => {
        const dir = join(RUN, `visitor-${i + 1}`);
        mkdirSync(dir, { recursive: true });
        const started = Date.now();
        const notBefore = started + VISITOR_MIN_MINUTES * 60_000;
        const prompt = brief
          .replaceAll("{{BASE}}", base)
          .replaceAll("{{DIR}}", dir)
          .replaceAll("{{MINUTES}}", String(VISITOR_MINUTES))
          .replaceAll("{{MIN_MINUTES}}", String(VISITOR_MIN_MINUTES))
          .replaceAll("{{NOT_BEFORE}}", clock(notBefore))
          .replaceAll("{{UNTIL}}", clock(started + VISITOR_MINUTES * 60_000));
        const opts = {
          cwd: dir,
          model: VISITOR_MODEL,
          tools: ["Read", "Write", "Edit", "Bash(curl:*)", "Bash(python3:*)", "Bash(node:*)", "Bash(jq:*)", "Bash(cat:*)", "Bash(ls:*)", "Bash(sleep:*)", "Bash(mkdir:*)", "Bash(date:*)"],
        };
        let r = await claude(prompt, { ...opts, timeoutMin: VISITOR_MINUTES + 20 });
        // Wrapped up early: the same conversation carries on (the world has moved meanwhile), then writes the report again.
        for (let n = 1; n <= VISITOR_NUDGES && r.code === 0 && Date.now() < notBefore - 60_000 && Date.now() < DEADLINE - 30 * 60_000; n++) {
          writeFileSync(join(RUN, `visitor-${i + 1}-early-${n}.md`), r.text);
          const left = Math.ceil((notBefore - Date.now()) / 60_000);
          const nudge =
            `It's only been ${Math.floor((Date.now() - started) / 60_000)} minutes, and you have until ${clock(notBefore)} at least ` +
            `(${left} more minutes). Things on the server may have changed since you last looked. Go back to it: check on what you ` +
            `started and try something you haven't yet. When it's ${clock(notBefore)} or later, write your whole report again ` +
            `(every section; it replaces the one above).`;
          r = await claude(nudge, { ...opts, resume: true, timeoutMin: left + 20 });
        }
        writeFileSync(join(RUN, `visitor-${i + 1}.md`), r.text);
        return Math.round((Date.now() - started) / 60_000);
      };
      summary.visitor_minutes = await Promise.all(Array.from({ length: VISITORS }, (_, i) => visit(i)));
      summary.visitors = VISITORS;
      const local = await feedbackFrom(base, arenaPassword, null);
      writeFileSync(join(RUN, "feedback-local.json"), JSON.stringify(local, null, 2));
      summary.feedback_local = local.length;
    }
    summary.crowd_brain = crowdBrain() ?? summary.crowd_brain; // the minute-fresh counts, in case the stop write is late
    agent?.kill("SIGTERM");
    arena?.kill("SIGTERM");
    summary.model_spend_usd = Math.round(((before - (await credits(gatewayKey))) || 0) * 10000) / 10000;

    // 4. Triage: tonight's feedback plus real agents' on botchelor.com since the last run.
    let live = [];
    let livePassword = null;
    try {
      livePassword = keychain("vault/botchelor/FRONTIER_PASSWORD");
      live = await feedbackFrom("https://botchelor.com", livePassword, state.last_live_feedback_at ?? null);
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
        // Edit(path) rules cover writing new files too (Write(path) rules don't apply to files), and an absolute path
        // needs a leading "//": a single "/" is read as relative to the settings folder, so triage.md was denied.
        tools: ["Read", "Grep", "Glob", `Edit(/${RUN}/**)`, "Bash(gh issue:*)", "Bash(gh label:*)", "Bash(git log:*)", "Bash(git show:*)"],
        timeoutMin: 25,
        out: join(RUN, "triage.log"),
      });
    }
    if (newest) state.last_live_feedback_at = newest;
    // So /admin/feedback shows the visitors' feedback too (David, 2026-10-17), labelled as this loop run.
    if (livePassword && summary.feedback_local) {
      try {
        const local = JSON.parse(readFileSync(join(RUN, "feedback-local.json"), "utf8"));
        const res = await fetch("https://botchelor.com/api/admin/feedback", {
          method: "POST",
          headers: { "content-type": "application/json", "x-frontier-key": livePassword },
          body: JSON.stringify({ source: `loop ${day}`, rows: local }),
        });
        summary.feedback_posted = res.ok ? (await res.json()).added : `failed (${res.status})`;
      } catch {
        summary.feedback_posted = "failed";
      }
    }

    // 5. Housekeeping: close stale issues, and nudge David about the ones waiting on him.
    try {
      Object.assign(summary, await housekeeping(state));
    } catch (err) {
      summary.housekeeping_error = err instanceof Error ? err.message : String(err);
    }

    // 5b. The After Dark observer (scripts/eval/observer-nightly.sh, botchelor-2c's #583): read-only checks on the pairs
    // that changed in the last day, one summary row to /admin/analytics, no model. Its outcome goes in the summary, so a
    // failure is seen rather than swallowed; ten minutes at most, so it never holds up the fixer.
    try {
      const out = sh("zsh", ["scripts/eval/observer-nightly.sh"], { timeout: 10 * 60_000 });
      summary.observer = out.trim().split("\n").at(-1)?.slice(0, 300) || "ok";
    } catch (err) {
      summary.observer = `failed: ${(err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200)}`;
    }

    // 6. One fixer.
    if (FIX && Date.now() < DEADLINE - 20 * 60_000) {
      const fix = readFileSync(join(HERE, "fix-prompt.md"), "utf8").replaceAll("{{MAX_FIXES}}", String(MAX_FIXES)).replaceAll("{{OUT}}", join(RUN, "fixes.md"));
      await claude(fix, { cwd: REPO, model: FIX_MODEL, tools: "all", timeoutMin: Math.floor((DEADLINE - Date.now()) / 60_000), out: join(RUN, "fix.log") });
      sh("git", ["checkout", "-q", "--detach", "origin/main"]);
    }
    summary.finished_at = new Date().toISOString();
    emit(
      "run_finished",
      "ok",
      `visitors=${summary.visitors ?? 0} feedback=${(summary.feedback_local ?? 0) + summary.feedback_live} spend=$${summary.model_spend_usd} stale_closed=${summary.stale_closed ?? 0} needs_david=${summary.needs_david ?? 0}`,
    );
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    emit("run_failed", "fail", summary.error);
  } finally {
    agent?.kill("SIGTERM");
    arena?.kill("SIGTERM");
    // The arena rewrites crowd.json as it stops: give it a moment, so the summary has the whole run's counts.
    if (arena) await new Promise((ok) => setTimeout(ok, 1500));
    summary.crowd_brain = crowdBrain() ?? summary.crowd_brain;
    writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
    // 7. The visitors' ratings to botchelor.com, for the Quality tab on /admin/analytics (sim_ratings). post-ratings.mjs
    // reads the summary just written (sha, times), so it runs after it, failed runs included; a run without reports
    // posts nothing. Its outcome goes in the summary, a minute at most.
    try {
      const out = sh("node", [join(HERE, "post-ratings.mjs"), RUN], { timeout: 60_000 });
      summary.ratings_posted = out.trim().split("\n").at(-1)?.slice(0, 200) || "ok";
    } catch (err) {
      summary.ratings_posted = `failed: ${(err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200)}`;
    }
    writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(STATE, JSON.stringify(state, null, 2));
    rmSync(join(RUN, "arena", "db"), { recursive: true, force: true }); // the throwaway database
    rmSync(LOCK, { force: true });
  }
}

await main();
