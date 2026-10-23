import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ua: "Mozilla/5.0 (Macintosh) Chrome/130" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers({ "user-agent": jar.ua }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import ShortPage from "@/app/after-dark/shorts/[id]/page";
import ShortsPage from "@/app/after-dark/shorts/page";
import { GET as callGet, POST as callPost } from "@/app/api/admin/after-dark/shorts/[id]/call/route";
import { POST as watchPost } from "@/app/api/admin/after-dark/shorts/[id]/watch/route";
import { PATCH as panelPatch } from "@/app/api/admin/after-dark/shorts/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { CALL_POINTS, callBoard, lineStages, outcomeOf, score, shortOutcome, type Outcome, type Picks } from "@/lib/adult/predictions";
import type { NightRow } from "@/lib/adult/shorts";
import { getPoints } from "@/lib/game";
import { seasonStanding } from "@/lib/leagues";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { A, admin, B, C, CH1, CH2, HISTORY, night, publishNight, req, session, subscriber, wholeNight } from "./after-dark-shorts-fixtures";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// Call it (lib/adult/predictions.ts): a call on a Short before it plays, settled from the recorded night at play.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  jar.ua = "Mozilla/5.0 (Macintosh) Chrome/130";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([A, B, C]);
  // Settling never asks a model: one that's called fails the test.
  setAdultModelForTests({
    complete: async () => {
      throw new Error("a model was asked");
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setAdultModelForTests(null);
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1));
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (id: string, body: unknown, cookie?: string, ua?: string) => callPost(req("POST", `/api/admin/after-dark/shorts/${id}/call`, body, cookie, ua), ctx(id));
const myCall = (id: string, cookie?: string) => callGet(req("GET", `/api/admin/after-dark/shorts/${id}/call`, undefined, cookie), ctx(id));
const watch = (id: string, cookie?: string) => watchPost(req("POST", `/api/admin/after-dark/shorts/${id}/watch`, {}, cookie), ctx(id));
const RIGHT: Picks = { first_move: "b", furthest: 2, their_place: "yes", second_night: "no" };

const row = (lines: unknown[], extra: Partial<NightRow> = {}): NightRow =>
  ({ id: "r", lines, place: null, stage: 0, date_setting: null, date_venue: null, set_place: null, chapter: 1, place_history: null, created_at: new Date(), ...extra }) as NightRow;

describe("the outcome, from the recorded night alone", () => {
  it("each line's stage is the one it was written at, or for an old line the furthest its words showed so far", () => {
    expect(lineStages([{ text: "Hi.", stage: 0 }, { text: "Hey.", stage: 1 }, { text: "Bye.", stage: 0 }])).toEqual([0, 1, 0]);
    expect(lineStages([{ text: "Hello there." }, { text: "*kisses her* Hi." }, { text: "We talk." }, { text: "*unbuttons his shirt*" }])).toEqual([0, 2, 2, 3]);
  });

  it("the first move is the first line past talking; how far, the furthest stage; their place, the night's last stop", () => {
    const o = outcomeOf([row(CH1, { place_history: HISTORY }), row(CH2, { place_history: HISTORY, stage: 2 })], false);
    expect(o).toEqual({ first_move: "b", furthest: 2, their_place: "yes", second_night: "no", first_line: 4, ended: "her flat" });
    // Nobody ever gets past talking, somewhere public.
    const talk = [CH1[0], CH1[1], CH1[2]];
    expect(outcomeOf([row(talk, { place_history: [{ place: "the bar", set: "the bar", home: null, chapter: 1 }] })], true)).toMatchObject({
      first_move: "neither",
      furthest: 0,
      their_place: "no",
      second_night: "yes",
      first_line: null,
      ended: "the bar",
    });
    // A night from before lines kept their stage: their words, and the chapter's own stage.
    expect(outcomeOf([row([{ who: "a", text: "Hello." }, { who: "b", text: "*kisses him*" }], { stage: 3 })], false)).toMatchObject({ first_move: "b", furthest: 3, their_place: "no" });
  });

  it("scores each right part; the bonus only when it was called", () => {
    const o: Outcome = { first_move: "b", furthest: 2, their_place: "yes", second_night: "no", first_line: 4, ended: "her flat" };
    expect(score(RIGHT, o)).toEqual({ first_move: 5, furthest: 10, their_place: 5, second_night: 5, total: 25 });
    expect(score({ ...RIGHT, second_night: null }, o).total).toBe(20);
    expect(score({ first_move: "a", furthest: 4, their_place: "no", second_night: "yes" }, o)).toEqual({ first_move: 0, furthest: 0, their_place: 0, second_night: 0, total: 0 });
    expect(CALL_POINTS).toEqual({ first_move: 5, furthest: 10, their_place: 5, second_night: 5 });
  });

  it("a second night is another night of theirs filed after this one and before the Short went up, the same for every viewer", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    await night(t.db, ad.id, { id: "before", chapter: 1, ago: 60 });
    const id = await publishNight(ad);
    expect((await shortOutcome(t.db, id))?.second_night).toBe("no");
    // A later night filed after it was published doesn't change it.
    await night(t.db, ad.id, { id: "after-publish", chapter: 1, ago: -5 });
    expect((await shortOutcome(t.db, id))?.second_night).toBe("no");
    // One filed between the night's end and publishing does.
    await night(t.db, ad.id, { id: "between", chapter: 1, ago: 10 });
    expect((await shortOutcome(t.db, id))?.second_night).toBe("yes");
  });
});

describe("making a call", () => {
  it("an entitled viewer calls a Short before playing it, can change the call, and it's free", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db);
    const first = await call(id, { first_move: "a", furthest: 4, their_place: "no" }, sub.cookie);
    expect(first.status).toBe(200);
    expect((await first.json()).call).toEqual({ picks: { first_move: "a", furthest: 4, their_place: "no", second_night: null }, settled: null });
    const changed = await (await call(id, { ...RIGHT }, sub.cookie)).json();
    expect(changed.call.picks).toEqual(RIGHT);
    expect((await (await myCall(id, sub.cookie)).json())).toEqual({ call: { picks: RIGHT, settled: null }, closed: null });
    expect(await t.count("orders")).toBe(0);
    expect(await t.db.query(`select count(*)::int as n from adult_usage`).then((r) => r.rows[0].n)).toBe(0);
  });

  it("refuses a bad call, and gives anyone After Dark isn't open to, a bot, or a Short that's down, not found", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db);
    for (const bad of [{ first_move: "c", furthest: 1, their_place: "yes" }, { first_move: "a", furthest: 5, their_place: "yes" }, { first_move: "a", furthest: 1 }, { first_move: "a", furthest: 1, their_place: "yes", second_night: "maybe" }]) {
      expect((await call(id, bad, sub.cookie)).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await call(id, RIGHT)).status).toBe(404);
    expect((await call(id, RIGHT, session(userIdOf(newUserCookie())))).status).toBe(404);
    expect((await call(id, RIGHT, sub.cookie, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).status).toBe(404);
    expect((await call("no-such-short", RIGHT, sub.cookie)).status).toBe(404);
    await panelPatch(req("PATCH", "/api/admin/after-dark/shorts", { id, published: false }, ad.cookie));
    expect((await call(id, RIGHT, sub.cookie)).status).toBe(404);
  });

  it("isn't for whoever wrote the night, or an admin (they can read every night)", async () => {
    const ad = await admin(t.db);
    const other = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const mine = await call(id, RIGHT, ad.cookie);
    expect(mine.status).toBe(403);
    expect((await mine.json()).error).toBe("own_short");
    expect((await (await call(id, RIGHT, other.cookie)).json()).error).toBe("admin");
  });
});

describe("pressing play settles it", () => {
  it("at once, from the recorded night (no model), and locks the call", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db);
    await call(id, { ...RIGHT, first_move: "a" }, sub.cookie);
    const res = await watch(id, sub.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toEqual({ first_move: "b", furthest: 2, their_place: "yes", second_night: "no", first_line: 4, ended: "her flat" });
    expect(body.call.settled.points).toEqual({ first_move: 0, furthest: 10, their_place: 5, second_night: 5, total: 20 });
    const stored = (await t.db.query<{ points: number; settled_at: Date | null }>(`select points, settled_at from adult_short_calls where user_id = $1`, [sub.id])).rows[0];
    expect(stored.points).toBe(20);
    expect(stored.settled_at).not.toBeNull();
    // Locked: no change once it's played, and playing again settles nothing twice.
    const late = await call(id, RIGHT, sub.cookie);
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("watched");
    expect((await (await watch(id, sub.cookie)).json()).call.settled.points.total).toBe(20);
    expect((await (await myCall(id, sub.cookie)).json()).closed).toMatch(/calls close when it plays/);
  });

  it("can't be called once watched, even by someone who never called it", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db);
    const res = await (await watch(id, sub.cookie)).json();
    expect(res.call).toBeNull();
    expect(res.outcome.furthest).toBe(2);
    expect((await call(id, RIGHT, sub.cookie)).status).toBe(409);
    expect(await t.db.query(`select count(*)::int as n from adult_short_calls`).then((r) => r.rows[0].n)).toBe(0);
  });
});

describe("the board", () => {
  async function played(name: string | undefined, picks: Picks, shortId: string) {
    const sub = await subscriber(t.db, name);
    await call(shortId, picks, sub.cookie);
    await watch(shortId, sub.cookie);
    return sub;
  }

  it("ranks this season's settled calls with the show's display names, ties sharing a place, and no user ids", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const top = await played("Night Owl", RIGHT, id);
    const tied = await played("Second Owl", { ...RIGHT, second_night: "yes" }, id);
    await played(undefined, { ...RIGHT, second_night: "yes" }, id);
    await played("Zero Owl", { first_move: "a", furthest: 4, their_place: "no", second_night: null }, id);
    const board = await callBoard(t.db, tied.id);
    expect(board.top).toEqual([
      { rank: 1, name: "Night Owl", points: 25, me: false },
      { rank: 2, name: "Second Owl", points: 20, me: true },
      { rank: 2, name: "Unnamed player", points: 20, me: false },
    ]);
    expect(board.me).toEqual({ rank: 2, name: "Second Owl", points: 20, me: true });
    expect(board.players).toBe(3);
    expect(JSON.stringify(board)).not.toContain(top.id);
    // Last month's calls don't count this month.
    await t.db.query(`update adult_short_calls set settled_at = now() - interval '40 days' where user_id = $1`, [top.id]);
    expect((await callBoard(t.db, null)).top.map((e) => e.name)).toEqual(["Second Owl", "Unnamed player"]);
    // A Short taken down takes its points off the board.
    await panelPatch(req("PATCH", "/api/admin/after-dark/shorts", { id, published: false }, ad.cookie));
    expect((await callBoard(t.db, null)).top).toEqual([]);
  });

  it("is apart from the show's: the points never count for the show's points, leagues or seasons", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await played("Night Owl", RIGHT, id);
    expect((await callBoard(t.db, sub.id)).me?.points).toBe(25);
    expect(await getPoints(t.db, sub.id)).toBe(0);
    expect(await seasonStanding(t.db, sub.id)).toEqual({ points: 0, place: null, players: 0 });
  });

  it("is free points only: no call or settle spends anything, nothing sells them, and only settling writes them", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = ["app", "lib"].flatMap((dir) => readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join(dir, f)));
    const writers = files.filter((f) => /(insert into|update|delete from)\s+adult_short_calls/.test(readFileSync(join(root, f), "utf8")));
    expect(writers).toEqual([join("lib", "adult", "predictions.ts")]);
    const predictions = readFileSync(join(root, "lib", "adult", "predictions.ts"), "utf8");
    for (const money of ["spendBoughtTokens", "refundBoughtTokens", "countUse", "orders", "stripe", "token"]) expect(predictions).not.toContain(money);
    const catalog = readFileSync(join(root, "lib", "catalog.ts"), "utf8").toLowerCase();
    expect(catalog).not.toMatch(/call it|after dark points|adult_short/);
  });
});

describe("the pages", () => {
  it("before play: the Call it card and none of the outcome; after: how the call went; the list shows the board", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db, "Night Owl");
    as(sub.cookie);
    const before = renderToStaticMarkup(await ShortPage({ params: Promise.resolve({ id }) }));
    expect(before).toContain("📣 Call it");
    expect(before).toContain("Who makes the first move?");
    for (const spoiler of ["How far it went", "The night: ", "her flat", "first_line"]) expect(before).not.toContain(spoiler);
    await call(id, RIGHT, sub.cookie);
    await watch(id, sub.cookie);
    const after = renderToStaticMarkup(await ShortPage({ params: Promise.resolve({ id }) }));
    expect(after).toContain("You called it: 25 points");
    expect(after).not.toContain("Who makes the first move?");
    const list = renderToStaticMarkup(await ShortsPage());
    expect(list).toContain("📣 Call it:");
    expect(list).toContain("Night Owl");
    // The teaser has no board.
    as(null);
    expect(renderToStaticMarkup(await ShortsPage())).not.toContain("Night Owl");
  });

  it("its owner sees what the calls settle against, with no card to call it", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    as(ad.cookie);
    const html = renderToStaticMarkup(await ShortPage({ params: Promise.resolve({ id }) }));
    expect(html).toContain("What viewers&#x27; calls settle against");
    expect(html).not.toContain("Who makes the first move?");
  });
});
