import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The scheduled job's command (.do/app.yaml, the lobby job), run for real by sh against a stand-in wget, date and sleep:
 * which calls each hour makes, that a failed call fails the run, and that the daily job's resume pass stops when there is
 * nothing left. A typo in this one line would stop every scheduled job without a test failing anywhere else.
 */

/** The folded run_command of the lobby job, as DigitalOcean reads it: its lines joined by spaces. */
function runCommand(): string {
  const lines = readFileSync(".do/app.yaml", "utf8").split("\n");
  const at = lines.findIndex((l, i) => i > lines.indexOf("jobs:") && l.trim() === "run_command: >-");
  expect(at).toBeGreaterThan(0);
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith("      ")) break;
    out.push(l.trim());
  }
  return out.join(" ");
}

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bz-job-"));
  // wget: logs the address it was asked for (and whether the secret came along), answers what the test set up.
  writeFileSync(
    join(dir, "wget"),
    `#!/bin/sh
for a; do url="$a"; done
case "$*" in *"Authorization: Bearer $CRON_SECRET"*) echo "$url" >> "$LOG" ;; *) echo "NO SECRET $url" >> "$LOG" ;; esac
if [ -n "$FAIL" ]; then case "$url" in *"$FAIL"*) exit 1 ;; esac; fi
if [ -n "$PART_ERROR" ]; then case "$url" in *"$PART_ERROR"*) printf '\\n{"error":"internal_error"}'; exit 0 ;; esac; fi
case "$url" in
  *part=resume*) n=$(grep -c 'part=resume' "$LOG"); sed -n "\${n}p" "$RESUME" ;;
  *) printf '\\n\\n{"ok":true,"n":1}' ;;
esac
`,
  );
  writeFileSync(join(dir, "date"), `#!/bin/sh\necho "$HOUR"\n`);
  writeFileSync(join(dir, "sleep"), `#!/bin/sh\necho "sleep $1" >> "$LOG"\n`);
  for (const f of ["wget", "date", "sleep"]) chmodSync(join(dir, f), 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the command at an hour; resume answers come from `resume` in order. Returns the log of calls, output and exit code. */
function runAt(hour: string, o: { resume?: string[]; fail?: string; partError?: string } = {}) {
  const log = join(dir, `log-${hour}-${Math.random().toString(36).slice(2)}`);
  const resume = join(dir, `resume-${Math.random().toString(36).slice(2)}`);
  writeFileSync(log, "");
  writeFileSync(resume, (o.resume ?? ['{"ok":true,"resumed":null,"reason":"all_done"}']).join("\n") + "\n");
  const cmd = runCommand();
  expect(cmd.startsWith("sh -c '") && cmd.endsWith("'")).toBe(true);
  const script = cmd.slice("sh -c '".length, -1);
  const res = spawnSync("sh", ["-c", script], {
    env: { NODE_ENV: "test", PATH: `${dir}:/usr/bin:/bin`, CRON_SECRET: "test-secret-value", HOUR: hour, LOG: log, RESUME: resume, FAIL: o.fail ?? "", PART_ERROR: o.partError ?? "" },
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replace("https://", "").replace("/api/jobs/", " "));
  return { calls, out: res.stdout, code: res.status };
}

describe("the scheduled job's command", () => {
  it("never waits idle and never names the secret itself", () => {
    const cmd = runCommand();
    expect(cmd).not.toMatch(/sleep (1[0-9]{3}|[2-9][0-9]{2})\b/); // the 20-minute sleep took the 16:20 run past 30 minutes
    expect(cmd).toContain('"Authorization: Bearer $CRON_SECRET"');
  });

  it("at 16:20 UTC: the lobby, the daily job's four parts 45 s apart, then After Dark's daily job", () => {
    const r = runAt("16");
    expect(r.calls).toEqual([
      "botchelor.com lobby",
      "botchelor.com daily?part=upkeep",
      "sleep 45",
      "botchelor.com daily?part=show",
      "sleep 45",
      "botchelor.com daily?part=people",
      "sleep 45",
      "botchelor.com daily?part=growth",
      "ad.botchelor.com after-dark-daily",
    ]);
    expect(r.code).toBe(0);
  });

  it("in the small hours: the lobby, then the showcase check, and no resume pass", () => {
    const r = runAt("03");
    expect(r.calls).toEqual(["botchelor.com lobby", "ad.botchelor.com showcase-check"]);
    expect(r.code).toBe(0);
  });

  it("from 17:20 to 23:20: the resume pass before the showcase check, stopping at resumed: null", () => {
    const none = runAt("17");
    expect(none.calls).toEqual(["botchelor.com lobby", "botchelor.com daily?part=resume", "ad.botchelor.com showcase-check"]);
    const one = runAt("23", { resume: ['{"ok":true,"resumed":"people","why":"cut off"}', '{"ok":true,"resumed":null,"reason":"all_done"}'] });
    expect(one.calls).toEqual(["botchelor.com lobby", "botchelor.com daily?part=resume", "sleep 45", "botchelor.com daily?part=resume", "ad.botchelor.com showcase-check"]);
    expect(one.code).toBe(0);
    // Two parts at most a run, so the run stays well inside DigitalOcean's 30 minutes.
    const busy = runAt("20", { resume: ['{"ok":true,"resumed":"show"}', '{"ok":true,"resumed":"people"}', '{"ok":true,"resumed":"growth"}'] });
    expect(busy.calls.filter((c) => c.includes("part=resume"))).toHaveLength(2);
    expect(busy.calls.at(-1)).toBe("ad.botchelor.com showcase-check");
  });

  it("a failed call says so and fails the run, and the calls after it still go", () => {
    const down = runAt("16", { fail: "lobby" });
    expect(down.out).toContain("FAILED: botchelor.com lobby");
    expect(down.code).toBe(1);
    expect(down.calls).toContain("ad.botchelor.com after-dark-daily");
    // A part that failed answers 200 and an error (the answer streams), so it's the missing ok: true that counts.
    const part = runAt("16", { partError: "part=people" });
    expect(part.out).toContain("FAILED: botchelor.com daily?part=people");
    expect(part.code).toBe(1);
    expect(part.calls).toContain("botchelor.com daily?part=growth");
    // A resume pass that failed stops the pass, and the showcase check still runs.
    const resume = runAt("18", { resume: ['{"error":"internal_error"}'] });
    expect(resume.calls).toEqual(["botchelor.com lobby", "botchelor.com daily?part=resume", "ad.botchelor.com showcase-check"]);
    expect(resume.code).toBe(1);
  });
});
