// The daily job's parts survive a deploy (lib/daily-parts.ts): each part leaves started/done/failed rows in the servers'
// own log, and the hourly resume pass from 17:20 UTC runs the first part of the day that didn't finish.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dailyJob } from "@/app/api/jobs/daily/route";
import { GET as adminOps } from "@/app/api/admin/ops/route";
import { dailyStatus, MAX_TRIES, nextDailyPart, pickResume, STILL_RUNNING_MS, type PartRow } from "@/lib/daily-parts";
import { opsDetail } from "@/lib/ops-log";
import { BASE_URL, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  // job_runs isn't in the shared reset, and a part's run there counts as done when it has no rows of its own.
  await t.db.query(`delete from job_runs`);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const DAY = "2030-01-15";
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00Z`);
const row = (part: string, state: string, hhmm: string): PartRow => ({ part, state, at: at(hhmm) });
const done = (part: string, hhmm: string) => [row(part, "started", hhmm), row(part, "done", hhmm)];

describe("pickResume", () => {
  it("waits for 17:00 UTC, so it never runs beside the scheduled 16:20 run", () => {
    expect(pickResume([], at("16:59"))).toMatchObject({ part: null, reason: "not_yet" });
    expect(pickResume([], at("17:20"))).toEqual({ part: "upkeep", why: "missed", tries: 0 });
  });

  it("runs the first part that didn't finish: cut off by a deploy, failed, or never started", () => {
    const base = [...done("upkeep", "16:20"), ...done("show", "16:21")];
    // A deploy at 16:23 ended the people part: a started row and nothing after it.
    expect(pickResume([...base, row("people", "started", "16:23")], at("17:20"))).toEqual({ part: "people", why: "cut off", tries: 1 });
    expect(pickResume([...base, row("people", "started", "16:23"), row("people", "failed", "16:24")], at("17:20"))).toEqual({
      part: "people",
      why: "failed",
      tries: 1,
    });
    expect(pickResume([...base, ...done("people", "16:23")], at("18:20"))).toEqual({ part: "growth", why: "missed", tries: 0 });
  });

  it("does nothing while a part may still be running", () => {
    const rows = [...done("upkeep", "16:20"), row("show", "started", "17:15")];
    expect(pickResume(rows, at("17:20"))).toEqual({ part: null, reason: "running", busy: "show", gave_up: [] });
    const later = new Date(at("17:15").getTime() + STILL_RUNNING_MS + 1);
    expect(pickResume(rows, later)).toEqual({ part: "show", why: "cut off", tries: 1 });
  });

  it("gives a part MAX_TRIES runs a day, then goes on to the next, and says when all are done", () => {
    const tries = Array.from({ length: MAX_TRIES }, () => [row("upkeep", "started", "16:20"), row("upkeep", "failed", "16:20")]).flat();
    expect(pickResume(tries, at("21:20"))).toEqual({ part: "show", why: "missed", tries: 0 });
    const all = [...tries, ...done("show", "17:20"), ...done("people", "18:20"), ...done("growth", "19:20")];
    expect(pickResume(all, at("21:20"))).toEqual({ part: null, reason: "all_done", busy: null, gave_up: ["upkeep"] });
    // A part run again after it finished is still done.
    expect(pickResume([...done("upkeep", "16:20"), row("upkeep", "started", "16:30"), ...done("show", "16:21"), ...done("people", "16:22"), ...done("growth", "16:23")], at("17:20"))).toMatchObject({
      reason: "all_done",
    });
  });
});

describe("the daily job's rows and its resume pass", () => {
  const secret = ["cron", "test", "secret", "0123456789"].join("-");
  const call = (part: string) => dailyJob(new Request(`${BASE_URL}/api/jobs/daily?backfill=0&part=${part}`, { headers: { authorization: `Bearer ${secret}` } }));
  const parts = async () =>
    (await t.db.query<{ part: string; state: string; resumed: string | null }>(
      `select props->>'part' as part, props->>'state' as state, props->>'resumed' as resumed from ops_log where event = 'daily_part' order by at, id`,
    )).rows;
  const clock = (hhmm: string) => {
    if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(hhmm));
  };

  it("a part writes started then done, and answers ok: true", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    clock("16:20");
    const body = await (await call("upkeep")).json();
    expect(body.ok).toBe(true);
    expect(await parts()).toEqual([
      { part: "upkeep", state: "started", resumed: null },
      { part: "upkeep", state: "done", resumed: null },
    ]);
  });

  it("from 17:20 the resume pass runs a part a deploy cut off, once, and then has nothing to do", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    clock("16:20");
    for (const p of ["upkeep", "show", "growth"]) expect((await (await call(p)).json()).ok).toBe(true);
    // The people part started and the container went away before it ended.
    await t.db.query(`insert into ops_log (at, host, event, props) values ($1, 'show', 'daily_part', '{"part":"people","state":"started"}'::jsonb)`, [at("16:23").toISOString()]);
    expect(await (await call("resume")).json()).toMatchObject({ ok: true, resumed: null, reason: "not_yet" });

    clock("17:20");
    const again = await (await call("resume")).json();
    expect(again).toMatchObject({ ok: true, resumed: "people", why: "cut off" });
    expect(again).toHaveProperty("texts"); // the people part's own answer
    expect((await parts()).filter((r) => r.part === "people").map((r) => `${r.state}${r.resumed ? ` (${r.resumed})` : ""}`)).toEqual([
      "started",
      "started (cut off)",
      "done (cut off)",
    ]);
    expect(await (await call("resume")).json()).toEqual({ ok: true, resumed: null, reason: "all_done", busy: null, gave_up: [] });
    expect((await t.db.query(`select part from job_runs where job = 'daily' and part = 'people'`)).rows).toHaveLength(1);
  });

  it("a part that throws writes failed with its reason, answers an error, and the resume pass runs it again", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    clock("16:21");
    // The show part's queued-jobs step has no catch of its own: without its table, the part fails.
    await t.db.query(`alter table generation_jobs rename to generation_jobs_away`);
    try {
      expect(await (await call("show")).json()).toEqual({ error: "internal_error" });
    } finally {
      await t.db.query(`alter table generation_jobs_away rename to generation_jobs`);
    }
    const failed = (await t.db.query<{ props: Record<string, unknown> }>(`select props from ops_log where event = 'daily_part' and props->>'state' = 'failed'`)).rows;
    expect(failed).toHaveLength(1);
    expect(failed[0].props).toMatchObject({ part: "show", state: "failed", reason: expect.stringContaining("generation_jobs") });
    expect(opsDetail("daily_part", failed[0].props)).toMatch(/^show failed after \d+ s: /);

    clock("17:20");
    expect(await nextDailyPart(t.db)).toEqual({ part: "upkeep", why: "missed", tries: 0 });
    await (await call("upkeep")).json();
    expect(await nextDailyPart(t.db)).toEqual({ part: "show", why: "failed", tries: 1 });
  });

  it("a part the job ran before parts were logged (a job_runs row, no rows of its own) counts as done", async () => {
    const ran = (part: string, hhmm: string) =>
      t.db.query(`insert into job_runs (job, part, at, ms, report) values ('daily', $1, $2, 1000, '{}'::jsonb)`, [part, at(hhmm).toISOString()]);
    await ran("people", "15:00"); // the day before's window: doesn't count for today
    await ran("upkeep", "16:20");
    await ran("show", "16:22");
    clock("20:20");
    expect(await nextDailyPart(t.db)).toEqual({ part: "people", why: "missed", tries: 0 });
    await ran("people", "16:27");
    await ran("growth", "16:33");
    expect(await nextDailyPart(t.db)).toEqual({ part: null, reason: "all_done", busy: null, gave_up: [] });
    expect((await dailyStatus(t.db)).parts.map((p) => `${p.part} ${p.state}`)).toEqual(["upkeep done", "show done", "people done", "growth done"]);
    // A run of all four at once (no ?part) is one row, "all".
    await t.db.query(`delete from job_runs`);
    await ran("all", "16:40");
    expect(await nextDailyPart(t.db)).toMatchObject({ part: null, reason: "all_done" });
  });

  it("/admin's Servers card gets the latest day's parts", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    clock("16:20");
    await (await call("upkeep")).json();
    clock("17:00");
    const status = await dailyStatus(t.db);
    expect(status.since).toBe(at("16:00").toISOString());
    expect(status.parts.map((p) => `${p.part} ${p.state}`)).toEqual(["upkeep done", "show not run", "people not run", "growth not run"]);
    // Before 16:00 the latest day is yesterday's.
    clock("15:00");
    expect((await dailyStatus(t.db)).since).toBe(new Date(at("16:00").getTime() - 24 * 60 * 60_000).toISOString());
    // The route is for admins only.
    expect((await adminOps(new Request(`${BASE_URL}/api/admin/ops`))).status).toBe(403);
  });
});
