// Return visits that were built and idle (the 2026-11-11 growth plan): the quiet-week nudge, tagged email links, the
// shared "best date" scoring, and the push prompt before a date airs.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bestDate, dateScore } from "@/lib/best-date";
import { emailLink } from "@/lib/email";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { nudgeQuietWeek, QUIET_WEEK_BATCH, quietPeople, weekBestDate } from "@/lib/reengage";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { pickClip } from "../scripts/clips/daily-clip.mjs";
import { api, BASE_URL, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

describe("the week's best date is scored like the daily clip", () => {
  const dates = [
    { id: "new-friends", ending: "friends", best_line: "x", lines: 24, revealed: true, transcript: new Array(24).fill({}) },
    { id: "second", ending: "second_date", best_line: null, lines: 12, revealed: true, transcript: new Array(12).fill({}) },
    { id: "disaster-line", ending: "disaster", best_line: "y", lines: 8, revealed: true, transcript: new Array(8).fill({}) },
  ];
  it("agrees with pickClip, and a decided ending with a best line wins", () => {
    expect(bestDate(dates)?.id).toBe("disaster-line");
    expect(pickClip(dates as never)?.id).toBe("disaster-line");
    expect(dateScore({ id: "a", ending: "second_date", best_line: "l", lines: 48 })).toBe(4);
    expect(dateScore({ id: "b", ending: "friends", best_line: null, lines: 0 })).toBe(0);
    expect(bestDate([])).toBeNull();
  });
});

describe("email links say they came from email", () => {
  it("tags the path, keeps an existing query, and falls back to the inbox", () => {
    expect(emailLink("https://botchelor.com", "/episodes/e")).toBe("https://botchelor.com/episodes/e?utm_source=email&utm_medium=digest");
    expect(emailLink("https://botchelor.com", "/episodes/e?play=1")).toBe("https://botchelor.com/episodes/e?play=1&utm_source=email&utm_medium=digest");
    expect(emailLink("https://botchelor.com", null)).toBe("https://botchelor.com/notifications?utm_source=email&utm_medium=digest");
  });
});

describe("the push prompt before a date airs", () => {
  it("asks about the airing on an unaired creator's date, and about texts once aired", () => {
    const page = readFileSync("app/episodes/[id]/page.tsx", "utf8");
    expect(page).toContain('title={episode.revealed ? "Tell me when they text" : "Tell me when it airs"}');
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** A public house date that aired `daysAgo` days ago with this ending and best line. */
async function airedDate(ending: "second_date" | "friends", daysAgo: number, bestLine: string) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id;
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  await t.db.query(`update episodes set visibility = 'public', ending = $2, best_line = $3, revealed_at = now() - make_interval(days => $4::int) where id = $1`, [ep.id, ending, bestLine, daysAgo]);
  return { owner: userIdOf(owner), id: ep.id as string };
}

/** Someone who opted into email, last here `daysAgo` days ago. */
async function optedIn(daysAgo: number) {
  const user = userIdOf(newUserCookie());
  await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at, updated_at) values ($1, $2, 'on', now(), now() - interval '40 days')`, [user, `${user.slice(0, 8)}@example.com`]);
  await t.db.query(`insert into owner_activity (user_id, last_seen) values ($1, now() - make_interval(days => $2::int)) on conflict (user_id) do update set last_seen = excluded.last_seen`, [user, daysAgo]);
  return user;
}

describe("the quiet-week nudge (lib/reengage.ts)", () => {
  it("picks the week's best public date, nudges only the quiet and opted-in, once a month, and nobody when nothing aired", async () => {
    expect(await nudgeQuietWeek(t.db)).toBe(0); // nothing aired this week: nobody is nudged
    const good = await airedDate("second_date", 2, "Fair winds, Barnaby.");
    await airedDate("friends", 1, "Meh."); // newer, scores lower
    await airedDate("second_date", 9, "Last week's."); // outside the week
    expect((await weekBestDate(t.db))?.id).toBe(good.id);

    const quiet = await optedIn(10);
    const active = await optedIn(2);
    const nudgedLately = await optedIn(12);
    await t.db.query(`insert into notifications (id, user_id, kind, title, created_at) values ('n-old', $1, 'week_best', 't', now() - interval '20 days')`, [nudgedLately]);
    expect(await quietPeople(t.db)).toEqual([quiet]);
    expect(await nudgeQuietWeek(t.db)).toBe(1);
    const { rows } = await t.db.query<{ user_id: string; title: string; body: string; link: string }>(`select user_id, title, body, link from notifications where kind = 'week_best' and id <> 'n-old'`);
    expect(rows).toEqual([{ user_id: quiet, title: expect.stringContaining("The best date this week: Pell Ardent ×"), body: "“Fair winds, Barnaby.” Watch how it ended.", link: `/episodes/${good.id}?play=1` }]);
    expect(rows[0].user_id).not.toBe(active);
    // Not again this month.
    expect(await nudgeQuietWeek(t.db)).toBe(0);
    expect(QUIET_WEEK_BATCH).toBeLessThanOrEqual(20);
  });
});

describe("the welcome notice", () => {
  it("lands once when an account is made, pointing at the builder", async () => {
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET); // accounts need signable sessions
    const cookie = newUserCookie();
    const res = await registerRoute(
      new Request(`${BASE_URL}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ handle: "cartographer", password: "a-long-enough-password-1", attest: true }) }),
    );
    expect(res.status).toBe(201);
    const { rows } = await t.db.query<{ kind: string; link: string; title: string }>(`select kind, link, title from notifications where user_id = $1`, [userIdOf(cookie)]);
    expect(rows).toEqual([{ kind: "welcome", link: "/create", title: "Welcome to Botchelor 👋" }]);
    expect(readFileSync("app/api/auth/google/callback/route.ts", "utf8")).toContain("if (isNew) await welcome(db, userId)");
    vi.unstubAllEnvs();
  });
});
