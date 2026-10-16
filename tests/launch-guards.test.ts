import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReports, POST as postReview } from "@/app/api/admin/reports/route";
import { POST as postEpisode } from "@/app/api/episodes/route";
import { GET as getHealth } from "@/app/api/health/route";
import { deleteAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { setDbForTests, type Db } from "@/lib/db";
import {
  claimPaidDate,
  DATE_START_LIMITS,
  DEFAULT_PAID_DATES_PER_DAY,
  overLimit,
  paidDatesPerDay,
  paidDatesToday,
  pruneRateHits,
  visitorKey,
} from "@/lib/limits";
import { getModel, ModelError, setFrontierModelForTests, setModelForTests } from "@/lib/model";
import { listOpenReports, reviewReports } from "@/lib/moderation";
import {
  api,
  BASE_URL,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  setupEpisode,
  startTestDb,
  userIdOf,
  validCharacter,
} from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  setFrontierModelForTests(null);
});

/** A new visitor (fresh cookie and character) asking for a date, from `ip` (null: an in-process call, like MCP). */
async function startDateFrom(ip: string | null): Promise<Response> {
  const cookie = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), cookie)).json();
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const headers: Record<string, string> = { "content-type": "application/json", cookie };
  if (ip) headers["x-forwarded-for"] = `${ip}, 10.0.0.1`;
  return postEpisode(
    new Request(BASE_URL + "/api/episodes", {
      method: "POST",
      headers,
      body: JSON.stringify({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }),
    }),
  );
}

describe("starting dates is limited per visitor, not per cookie", () => {
  const saved = { ...DATE_START_LIMITS };
  afterEach(() => Object.assign(DATE_START_LIMITS, saved));

  it("a fresh cookie from the same connection can't keep starting free dates", async () => {
    Object.assign(DATE_START_LIMITS, { perHour: 2, perDay: 10 });
    expect((await startDateFrom("203.0.113.7")).status).toBe(200);
    expect((await startDateFrom("203.0.113.7")).status).toBe(200);
    const third = await startDateFrom("203.0.113.7");
    expect(third.status).toBe(429);
    expect((await third.json()).error).toBe("too_many_dates");
    // Someone else, and an in-process call with no IP (the MCP front door has its own daily cap), are unaffected.
    expect((await startDateFrom("198.51.100.9")).status).toBe(200);
    expect((await startDateFrom(null)).status).toBe(200);
  });

  it("stores a keyed hash of the IP, never the IP, and prunes it after two days", async () => {
    await startDateFrom("203.0.113.7");
    const { rows } = await t.db.query<{ key: string }>("select key from rate_hits");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).not.toContain("203.0.113");
    expect(rows[0].key).toBe(visitorKey(new Headers({ "x-forwarded-for": "203.0.113.7" })));
    await pruneRateHits(t.db, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect(await t.count("rate_hits")).toBe(0);
  });

  it("counts an hour and a day window", async () => {
    const t0 = new Date("2026-10-16T12:00:00Z");
    const limits = { perHour: 2, perDay: 3 };
    expect(await overLimit(t.db, "x", "k", limits, t0)).toBe(false);
    expect(await overLimit(t.db, "x", "k", limits, t0)).toBe(false);
    expect(await overLimit(t.db, "x", "k", limits, t0)).toBe(true); // hour full
    const later = new Date(t0.getTime() + 2 * 60 * 60 * 1000);
    expect(await overLimit(t.db, "x", "k", limits, later)).toBe(false); // a new hour, day has room for one more
    expect(await overLimit(t.db, "x", "k", limits, later)).toBe(true); // day full
  });
});

describe("the paid default model has a daily cap", () => {
  it("claims dates until the cap, then says no until the next UTC day", async () => {
    const day1 = new Date("2026-10-16T08:00:00Z");
    expect(await claimPaidDate(t.db, 2, day1)).toBe(true);
    expect(await claimPaidDate(t.db, 2, day1)).toBe(true);
    expect(await claimPaidDate(t.db, 2, day1)).toBe(false);
    expect(await paidDatesToday(t.db, day1)).toBe(3);
    expect(await claimPaidDate(t.db, 2, new Date("2026-10-17T00:05:00Z"))).toBe(true);
    expect(await claimPaidDate(t.db, 0, day1)).toBe(false);
  });

  it("reads FRONTIER_DAILY_DATE_CAP, falling back to the default on nonsense", () => {
    expect(paidDatesPerDay({})).toBe(DEFAULT_PAID_DATES_PER_DAY);
    expect(paidDatesPerDay({ FRONTIER_DAILY_DATE_CAP: "25" })).toBe(25);
    expect(paidDatesPerDay({ FRONTIER_DAILY_DATE_CAP: "0" })).toBe(0);
    expect(paidDatesPerDay({ FRONTIER_DAILY_DATE_CAP: "lots" })).toBe(DEFAULT_PAID_DATES_PER_DAY);
    expect(paidDatesPerDay({ FRONTIER_DAILY_DATE_CAP: "-3" })).toBe(DEFAULT_PAID_DATES_PER_DAY);
  });

  it("past the cap a date runs on the free model, never the paid one", async () => {
    setModelForTests(null);
    vi.stubEnv("FRONTIER_DEFAULT", "1");
    vi.stubEnv("FRONTIER_LLM_BASE_URL", "https://gateway.example/v1");
    vi.stubEnv("FRONTIER_LLM_API_KEY", "test-key");
    vi.stubEnv("FRONTIER_LLM_MODEL", "paid-model");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("LLM_API_KEY", "");
    const paid = vi.fn(async () => "from the paid model");
    setFrontierModelForTests({ complete: paid });

    expect(await getModel(undefined, true).complete([{ role: "user", content: "hi" }])).toBe("from the paid model");
    expect(paid).toHaveBeenCalledTimes(1);
    // allowPaid=false: the free model (unconfigured here, so it fails loudly) and the paid model untouched.
    await expect(getModel(undefined, false).complete([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(ModelError);
    expect(paid).toHaveBeenCalledTimes(1);
  });
});

describe("report review", () => {
  async function reportedEpisode(reasons: string[]) {
    const { episode } = await setupEpisode("friends");
    for (const reason of reasons) await api.report({ episode_id: episode.id, reason }, newUserCookie());
    return episode.id as string;
  }

  it("lists open reports with enough to judge them, then clearing puts the episode back", async () => {
    const id = await reportedEpisode(["sexual", "sexual", "other"]);
    const [listed] = await listOpenReports(t.db);
    expect(listed.episode_id).toBe(id);
    expect(listed.reports).toBe(3);
    expect(listed.hidden).toBe(true);
    expect(listed.reasons).toEqual({ sexual: 2, other: 1 });
    expect(listed.characters).toHaveLength(2);

    expect(await reviewReports(t.db, id, "cleared")).toBe(3);
    // Every visibility query counts open `reports` rows: none left, so it shows again.
    expect(await t.count("reports", `episode_id = '${id}'`)).toBe(0);
    expect(await t.count("reports_reviewed", `episode_id = '${id}' and decision = 'cleared'`)).toBe(3);
    expect(await listOpenReports(t.db)).toEqual([]);
    expect(await reviewReports(t.db, id, "cleared")).toBe(0);
  });

  it("taking an episode down makes it private to its creator, deleting nothing", async () => {
    const id = await reportedEpisode(["minor"]);
    expect(await reviewReports(t.db, id, "removed")).toBe(1);
    const { rows } = await t.db.query<{ visibility: string }>("select visibility from episodes where id = $1", [id]);
    expect(rows[0].visibility).toBe("private");
  });

  it("the admin API needs the admin password or an admin account", async () => {
    const id = await reportedEpisode(["hateful"]);
    vi.stubEnv("FRONTIER_PASSWORD", "owner-pass");
    const get = (headers: Record<string, string>) => getReports(new Request(BASE_URL + "/api/admin/reports", { headers }));
    expect((await get({})).status).toBe(403);
    expect((await get({ "x-frontier-key": "wrong" })).status).toBe(403);
    const listed = await (await get({ "x-frontier-key": "owner-pass" })).json();
    expect(listed.episodes.map((e: { episode_id: string }) => e.episode_id)).toEqual([id]);

    const admin = newUserCookie();
    await claimAdmin(t.db, userIdOf(admin));
    expect((await get({ cookie: admin })).status).toBe(200);

    const review = (decision: string) =>
      postReview(
        new Request(BASE_URL + "/api/admin/reports", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin },
          body: JSON.stringify({ episode_id: id, decision }),
        }),
      );
    expect((await review("burn it")).status).toBe(422);
    expect((await review("cleared")).status).toBe(200);
    expect((await review("cleared")).status).toBe(404);
  });

  it("deleting an account deletes the reports it made, reviewed or not", async () => {
    const { episode } = await setupEpisode("friends");
    const reporter = newUserCookie();
    await api.report({ episode_id: episode.id, reason: "other" }, reporter);
    await reviewReports(t.db, episode.id, "cleared");
    await deleteAccount(t.db, userIdOf(reporter));
    expect(await t.count("reports_reviewed", `reporter_id = '${userIdOf(reporter)}'`)).toBe(0);
  });
});

describe("GET /api/health", () => {
  const health = (headers: Record<string, string> = {}) => getHealth(new Request(BASE_URL + "/api/health", { headers }));

  it("tells anyone it's up, and only the monitor what's waiting", async () => {
    const { episode } = await setupEpisode("friends");
    await api.report({ episode_id: episode.id, reason: "other" }, newUserCookie());
    const pub = await health();
    expect(pub.status).toBe(200);
    expect(await pub.json()).toEqual({ ok: true });

    vi.stubEnv("CRON_SECRET", "cron-secret");
    const detail = await (await health({ authorization: "Bearer cron-secret" })).json();
    expect(detail.reports.episodes).toBe(1);
    expect(detail.reports.reports).toBe(1);
    expect(detail.stuck_generating).toBe(0);
    expect(detail.paid_dates).toEqual({ today: 0, cap: DEFAULT_PAID_DATES_PER_DAY });
    expect(await (await health({ authorization: "Bearer nope" })).json()).toEqual({ ok: true });
  });

  it("503s when the database is unreachable", async () => {
    const broken: Db = {
      async query() {
        throw new Error("connection refused");
      },
      async exec() {},
    };
    setDbForTests(broken);
    try {
      const res = await health();
      expect(res.status).toBe(503);
      expect((await res.json()).ok).toBe(false);
    } finally {
      setDbForTests(t.db);
    }
  });
});
