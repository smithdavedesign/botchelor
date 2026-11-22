import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as houseReport } from "@/app/api/house/[id]/report/route";
import { POST as reportsRoute } from "@/app/api/reports/route";
import { POST as chatReport } from "@/app/api/watch-parties/[id]/report/route";
import { signSession } from "@/lib/auth";
import { REPORT_EMAIL_LIMITS, saveContentReport } from "@/lib/content-reports";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { listSceneReports } from "@/lib/house-scenes";
import { REPORT_LIMITS, REPORTER_MIN_AGE_SECONDS, reportCounts } from "@/lib/report-trust";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { api, BASE_URL, newUserCookie, setupEpisode, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// Whose report takes something down by itself (lib/report-trust.ts, 2026-11-22): a signed-in account's, or an identity's
// a day old. Anyone else's reaches the admins and hides nothing; every report route is limited per address and identity.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setEmailSenderForTests(null);
});

/** An anonymous signed session first signed `ageSeconds` ago. */
const anonymous = (ageSeconds: number) => `bz_sess=${signSession({ uid: randomUUID(), authenticated: false }, process.env, Date.now() - ageSeconds * 1000)}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const takedowns = async () => (await t.db.query<{ n: number }>(`select count(*)::int as n from content_reports`)).rows[0].n;
const feedIds = async () => ((await (await api.feed()).json()).episodes as { id: string }[]).map((e) => e.id);

describe("whose report counts (reportCounts)", () => {
  const req = (cookie?: string) => new Request(`${BASE_URL}/api/reports`, { method: "POST", headers: cookie ? { cookie } : {} });

  it("a signed-in account's, and an identity's a day old; never a brand-new one's", () => {
    expect(reportCounts(req())).toBe(false);
    expect(reportCounts(req(signedInCookie(randomUUID())))).toBe(true);
    expect(reportCounts(req(anonymous(60)))).toBe(false);
    expect(reportCounts(req(anonymous(REPORTER_MIN_AGE_SECONDS + 60)))).toBe(true);
    // A bare id counts only where bare ids are read at all (local play and older tests, LEGACY_BARE_UID; never the live
    // site, whose rule this file runs under).
    expect(reportCounts(req(newUserCookie()))).toBe(false);
    vi.stubEnv("LEGACY_BARE_UID", "1");
    expect(reportCounts(req(newUserCookie()))).toBe(true);
  });
});

describe("a date's report", () => {
  it("from a brand-new identity reaches the admins as a takedown request and hides nothing", async () => {
    const { episode } = await setupEpisode();
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) {
      const res = await api.report({ episode_id: episode.id, reason: "minor" });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ episode_id: episode.id, reported: true });
    }
    expect(await feedIds()).toContain(episode.id);
    expect(await t.count("reports")).toBe(0);
    const requests = (await t.db.query<{ category: string; target: string; episode_id: string }>(`select category, target, episode_id from content_reports`)).rows;
    expect(requests).toHaveLength(REPORT_HIDE_THRESHOLD);
    expect(requests[0]).toEqual({ category: "minor", target: `/episodes/${episode.id}`, episode_id: episode.id });
  });

  it("once per identity while it's open, and an identity a day old counts", async () => {
    const { episode } = await setupEpisode();
    const fresh = anonymous(60);
    expect((await api.report({ episode_id: episode.id }, fresh)).status).toBe(201);
    expect((await api.report({ episode_id: episode.id }, fresh)).status).toBe(200);
    expect(await takedowns()).toBe(1);
    expect((await api.report({ episode_id: "missing-date" }, fresh)).status).toBe(404);
    expect((await api.report({ episode_id: episode.id }, anonymous(REPORTER_MIN_AGE_SECONDS + 60))).status).toBe(201);
    expect((await api.report({ episode_id: episode.id }, signedInCookie(randomUUID()))).status).toBe(201);
    expect(await t.count("reports")).toBe(2);
  });

  it("is limited per address and per identity", async () => {
    const { episode } = await setupEpisode();
    const fromIp = (ip: string, cookie = newUserCookie()) => reportsRoute(post("/api/reports", { episode_id: episode.id }, { "do-connecting-ip": ip, cookie }));
    for (let i = 0; i < REPORT_LIMITS.perHour; i++) expect((await fromIp("203.0.113.20")).status).toBeLessThan(300);
    const over = await fromIp("203.0.113.20");
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe("too_many_reports");
    expect((await fromIp("203.0.113.21")).status).toBeLessThan(300);
    const me = anonymous(60);
    for (let i = 0; i < REPORT_LIMITS.perHour; i++) expect((await fromIp(`198.51.100.${i + 1}`, me)).status).toBeLessThan(300);
    expect((await fromIp("198.51.100.200", me)).status).toBe(429);
  });
});

describe("a house line's report", () => {
  const SCENE = "hs-trust";
  const lines = [1, 2, 3].map((n) => ({ n, character_id: `c-${n}`, text: `Line ${n} of the scene.` }));
  const report = (line: number, cookie?: string) => houseReport(post(`/api/house/${SCENE}/report`, { line }, cookie ? { cookie } : {}), { params: Promise.resolve({ id: SCENE }) });

  it("from a brand-new identity is kept for the admins and hides nothing; ones that count still do", async () => {
    await t.db.query(`insert into house_scenes (id, day, season_id, place, lines, source) values ($1, '2026-11-22', 's-1', 'kitchen', $2::jsonb, 'template')`, [SCENE, JSON.stringify(lines)]);
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) {
      const res = await report(2);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ reported: true, hidden: false });
    }
    expect((await listSceneReports(t.db))[0]).toMatchObject({ scene_id: SCENE, line: 2, reports: REPORT_HIDE_THRESHOLD, hidden: false });
    for (let i = 0; i < REPORT_HIDE_THRESHOLD - 1; i++) expect(await (await report(2, signedInCookie(randomUUID()))).json()).toMatchObject({ hidden: false });
    expect(await (await report(2, signedInCookie(randomUUID()))).json()).toMatchObject({ hidden: true });
    expect((await listSceneReports(t.db))[0]).toMatchObject({ line: 2, reports: REPORT_HIDE_THRESHOLD * 2, hidden: true });
  });
});

describe("a chat message's report", () => {
  it("from a brand-new identity hides nothing; ones that count still do", async () => {
    const { episode } = await setupEpisode();
    const party = randomUUID();
    const message = randomUUID();
    await t.db.query(`insert into watch_parties (id, episode_id, kind) values ($1, $2, 'premiere')`, [party, episode.id]);
    await t.db.query(`insert into watch_messages (id, party_id, user_id, handle, body) values ($1, $2, $3, 'guest', 'hello all')`, [message, party, randomUUID()]);
    const report = (cookie?: string) => chatReport(post(`/api/watch-parties/${party}/report`, { message_id: message }, cookie ? { cookie } : {}), { params: Promise.resolve({ id: party }) });
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) expect(await (await report()).json()).toEqual({ hidden: false });
    expect(await t.count("watch_message_reports")).toBe(0);
    for (let i = 0; i < REPORT_HIDE_THRESHOLD - 1; i++) await report(signedInCookie(randomUUID()));
    expect(await (await report(signedInCookie(randomUUID()))).json()).toEqual({ hidden: true });
  });
});

describe("report emails", () => {
  it("stop past the site's limit; the reports themselves are all kept", async () => {
    const sent: EmailMessage[] = [];
    setEmailSenderForTests(async (msg) => {
      sent.push(msg);
    });
    vi.stubEnv("RESEND_API_KEY", ["placeholder", "resend", "key"].join("-"));
    vi.stubEnv("CONTACT_EMAIL", "help@example.test");
    for (let i = 0; i < REPORT_EMAIL_LIMITS.perHour + 3; i++) {
      await saveContentReport(t.db, { category: "other", target: `/episodes/x${i}`, details: "looks off", email: null }, { userId: randomUUID(), account: false, userAgent: "Mozilla/5.0" });
    }
    expect(sent).toHaveLength(REPORT_EMAIL_LIMITS.perHour);
    expect(await takedowns()).toBe(REPORT_EMAIL_LIMITS.perHour + 3);
  });
});
