// Quality runs (lib/quality-runs.ts, POST/GET /api/admin/quality): the golden set's verdicts and the nightly After Dark
// observer's counts, posted from the developer's Mac and shown on /admin/analytics (the Quality tab).
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RunsTable } from "@/app/admin/analytics/QualityTab";
import RealUse from "@/app/admin/analytics/RealUse";
import { GET as getQuality, POST as postQuality } from "@/app/api/admin/quality/route";
import { claimAdmin } from "@/lib/admins";
import { loadInsights } from "@/lib/insights";
import { keyMetrics, listQualityRuns, saveQualityRun, type QualityRun } from "@/lib/quality-runs";
import { realUse } from "@/lib/real-metrics";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from admins");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const PASSWORD = ["quality", "runs", "pass"].join("-");
const post = (body: unknown, headers: Record<string, string> = { "x-frontier-key": PASSWORD }) =>
  postQuality(new Request(`${BASE_URL}/api/admin/quality`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const get = (query = "", headers: Record<string, string> = { "x-frontier-key": PASSWORD }) => getQuality(new Request(`${BASE_URL}/api/admin/quality${query}`, { headers }));

const golden = (label: string, at: string, winRate = 0.62) => ({
  kind: "golden",
  label,
  sha: "abc1234def",
  at,
  metrics: { suite: "after_dark", n: 8, wins_b: 4, wins_a: 2, ties: 2, win_rate_b: winRate, p_value: 0.6875, sheet_win_rate_b: 0.7, gate: { passed: winRate >= 0.45, reasons: [] }, cost_usd: 0.19 },
});
const observerRun = (label: string, at: string) => ({
  kind: "after_dark_observer",
  label,
  at,
  metrics: { pairs: 3, observed: 3, errors: 0, lines: 240, unprovoked_moves: 2, verbatim_repeats: 1, near_repeats: 3, unfounded_memories: 0, share_memory: 0.31 },
});

describe("the quality route", () => {
  it("needs the admin password or a signed-in admin account", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    expect((await post(golden("g1", "2026-10-21T10:00:00Z"), {})).status).toBe(403);
    expect((await post(golden("g1", "2026-10-21T10:00:00Z"), { "x-frontier-key": "wrong" })).status).toBe(403);
    expect((await get("", {})).status).toBe(403);
    expect((await post(golden("g1", "2026-10-21T10:00:00Z"), { cookie: signedInCookie(randomUUID()) })).status).toBe(403); // signed in, not an admin
    const adminId = randomUUID();
    await claimAdmin(t.db, adminId);
    expect((await post(golden("g1", "2026-10-21T10:00:00Z"), { cookie: signedInCookie(adminId) })).status).toBe(201);
    // An admin's id without a signed-in session (a bare legacy cookie) isn't enough.
    expect((await post(golden("g2", "2026-10-21T10:00:00Z"), { cookie: `bz_uid=${adminId}` })).status).toBe(403);
    expect(await t.db.query("select count(*)::int as n from quality_runs").then((r) => r.rows[0])).toEqual({ n: 1 });
  });

  it("inserts, replaces the same kind and label, and lists newest first with a limit and a kind", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
    const first = await post(golden("ad-v1-v2", "2026-10-20T10:00:00Z", 0.4));
    expect(first.status).toBe(201);
    const saved = (await first.json()).saved as QualityRun;
    expect(saved).toMatchObject({ kind: "golden", label: "ad-v1-v2", sha: "abc1234def", at: "2026-10-20T10:00:00.000Z" });
    // The same run again replaces it, keeping its id.
    const again = (await (await post(golden("ad-v1-v2", "2026-10-20T11:00:00Z", 0.62))).json()).saved as QualityRun;
    expect(again.id).toBe(saved.id);
    expect(again.metrics.win_rate_b).toBe(0.62);
    // The same label under the other kind is another run.
    expect((await post(observerRun("ad-v1-v2", "2026-10-21T06:00:00Z"))).status).toBe(201);
    for (let d = 1; d <= 12; d++) await post(observerRun(`nightly-2026-09-${String(d).padStart(2, "0")}`, `2026-09-${String(d).padStart(2, "0")}T06:00:00Z`));

    const all = (await (await get()).json()).runs as QualityRun[];
    expect(all).toHaveLength(10); // the default limit
    expect(all.map((r) => r.at).slice(0, 2)).toEqual(["2026-10-21T06:00:00.000Z", "2026-10-20T11:00:00.000Z"]);
    const goldens = (await (await get("?kind=golden&limit=50")).json()).runs as QualityRun[];
    expect(goldens.map((r) => r.label)).toEqual(["ad-v1-v2"]);
    expect((await (await get("?limit=3")).json()).runs).toHaveLength(3);
    expect((await get("?kind=sims")).status).toBe(400);
  });

  it("validates what it's sent", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
    expect((await post({ ...golden("x", "2026-10-21T10:00:00Z"), kind: "vibes" })).status).toBe(422);
    expect((await post({ ...golden("", "2026-10-21T10:00:00Z") })).status).toBe(422);
    expect((await post({ ...golden("x", "yesterday") })).status).toBe(422);
    expect((await post({ kind: "golden", label: "x" })).status).toBe(422); // no metrics
    // No time: now.
    const r = await post({ kind: "golden", label: "untimed", metrics: { suite: "dates" } });
    expect(r.status).toBe(201);
    expect(Math.abs(new Date((await r.json()).saved.at).getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("what the analytics page shows for a run", () => {
  it("the golden set: B's win rate with n and p, the sheet, the gate and the cost", async () => {
    const run = await saveQualityRun(t.db, { ...golden("g", "2026-10-21T10:00:00Z"), kind: "golden", sha: null });
    expect(keyMetrics(run)).toEqual([
      { label: "suite", value: "after dark" },
      { label: "B vs A", value: "62% (n 8, p 0.69)", bad: false },
      { label: "sounds like the sheet", value: "70%" },
      { label: "gate", value: "passed", bad: false },
      { label: "cost", value: "$0.19" },
    ]);
    const losing = keyMetrics({ ...run, metrics: { ...run.metrics, win_rate_b: 0.3, gate: { passed: false } } });
    expect(losing.find((m) => m.label === "B vs A")?.bad).toBe(true);
    expect(losing.find((m) => m.label === "gate")).toEqual({ label: "gate", value: "failed", bad: true });
    expect(keyMetrics({ ...run, metrics: { suite: "dates", win_rate_b: null } })[1]).toMatchObject({ value: "not judged" });
  });

  it("the observer: pairs, lines and what it flagged", async () => {
    const run = await saveQualityRun(t.db, { ...observerRun("n", "2026-10-21T06:00:00Z"), kind: "after_dark_observer", sha: "abc" });
    expect(keyMetrics(run)).toEqual([
      { label: "pairs", value: "3" },
      { label: "lines", value: "240" },
      { label: "unprovoked moves", value: "2", bad: true },
      { label: "repeats", value: "4", bad: true },
      { label: "unfounded memories", value: "0", bad: false },
      { label: "lines citing a memory", value: "31%" },
    ]);
  });

  it("Real use carries the last 10 runs, and the Quality tab lists the period's runs (numbers, never their cost)", async () => {
    for (let d = 1; d <= 11; d++) await saveQualityRun(t.db, { ...observerRun(`nightly-${d}`, `2026-10-${String(d).padStart(2, "0")}T06:00:00Z`), kind: "after_dark_observer", sha: null });
    await saveQualityRun(t.db, { ...golden("ad-v1-v2", "2026-10-21T10:00:00Z"), kind: "golden", sha: "abc1234def" });
    const now = new Date("2026-10-21T12:00:00Z");
    const data = await realUse(t.db, now);
    expect(data.quality).toHaveLength(10);
    expect(data.quality[0].label).toBe("ad-v1-v2");
    expect(await listQualityRuns(t.db, { limit: 100 })).toHaveLength(12);
    const insights = await loadInsights(t.db, { from: "2026-10-01", to: "2026-10-21", segment: "all", includeOurs: false }, now);
    expect(insights.quality.runs).toHaveLength(12);
    const html = renderToStaticMarkup(createElement(RunsTable, { rows: insights.quality.runs }));
    expect(html).toContain("Golden A/B");
    expect(html).toContain("After Dark observer");
    expect(html).toContain("<code>abc1234</code>");
    expect(html).toContain("62% (n 8, p 0.69)");
    expect(html).not.toContain("$0.19");
    expect(renderToStaticMarkup(createElement(RealUse, { data }))).toContain("<h3>Line votes</h3>");
  });

  it("an empty table says how runs get there", async () => {
    const html = renderToStaticMarkup(createElement(RunsTable, { rows: [] }));
    expect(html).toContain("None in this period.");
    expect(html).toContain("scripts/eval/golden.mjs --post");
  });
});
