import { NextRequest } from "next/server";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The home page reads the viewer from next/headers (an anonymous visitor here).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));

import { POST as postDaily } from "@/app/api/daily/route";
import { GET as lobbyJob } from "@/app/api/jobs/lobby/route";
import DailyGame, { DailyResult } from "@/app/daily/DailyGame";
import DailyDayPage, { generateMetadata as dayMetadata } from "@/app/daily/[n]/page";
import DailyPage, { generateMetadata as dailyMetadata } from "@/app/daily/page";
import { beaconPath, beaconRef, configureFunnel, sendFunnel, SIGNAL_URL } from "@/app/funnel";
import Home from "@/app/page";
import sitemap from "@/app/sitemap";
import { chooseDaily, dailyEpisodeId, dailyPool, ensureDailyEpisodeId } from "@/lib/daily";
import {
  DAILY_PATH,
  DAILY_REF,
  DAILY_SHARE_PATH,
  dailyDayOf,
  dailyNumberAt,
  dailyShareText,
  dailyStreak,
  msUntilNextDaily,
  readDailyHistory,
  recordDailyPlay,
  SITE_CARD,
  type DailyReveal,
} from "@/lib/daily-shared";
import * as siteCard from "@/app/opengraph-image";
import { seedFrom } from "@/lib/engine";
import { ALL_HOUSE_CHARACTERS, HOUSE_CHARACTERS } from "@/lib/house";
import { setModelForTests } from "@/lib/model";
import { ENDING_LABELS, ENDINGS, REPORT_HIDE_THRESHOLD, type Ending } from "@/lib/rules";
import { staticSitemap } from "@/lib/seo";
import { middleware } from "@/middleware";
import { BASE_URL, startTestDb, validCharacter, api, newUserCookie } from "./helpers";

const house = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)!;
const RAFE = house("house-rafe");
const JUNIPER = house("house-juniper");
const DEX = house("house-dex");
const MARISOL = house("house-marisol");

/** React escapes quotes and apostrophes; the tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
/** 12:00 UTC (or `hour`) on Daily Date #n's day. */
const onDay = (n: number, hour = 12, minute = 0, second = 0) => new Date(`${dailyDayOf(n)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`);
/** The server's clock, frozen (only Date: PGlite keeps its own timers). */
function freeze(at: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}
const DAY = 20; // a day well after #1, so day - 1 and day + 1 exist

const renderToday = async () => text(renderToStaticMarkup((await DailyPage()) as ReactElement));
const renderDay = async (n: number | string) => text(renderToStaticMarkup((await DailyDayPage({ params: Promise.resolve({ n: String(n) }) })) as ReactElement));

/**
 * Everything a page hands on: every prop of every element in its tree, as JSON (what Next serialises for the browser's
 * components, the RSC payload). Functions and React's own bookkeeping are left out.
 */
function treeJson(node: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(node, (key, value) => {
    if (key.startsWith("_") || typeof value === "function" || typeof value === "symbol") return undefined;
    if (value && typeof value === "object") {
      if (seen.has(value)) return undefined;
      seen.add(value);
      if (isValidElement(value)) return { props: (value as ReactElement).props };
    }
    return value;
  });
}

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from daily_dates");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setModelForTests(null);
});

let seq = 0;
type Seeded = { id: string; ending: Ending; scenes: string[]; finale: string; bestLine: string; setting: string; a: string; b: string };
/**
 * A house-vs-house date as the lobby stores one (lib/watch.ts createTemplateParty), aired unless `aired: false`. Sample
 * text, each line unique to this date so a test can look for it.
 */
async function houseDate(
  opts: { a?: string; b?: string; ending: Ending; aired?: boolean; visibility?: "public" | "unlisted" | "private"; createdAt?: Date } = { ending: "friends" },
): Promise<Seeded> {
  const n = ++seq;
  const id = `daily-test-${n}`;
  const a = opts.a ?? RAFE.id;
  const b = opts.b ?? JUNIPER.id;
  const scenes = [
    `Scene one, take ${n}: the rain starts as the menus arrive and nobody minds.`,
    `Scene two, take ${n}: a power cut, one candle, and a story told in the dark.`,
    `Scene three, take ${n}: under the last streetlight they settle what tonight was.`,
  ];
  const finale = `Finale, take ${n}: one of them walks the other to the corner and says the thing.`;
  const bestLine = `Best line, take ${n}: you can't rush a good rise.`;
  const setting = `A lantern-lit pier, take ${n}`;
  const createdAt = opts.createdAt ?? new Date(Date.UTC(2026, 9, 1) + n * 60_000);
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at,
                           status, visibility, best_line, transcript, created_at)
     values ($1, 'system', $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, 'ready', $11, $12, '[]'::jsonb, $13)`,
    [
      id,
      a,
      b,
      setting,
      JSON.stringify(["To find out if there's a spark.", "To get through one evening without a ghost story."]),
      JSON.stringify(scenes),
      `The twist, take ${n}: the waiter is a regular on the podcast.`,
      finale,
      opts.ending,
      opts.aired === false ? null : new Date(createdAt.getTime() + 3_600_000),
      opts.visibility ?? "public",
      bestLine,
      createdAt,
    ],
  );
  return { id, ending: opts.ending, scenes, finale, bestLine, setting, a, b };
}
/** Stores the day's deal by hand, as an earlier visit (or the hourly job) would have. */
const deal = (n: number, episodeId: string) => t.db.query(`insert into daily_dates (day_number, episode_id) values ($1, $2)`, [n, episodeId]);
const daysEpisode = async (n: number) => (await t.db.query<{ episode_id: string }>(`select episode_id from daily_dates where day_number = $1`, [n])).rows[0]?.episode_id ?? null;

/** POST /api/daily, as the page's form sends it: no cookie, no account. */
async function pick(n: number, choice: string) {
  const res = await postDaily(new Request(`${BASE_URL}/api/daily`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n, pick: choice }) }));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

// Every variable that points the app at a model. The Daily Date must never need one.
const LLM_ENV = /^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_|VERCEL_OIDC)/;
function unsetEveryModel() {
  for (const key of Object.keys(process.env)) if (LLM_ENV.test(key)) vi.stubEnv(key, undefined);
  setModelForTests({ complete: async () => { throw new Error("the Daily Date called a model"); } });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("the Daily Date made a network call"); }));
}

describe("1. GET /daily for a logged-out visitor", () => {
  it("answers 200: an adult with no account, and a crawler, go straight through; anyone else meets the 18+ gate on the way back here", () => {
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    const adult = middleware(new NextRequest(`${BASE_URL}${DAILY_SHARE_PATH}`, { headers: { "user-agent": chrome, cookie: "bz_adult=1" } }));
    expect(adult.headers.get("x-middleware-next")).toBe("1");
    expect(adult.headers.get("location")).toBeNull();
    const googlebot = middleware(new NextRequest(`${BASE_URL}${DAILY_PATH}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } }));
    expect(googlebot.headers.get("x-middleware-next")).toBe("1");
    const fresh = middleware(new NextRequest(`${BASE_URL}${DAILY_SHARE_PATH}`, { headers: { "user-agent": chrome } }));
    expect(new URL(fresh.headers.get("location")!).searchParams.get("from")).toBe(DAILY_SHARE_PATH);
  });

  it("shows today's date number, both house characters' names and sheets, and a form with exactly three choices", async () => {
    const ep = await houseDate({ a: RAFE.id, b: JUNIPER.id, ending: "second_date" });
    freeze(onDay(DAY));
    const html = await renderToday();
    expect(html).toContain(`Daily Date #${DAY}`);
    expect(html).toContain(`data-daily="${DAY}"`);
    for (const c of [RAFE, JUNIPER]) {
      expect(html).toContain(c.name);
      expect(html).toContain(c.bio);
      for (const trait of c.traits) expect(html).toContain(`>${trait}<`);
      expect(html).toContain(c.want);
      // The sheet is the public card: a dealbreaker stays the show's secret, as on the character's own page.
      expect(html).not.toContain(c.dealbreaker);
    }
    expect(html).toContain(ep.setting);
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => r.includes('name="pick"'))).toBe(true);
    expect(radios.map((r) => r.match(/value="([^"]+)"/)?.[1])).toEqual([...ENDINGS]);
    expect(html.match(/<form[^>]*>/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Lock it in<\/button>/);
  });

  it("before a pick, carries neither the ending nor the last scene: not in the HTML, not in anything handed to the browser", async () => {
    // The same two characters on two days with different endings: the only thing between the two pages is the episode.
    const sweet = await houseDate({ a: RAFE.id, b: JUNIPER.id, ending: "second_date" });
    const sour = await houseDate({ a: RAFE.id, b: JUNIPER.id, ending: "disaster" });
    await deal(DAY, sweet.id);
    await deal(DAY + 1, sour.id);
    freeze(onDay(DAY));
    const tree = await DailyPage();
    const sweetHtml = text(renderToStaticMarkup(tree as ReactElement));
    freeze(onDay(DAY + 1));
    const sourHtml = await renderToday();
    for (const [ep, html] of [[sweet, sweetHtml], [sour, sourHtml]] as const) {
      expect(html).toContain(ep.setting); // it is the right day's page
      for (const secret of [ep.scenes[2], ep.scenes[1], ep.finale, ep.bestLine]) expect(html).not.toContain(secret);
      expect(html).not.toMatch(/data-ending=|"ending"/);
      expect(html).not.toContain(ENDING_LABELS[ep.ending] + ".");
    }
    // Each ending's value and label shows up just as often whatever the day's ending is: the form's three choices.
    for (const value of [...ENDINGS, ...Object.values(ENDING_LABELS)]) {
      expect(count(sweetHtml, value), value).toBe(count(sourHtml, value));
    }
    // What the page hands to its components (Next's RSC payload) has no ending and no scenes either.
    const handed = treeJson(tree);
    expect(handed).toContain(RAFE.name);
    for (const secret of [sweet.scenes[2], sweet.finale, sweet.bestLine, '"ending"', '"scenes"', "second_date"]) expect(handed).not.toContain(secret);
  });

  it("a day with nothing to deal yet still answers, plainly: no form, no made-up date", async () => {
    await houseDate({ ending: "friends", aired: false }); // not aired: not in the pool
    freeze(onDay(DAY));
    const html = await renderToday();
    expect(html).toContain(`Daily Date #${DAY}`);
    expect(html).toContain("still being filmed");
    expect(html).not.toContain('type="radio"');
    expect(await daysEpisode(DAY)).toBeNull();
  });
});

describe("2. one episode a UTC day, dealt from the house-cast pool and kept", () => {
  it("numbers days from #1 on 25 October 2026, by the UTC day", () => {
    expect(dailyNumberAt(new Date("2026-10-25T00:00:00Z"))).toBe(1);
    expect(dailyNumberAt(new Date("2026-10-25T23:59:59.999Z"))).toBe(1);
    expect(dailyNumberAt(new Date("2026-10-26T00:00:00Z"))).toBe(2);
    expect(dailyNumberAt(new Date("2026-10-25T23:30:00-05:00"))).toBe(2); // 04:30 UTC on the 26th
    expect(dailyDayOf(1)).toBe("2026-10-25");
    expect(dailyDayOf(dailyNumberAt(onDay(DAY)))).toBe(dailyDayOf(DAY));
    expect(msUntilNextDaily(Date.parse("2026-10-25T18:00:00Z"))).toBe(6 * 3_600_000);
  });

  it("the same UTC day always serves the same episode, from its first second to its last, whatever lands in the pool meanwhile", async () => {
    for (const ending of ["second_date", "friends", "disaster"] as const) await houseDate({ ending, a: DEX.id, b: MARISOL.id });
    freeze(onDay(DAY, 0, 0, 1));
    const first = await renderToday();
    const dealt = await daysEpisode(DAY);
    expect(dealt).not.toBeNull();
    await houseDate({ ending: "friends", a: RAFE.id, b: JUNIPER.id }); // a new date airs at noon
    freeze(onDay(DAY, 23, 59, 59));
    expect(await renderToday()).toBe(first);
    expect(await daysEpisode(DAY)).toBe(dealt);
    expect(await ensureDailyEpisodeId(t.db, DAY)).toBe(dealt);
  });

  it("a different day serves a different one", async () => {
    for (let i = 0; i < 3; i++) await houseDate({ ending: ENDINGS[i] });
    const dealt: string[] = [];
    for (const n of [DAY, DAY + 1, DAY + 2]) {
      freeze(onDay(n));
      await renderToday();
      dealt.push((await daysEpisode(n))!);
    }
    expect(new Set(dealt).size).toBe(3);
    // Once every date has had its day, a day still gets one, never yesterday's again.
    freeze(onDay(DAY + 3));
    await renderToday();
    const again = await daysEpisode(DAY + 3);
    expect(again).not.toBeNull();
    expect(again).not.toBe(dealt[2]);
  });

  it("is chosen deterministically: the day's seeded pick among the pool's dates not dealt yet, oldest first", async () => {
    const eps = [];
    for (let i = 0; i < 5; i++) eps.push(await houseDate({ ending: ENDINGS[i % 3], createdAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
    const pool = await dailyPool(t.db);
    expect(pool).toEqual(eps.map((e) => e.id));
    freeze(onDay(DAY));
    await renderToday();
    expect(await daysEpisode(DAY)).toBe(pool[seedFrom("daily-date", DAY) % pool.length]);
    // The next day draws from the four left.
    freeze(onDay(DAY + 1));
    await renderToday();
    const left = pool.filter((id) => id !== pool[seedFrom("daily-date", DAY) % pool.length]);
    expect(await daysEpisode(DAY + 1)).toBe(left[seedFrom("daily-date", DAY + 1) % left.length]);

    // The rule itself, pure: the same inputs give the same pick, unused dates first, then anything but yesterday's.
    const ids = ["a", "b", "c", "d"];
    expect(chooseDaily(ids, new Set(), null, 7)).toBe(chooseDaily([...ids], new Set(), null, 7));
    expect(chooseDaily(ids, new Set(["a", "b", "c"]), "c", 7)).toBe("d");
    const reused = chooseDaily(ids, new Set(ids), "b", 7);
    expect(ids.filter((id) => id !== "b")).toContain(reused);
    expect(chooseDaily(["only"], new Set(["only"]), "only", 7)).toBe("only");
    expect(chooseDaily([], new Set(), null, 7)).toBeNull();
    const spread = new Set(Array.from({ length: 30 }, (_, n) => chooseDaily(ids, new Set(), null, n + 1)));
    expect(spread.size).toBeGreaterThan(1);
  });

  it("only house-vs-house dates that aired publicly are in the pool", async () => {
    const good = await houseDate({ ending: "friends" });
    await houseDate({ ending: "friends", aired: false }); // still predictable on its own page: never spoiled here
    await houseDate({ ending: "friends", visibility: "private" });
    await houseDate({ ending: "friends", visibility: "unlisted" });
    const hidden = await houseDate({ ending: "friends" });
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) {
      await t.db.query(`insert into reports (episode_id, reporter_id, reason) values ($1, $2, 'other')`, [hidden.id, `reporter-${i}`]);
    }
    const replay = await houseDate({ ending: "friends" });
    await t.db.query(`update episodes set varies_episode_id = $1 where id = $2`, [good.id, replay.id]);
    // Nothing to tell: no scenes, or scenes stored as something other than a list (never an error for the rest).
    const bare = await houseDate({ ending: "friends" });
    const odd = await houseDate({ ending: "friends" });
    await t.db.query(`update episodes set scenes = '[]'::jsonb where id = $1`, [bare.id]);
    await t.db.query(`update episodes set scenes = '{"act": 1}'::jsonb where id = $1`, [odd.id]);
    // A person's OC on a date with a house character is theirs, not the show's.
    const cookie = newUserCookie();
    const oc = (await (await api.createCharacter(validCharacter({ name: "Mira Quell" }), cookie)).json()) as { id: string };
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility)
       values ('oc-date', 'someone', $1, $2, 'a diner', '[]'::jsonb, '["one","two","three"]'::jsonb, '', 'fin', 'friends', now(), 'ready', 'public')`,
      [oc.id, RAFE.id],
    );
    expect(await dailyPool(t.db)).toEqual([good.id]);
  });

  it("/daily/{n} serves a past day with its ending shown; today's number goes to /daily; a day to come or never dealt is a 404", async () => {
    const ep = await houseDate({ ending: "disaster", a: DEX.id, b: MARISOL.id });
    await deal(DAY, ep.id);
    freeze(onDay(DAY + 3));
    const html = await renderDay(DAY);
    expect(html).toContain(`Daily Date #${DAY}`);
    expect(html).toContain(DEX.name);
    expect(html).toContain(MARISOL.name);
    expect(html).toContain(`data-ending="disaster"`);
    expect(html).toContain(ENDING_LABELS.disaster);
    expect(html).toContain(ep.scenes[2]);
    expect(html).toContain(`href="/episodes/${ep.id}"`);
    expect(html).toContain(`href="${DAILY_PATH}"`); // and today's game
    const meta = await dayMetadata({ params: Promise.resolve({ n: String(DAY) }) });
    expect(String(meta.title)).toContain(`Botchelor Daily #${DAY}`);
    expect(meta.robots).toMatchObject({ index: false, follow: true });

    await expect(renderDay(DAY + 3)).rejects.toThrow(/NEXT_REDIRECT/); // today: the game, not the answer
    await expect(DailyDayPage({ params: Promise.resolve({ n: String(DAY + 3) }) })).rejects.toMatchObject({ digest: expect.stringContaining(DAILY_PATH) });
    for (const n of [DAY + 4, DAY + 1, 0, "007", "x", "1e3", "-2"]) {
      await expect(renderDay(n), String(n)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    }
  });

  it("works with every model variable unset once the day's episode is stored", async () => {
    const ep = await houseDate({ ending: "second_date" });
    await deal(DAY, ep.id);
    freeze(onDay(DAY));
    unsetEveryModel();
    const html = await renderToday();
    expect(html).toContain(RAFE.name);
    expect(html).toContain('value="second_date"');
    const { res, body } = await pick(DAY, "second_date");
    expect(res.status).toBe(200);
    expect(body.correct).toBe(true);
    freeze(onDay(DAY + 1));
    expect(await renderDay(DAY)).toContain(ep.scenes[2]);
  });

  it("a date taken off the air after it was dealt is dealt again today, and its past day is gone", async () => {
    const first = await houseDate({ ending: "friends" });
    const second = await houseDate({ ending: "disaster" });
    await deal(DAY, first.id);
    await deal(DAY - 1, second.id);
    await t.db.query(`update episodes set visibility = 'private' where id = any($1)`, [[first.id, second.id]]);
    const third = await houseDate({ ending: "second_date" });
    freeze(onDay(DAY));
    expect(await ensureDailyEpisodeId(t.db, DAY)).toBe(third.id);
    expect(await daysEpisode(DAY)).toBe(third.id);
    expect(await dailyEpisodeId(t.db, DAY - 1)).toBeNull();
    await expect(renderDay(DAY - 1)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("the hourly lobby job deals today's, so a day nobody visited still has its Daily Date", async () => {
    const ep = await houseDate({ ending: "friends" });
    const token = ["jobs", "A1b2C3d4".repeat(3)].join("-");
    vi.stubEnv("WATCH_ADMIN_TOKEN", token);
    vi.stubEnv("BOTCHELOR_PAUSE", "1"); // no fresh lobby room: this test is only about the Daily Date
    freeze(onDay(DAY, 0, 5));
    const res = await lobbyJob(new Request(`${BASE_URL}/api/jobs/lobby`, { headers: { "x-jobs-token": token } }));
    expect(res.status).toBe(200);
    expect((await res.json()).daily).toBe(DAY);
    expect(await daysEpisode(DAY)).toBe(ep.id);
  });
});

describe("3. a pick without an account reveals the date and keeps a streak", () => {
  it("POST /api/daily with a pick reveals the episode and says whether it was right, with no cookie and none set", async () => {
    const ep = await houseDate({ ending: "friends", a: DEX.id, b: MARISOL.id });
    freeze(onDay(DAY));
    await renderToday();
    const right = await pick(DAY, "friends");
    expect(right.res.status).toBe(200);
    expect(right.res.headers.get("set-cookie")).toBeNull();
    expect(right.body).toMatchObject({ n: DAY, pick: "friends", correct: true, ending: "friends", ending_label: ENDING_LABELS.friends, episode_path: `/episodes/${ep.id}` });
    expect(right.body.scenes).toEqual(ep.scenes);
    expect(right.body.best_line).toBe(ep.bestLine);
    const wrong = await pick(DAY, "disaster");
    expect(wrong.body).toMatchObject({ correct: false, pick: "disaster", ending: "friends" });
    expect(await t.count("predictions")).toBe(0); // nothing is kept about the visitor
  });

  it("refuses a pick that isn't one of the three, a day nobody dealt, and a day still to come", async () => {
    const ep = await houseDate({ ending: "friends" });
    await deal(DAY, ep.id);
    freeze(onDay(DAY));
    expect((await pick(DAY, "married")).res.status).toBe(422);
    expect((await pick(0, "friends")).res.status).toBe(422);
    expect((await pick(DAY - 1, "friends")).res.status).toBe(404);
    expect((await pick(DAY + 1, "friends")).res.status).toBe(404);
    // A past day's answer is public on /daily/{n} anyway, so it can still be checked.
    freeze(onDay(DAY + 2));
    expect((await pick(DAY, "friends")).body.correct).toBe(true);
  });

  it("the streak: two right days in a row is 2; a wrong day, or a day missed, starts it over", () => {
    let h = recordDailyPlay({}, DAY, { pick: "friends", correct: true });
    expect(dailyStreak(h, DAY)).toBe(1);
    h = recordDailyPlay(h, DAY + 1, { pick: "disaster", correct: true });
    expect(dailyStreak(h, DAY + 1)).toBe(2);
    expect(dailyStreak(recordDailyPlay(h, DAY + 2, { pick: "friends", correct: false }), DAY + 2)).toBe(0);
    expect(dailyStreak(recordDailyPlay(h, DAY + 3, { pick: "friends", correct: true }), DAY + 3)).toBe(1); // DAY + 2 missed
    // Before today's pick, the streak so far is yesterday's.
    expect(dailyStreak(h, DAY + 2 - 1)).toBe(2);
  });

  it("reads what's stored in the browser defensively, and keeps it small", () => {
    expect(readDailyHistory(null)).toEqual({});
    expect(readDailyHistory("not json")).toEqual({});
    expect(readDailyHistory(JSON.stringify([1, 2]))).toEqual({});
    expect(readDailyHistory(JSON.stringify({ 3: { pick: "friends", correct: true }, 4: { pick: "married", correct: true }, x: { pick: "friends", correct: true }, 5: { pick: "disaster" } }))).toEqual({
      3: { pick: "friends", correct: true },
    });
    let h = {};
    for (let n = 1; n <= 500; n++) h = recordDailyPlay(h, n, { pick: "friends", correct: true });
    expect(Object.keys(h).length).toBeLessThanOrEqual(400);
    expect(dailyStreak(h, 500)).toBeGreaterThanOrEqual(365);
    expect(readDailyHistory(JSON.stringify(h))).toEqual(h);
  });

  it("the game's first render is the form, with no streak and no result", () => {
    const html = text(renderToStaticMarkup(createElement(DailyGame, { n: DAY, shareUrl: `https://botchelor.com${DAILY_SHARE_PATH}` })));
    expect(html.match(/<input[^>]*type="radio"[^>]*name="pick"/g)).toHaveLength(3);
    expect(html).not.toContain("Streak:");
    expect(html).not.toContain("Copy result");
  });
});

describe("4. Copy result: a spoiler-free line to share", () => {
  const url = `https://botchelor.com${DAILY_SHARE_PATH}`;
  const everyName = ALL_HOUSE_CHARACTERS.flatMap((c) => [c.name, ...c.name.split(" ")]);

  it("has the number, a right-or-wrong emoji, the streak and a link ending in /daily?ref=daily, and no ending or name", () => {
    for (const correct of [true, false]) {
      const line = dailyShareText({ n: DAY, correct, streak: correct ? 2 : 0, url });
      expect(line).toContain(`Botchelor Daily #${DAY}`);
      expect(line).toContain(correct ? "✅" : "❌");
      expect(line).not.toContain(correct ? "❌" : "✅");
      expect(line).toContain(`Streak: ${correct ? 2 : 0}`);
      expect(line.trim().split(/\s+/).at(-1)).toMatch(/\/daily\?ref=daily$/);
      for (const ending of ENDINGS) {
        expect(line).not.toContain(ending);
        expect(line.toLowerCase()).not.toContain(ENDING_LABELS[ending].toLowerCase());
      }
      expect(line.toLowerCase()).not.toMatch(/second|friends|disaster/);
      for (const name of everyName) expect(line).not.toContain(name);
    }
  });

  it("the result shows the verdict, Streak: 2 and a Copy result button over exactly that line", () => {
    const reveal: DailyReveal = {
      n: DAY,
      pick: "friends",
      correct: true,
      ending: "friends",
      ending_label: ENDING_LABELS.friends,
      scenes: ["Act one.", "Act two.", "Act three."],
      finale: "The finale.",
      best_line: "A best line.",
      why: "Why it ended that way.",
      episode_path: "/episodes/x",
      names: [RAFE.name, JUNIPER.name],
    };
    const html = text(renderToStaticMarkup(createElement(DailyResult, { reveal, streak: 2, shareUrl: url })));
    expect(html).toContain("Streak: 2");
    expect(html).toContain("✅");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Copy result<\/button>/);
    const shared = html.match(/<pre[^>]*data-share[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    expect(shared).toBe(dailyShareText({ n: DAY, correct: true, streak: 2, url }));
    expect(html).toContain('href="/episodes/x"');
    expect(html).toContain("Act three.");
  });
});

describe("5. findable and measured", () => {
  it("has an og:title with 'Botchelor Daily', a title and a canonical link to /daily", async () => {
    freeze(onDay(DAY));
    const meta = await dailyMetadata();
    expect(String(meta.openGraph?.title)).toContain("Botchelor Daily");
    expect(String(meta.openGraph?.title)).toContain(`#${DAY}`);
    expect(String(meta.title)).toContain("Botchelor Daily");
    expect(meta.alternates?.canonical).toBe(DAILY_PATH);
    expect(String(meta.description)).not.toMatch(/Rafe|Juniper/);
    // Its own openGraph drops the inherited image, so it names the site's card, which gives nothing away.
    expect(meta.openGraph?.images).toEqual([SITE_CARD]);
    expect(SITE_CARD).toMatchObject({ url: "/opengraph-image", ...siteCard.size, alt: siteCard.alt });
  });

  it("is listed in sitemap.xml", async () => {
    const base = "https://botchelor.com";
    expect(staticSitemap(base).map((e) => e.url)).toContain(`${base}${DAILY_PATH}`);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    expect((await sitemap()).map((e) => e.url)).toContain(`${base}${DAILY_PATH}`);
  });

  it("the home page links to it above the fold: first in the hero, before its heading", async () => {
    freeze(onDay(DAY));
    const home = text(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) })));
    const hero = home.slice(home.indexOf('<section class="hero"'), home.indexOf("</section>"));
    const link = hero.match(/<a[^>]*href="\/daily"[^>]*>([\s\S]*?)<\/a>/);
    expect(link).not.toBeNull();
    expect(link![1]).toContain(`Daily Date #${DAY}`);
    // Ahead of the heading, so the first screen has it on a phone and a desktop alike (the e2e measures it in Chromium).
    expect(hero.indexOf('href="/daily"')).toBeLessThan(hero.indexOf("<h1"));
    expect(home.indexOf('href="/daily"')).toBeLessThan(home.indexOf('href="/create"'));
  });

  /** A browser for app/funnel.ts: production, a real visitor, at `href`. */
  function browserAt(href: string) {
    const page = new URL(href);
    const store = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    };
    const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { cookie: "", referrer: "https://www.reddit.com/" });
    vi.stubGlobal("location", { origin: page.origin, pathname: page.pathname, search: page.search });
    vi.stubGlobal("navigator", { webdriver: false });
    vi.stubGlobal("sessionStorage", store());
    vi.stubGlobal("localStorage", store());
    vi.stubGlobal("fetch", send);
    configureFunnel({ production: true, consentDefault: true });
    return () => send.mock.calls.map(([to, init]) => ({ url: to, body: JSON.parse(String(init.body)) }));
  }

  it("loading /daily?ref=daily sends one `visit` to the RepoHQ beacon with ref=daily", () => {
    const sent = browserAt(`https://botchelor.com${DAILY_SHARE_PATH}`);
    sendFunnel("visit");
    sendFunnel("visit"); // once per browser session
    expect(sent()).toEqual([{ url: SIGNAL_URL, body: { slug: "botchelor", kind: "visit", path: DAILY_PATH, referrer: "https://www.reddit.com/", ref: DAILY_REF } }]);
  });

  it("counts the tag through the 18+ gate too, and only on a visit", () => {
    expect(beaconRef("/gate", `?from=${encodeURIComponent(DAILY_SHARE_PATH)}`)).toBe(DAILY_REF);
    expect(beaconPath("/gate", `?from=${encodeURIComponent(DAILY_SHARE_PATH)}`)).toBe(DAILY_PATH);
    expect(beaconRef(DAILY_PATH, "")).toBeNull();
    expect(beaconRef(DAILY_PATH, "?ref=DAILY")).toBeNull();
    const sent = browserAt(`https://botchelor.com${DAILY_SHARE_PATH}`);
    sendFunnel("activate");
    sendFunnel("checkout");
    for (const event of sent()) expect(event.body).not.toHaveProperty("ref");
  });
});
