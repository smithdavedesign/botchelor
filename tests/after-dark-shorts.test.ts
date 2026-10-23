import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the viewer and the user agent from next/headers: hand them this jar.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ua: "Mozilla/5.0 (Macintosh) Chrome/130" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers({ "user-agent": jar.ua }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import ShortPage from "@/app/after-dark/shorts/[id]/page";
import ShortsPage from "@/app/after-dark/shorts/page";
import { GET as mediaGet } from "@/app/api/admin/after-dark/shorts/[id]/media/[mediaId]/route";
import { POST as watchPost } from "@/app/api/admin/after-dark/shorts/[id]/watch/route";
import { GET as panelGet, PATCH as panelPatch, POST as panelPost } from "@/app/api/admin/after-dark/shorts/route";
import { spoken } from "@/lib/adult/reels";
import { dropForeignActions } from "@/lib/adult/scenes";
import { filmed, groupNights, listShorts, teaserShorts, viewShort, type NightRow } from "@/lib/adult/shorts";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// After Dark Shorts (lib/adult/shorts.ts): an admin's whole night of two house characters, published as an episode.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const [A, B, C, OFF] = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id).sort();
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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const session = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: session(id) };
}
/** Someone After Dark is open to who isn't an admin: an active subscription and a passed age check. */
async function subscriber() {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: session(id) };
}
const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) {
    const at = cookie.indexOf("=");
    jar.cookies.set(cookie.slice(0, at), cookie.slice(at + 1));
  }
};

const req = (method: string, path: string, body?: unknown, cookie?: string, ua?: string) =>
  new Request(`${BASE_URL}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(ua ? { "user-agent": ua } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const publish = (body: unknown, cookie?: string) => panelPost(req("POST", "/api/admin/after-dark/shorts", body, cookie));
const toggle = (body: unknown, cookie?: string) => panelPatch(req("PATCH", "/api/admin/after-dark/shorts", body, cookie));
const panel = (a: string, b: string, cookie?: string) => panelGet(req("GET", `/api/admin/after-dark/shorts?a=${a}&b=${b}`, undefined, cookie));
const watch = (id: string, cookie?: string, ua?: string) => watchPost(req("POST", `/api/admin/after-dark/shorts/${id}/watch`, {}, cookie, ua), { params: Promise.resolve({ id }) });
const media = (id: string, mediaId: string, cookie?: string) => mediaGet(req("GET", `/api/admin/after-dark/shorts/${id}/media/${mediaId}`, undefined, cookie), { params: Promise.resolve({ id, mediaId }) });

/** A line with the owner's private notes on it, as a scene step stores it: none of these may reach a viewer. */
const line = (who: "a" | "b", text: string, extra: Record<string, unknown> = {}) => ({ who, text, why: `PRIVATE-WHY ${text}`, memory: "PRIVATE-MEMORY", fact_ids: ["PRIVATE-FACT"], stage: 0, ...extra });
const CH1 = [
  line("a", "*smiles* You kept me waiting by the railing."),
  line("b", "Seven boats. I counted every one of them."),
  line("a", "Then I owe you a cup of my terrible tea."),
  line("b", "Terrible how? Weak, or a crime against leaves?"),
  line("a", "*takes her hand* A crime, but a warm one.", { stage: 1 }),
  line("b", "Then I'm staying for the crime.", { stage: 1 }),
  line("a", "Shall we go up to mine? It's warmer.", { stage: 1 }),
  line("b", "Yes. Lead the way.", { stage: 1, moved_to: "his flat" }),
];
const CH2 = [
  line("a", "*kisses her* Welcome to the flat.", { stage: 2 }),
  line("b", "It's smaller than you said.", { stage: 2 }),
  line("a", "The view makes up for it.", { stage: 2 }),
  line("b", "*leans on the window* It does.", { stage: 2 }),
];
const HISTORY = [
  { place: "the harbour", set: "the harbour", home: null, chapter: 1 },
  { place: "his flat", set: "his flat", home: "a", chapter: 1 },
];

/** A saved chapter (adult_nights), filed `ago` minutes ago. */
async function night(owner: string, opts: { id: string; a?: string; b?: string; chapter?: number | null; lines?: unknown[]; ago?: number; history?: unknown[] }) {
  const [a, b] = [opts.a ?? A, opts.b ?? B].sort();
  await t.db.query(
    `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, chapter, place_history, set_place, created_at)
     values ($1, $2, $3, $4, $5::jsonb, 'his flat', 2, $6, $7::jsonb, 'his flat', now() - ($8 || ' minutes')::interval)`,
    [opts.id, owner, a, b, JSON.stringify(opts.lines ?? CH1), opts.chapter === undefined ? 1 : opts.chapter, JSON.stringify(opts.history ?? HISTORY), String(opts.ago ?? 10)],
  );
}
/** The admin's two-chapter night of A and B, finished (Start over set the scene back to chapter 1). */
async function wholeNight(owner: string) {
  await night(owner, { id: "n1", chapter: 1, lines: CH1, ago: 30 });
  await night(owner, { id: "n2", chapter: 2, lines: CH2, ago: 20 });
  await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, chapter) values ('s1', $1, $2, $3, 1)`, [owner, A, B]);
}
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function image(id: string, owner: string, kind: string, opts: { a?: string; b?: string | null; mime?: string; ago?: number } = {}) {
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, created_at)
     values ($1, $2, $3, $4, $5, 'PG placeholder', $6, $7, 'ready', now() - ($8 || ' minutes')::interval)`,
    [id, owner, opts.a ?? A, opts.b === undefined ? B : opts.b, kind, opts.mime ?? "image/png", PNG, String(opts.ago ?? 25)],
  );
}
/** A video of the night that filmed CH1's second and fifth lines, with its keyframes and voices. */
async function videoOfChapter1(owner: string, id = "reel-1", kind = "night") {
  const shot = (n: number, who: "a" | "b", i: number) => ({
    line: i,
    who,
    text: spoken(dropForeignActions(CH1[i].text)).speech,
    motion: "PG",
    status: "ready",
    media_id: `${id}-vid-${n}`,
    audio_id: `${id}-aud-${n}`,
    frame_id: `${id}-frm-${n}`,
  });
  const shots = [shot(1, "b", 1), shot(2, "a", 4), { line: 6, who: "a", text: "x", motion: "PG", status: "discarded" }];
  await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind) values ($1, $2, $3, $4, 'ready', 0, $5::jsonb, $6)`, [id, owner, A, B, JSON.stringify(shots), kind]);
  for (const n of [1, 2]) {
    await image(`${id}-vid-${n}`, owner, "video", { mime: "video/mp4" });
    await image(`${id}-aud-${n}`, owner, "audio", { mime: "audio/wav" });
    await image(`${id}-frm-${n}`, owner, "frame");
  }
}
async function published(owner: { id: string; cookie: string }, extra: Record<string, unknown> = {}) {
  const res = await publish({ a: A, b: B, night_id: "n1", title: "The harbour, then his flat", cover_id: "cover-1", ...extra }, owner.cookie);
  expect(res.status).toBe(201);
  return (await res.json()).short as { id: string; night_id: string; videos: number; published: boolean };
}

describe("a night is its chapters, filed one after another", () => {
  const row = (id: string, chapter: number | null, at: number): NightRow => ({
    id, chapter, lines: [], place: null, stage: 0, date_setting: null, date_venue: null, set_place: null, place_history: null, created_at: new Date(at * 60_000),
  });
  it("chapter 1 (or a night from before chapters) starts one; the next chapter carries it on; the latest is running while the scene is on its next chapter", () => {
    const rows = [row("old", null, 1), row("x1", 1, 2), row("x2", 2, 3), row("x3", 3, 4), row("y1", 1, 5), row("z1", 1, 6), row("z2", 2, 7)];
    const groups = groupNights(rows, { chapter: 3 });
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([["old"], ["x1", "x2", "x3"], ["y1"], ["z1", "z2"]]);
    expect(groups.map((g) => g.complete)).toEqual([true, true, true, false]);
    expect(groups[1].since?.getTime()).toBe(60_000);
    // Start over put the scene back on chapter 1: the latest night ended.
    expect(groupNights(rows, { chapter: 1 }).at(-1)!.complete).toBe(true);
    expect(groupNights(rows, null).at(-1)!.complete).toBe(true);
    // A gap (chapter 2 rewound away) never joins two nights.
    expect(groupNights([row("p1", 1, 1), row("p3", 3, 2)], null).map((g) => g.id)).toEqual(["p1", "p3"]);
  });

  it("a video filmed a chapter when every shot that came through says its line, by the same one, at its place", () => {
    const lines = [{ who: "a" as const, text: "*smiles* Hello there." }, { who: "b" as const, text: "Hi." }];
    const ok = { line: 0, who: "a" as const, text: "Hello there.", motion: "", status: "ready" as const, media_id: "v" };
    expect(filmed(lines, [ok, { ...ok, line: 1, who: "b", text: "Hi." }])).toBe(true);
    expect(filmed(lines, [ok, { ...ok, status: "failed", media_id: undefined, line: 9 }])).toBe(true);
    expect(filmed(lines, [{ ...ok, who: "b" }])).toBe(false);
    expect(filmed(lines, [{ ...ok, text: "Goodbye." }])).toBe(false);
    expect(filmed(lines, [{ ...ok, status: "failed" }])).toBe(false);
  });
});

describe("publishing a Short", () => {
  it("an admin publishes a whole night of two house characters: its chapters in order, its cover, the video that filmed it", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    await image("cover-1", ad.id, "scene", { ago: 28 });
    await videoOfChapter1(ad.id);
    await videoOfChapter1(ad.id, "clip-1", "clip");
    const panelRes = await panel(A, B, ad.cookie);
    expect(panelRes.status).toBe(200);
    const p = (await panelRes.json()).panel;
    expect(p.allowed).toBe(true);
    expect(p.nights).toHaveLength(1);
    expect(p.nights[0]).toMatchObject({ id: "n1", chapters: 2, lines: CH1.length + CH2.length, complete: true, cover: "cover-1", videos: 1, short: null });
    expect(p.covers.map((c: { id: string }) => c.id)).toContain("cover-1");
    // Publishing from any of its chapters publishes the whole night.
    const res = await publish({ a: B, b: A, night_id: "n2", title: "The harbour, then his flat", cover_id: "cover-1" }, ad.cookie);
    expect(res.status).toBe(201);
    const short = (await res.json()).short;
    expect(short).toMatchObject({ night_id: "n1", title: "The harbour, then his flat", cover_id: "cover-1", videos: 1, published: true });
    const row = (await t.db.query<{ night_ids: string[]; reel_ids: string[]; character_a: string }>(`select night_ids, reel_ids, character_a from adult_shorts where id = $1`, [short.id])).rows[0];
    expect(row).toEqual({ night_ids: ["n1", "n2"], reel_ids: ["reel-1"], character_a: A });
    // Without the video, if asked; and publishing again changes it in place (one Short a night).
    const again = await (await publish({ a: A, b: B, night_id: "n1", title: "A new title", cover_id: null, video: false }, ad.cookie)).json();
    expect(again.short).toMatchObject({ id: short.id, title: "A new title", cover_id: null, videos: 0 });
    expect(await t.db.query(`select 1 from adult_shorts`).then((r) => r.rows.length)).toBe(1);
  });

  it("is an admin's only: a stranger, a signed-in member, a subscriber and an old unsigned cookie get not found", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    const short = await published(ad, { cover_id: null });
    const sub = await subscriber();
    const member = session(userIdOf(newUserCookie()));
    for (const cookie of [undefined, member, sub.cookie, `bz_uid=${ad.id}`]) {
      expect((await panel(A, B, cookie)).status).toBe(404);
      expect((await publish({ a: A, b: B, night_id: "n1", title: "Mine now" }, cookie)).status).toBe(404);
      expect((await toggle({ id: short.id, published: false }, cookie)).status).toBe(404);
    }
    // Nor for an admin while After Dark isn't available here (on Vercel without its settings).
    vi.stubEnv("VERCEL", "1");
    expect((await panel(A, B, ad.cookie)).status).toBe(404);
  });

  it("is this season's house cast only: someone's own character, or a house character off this season, is refused", async () => {
    const ad = await admin();
    const own = (await (await api.createCharacter(validCharacter({ name: "Ira Fenn" }), newUserCookie())).json()).id as string;
    await night(ad.id, { id: "own-1", a: A, b: own, lines: CH1 });
    await night(ad.id, { id: "off-1", a: A, b: OFF, lines: CH1 });
    expect((await (await panel(A, own, ad.cookie)).json()).panel).toMatchObject({ allowed: false, nights: [] });
    expect((await publish({ a: A, b: own, night_id: "own-1", title: "Not a Short" }, ad.cookie)).status).toBe(409);
    expect((await publish({ a: A, b: OFF, night_id: "off-1", title: "Not a Short" }, ad.cookie)).status).toBe(409);
    expect((await publish({ a: A, b: A, night_id: "own-1", title: "Not a Short" }, ad.cookie)).status).toBe(409);
    // A published Short whose character has left the season's cast stays up, but can't be put back up once it's down.
    await wholeNight(ad.id);
    const short = await published(ad, { cover_id: null });
    expect((await toggle({ id: short.id, published: false }, ad.cookie)).status).toBe(200);
    setSeasonCastForTests([A, C]);
    expect((await toggle({ id: short.id, published: true }, ad.cookie)).status).toBe(409);
  });

  it("is a whole night of the admin's own: one still running, another admin's, or one too short is refused", async () => {
    const ad = await admin();
    const other = await admin();
    await night(ad.id, { id: "run-1", chapter: 1, lines: CH1 });
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, chapter) values ('s1', $1, $2, $3, 2)`, [ad.id, A, B]);
    const running = await publish({ a: A, b: B, night_id: "run-1", title: "Still going" }, ad.cookie);
    expect(running.status).toBe(409);
    expect((await running.json()).error).toBe("night_running");
    expect((await (await panel(A, B, ad.cookie)).json()).panel.nights[0]).toMatchObject({ id: "run-1", complete: false });
    await night(other.id, { id: "theirs-1", lines: CH1 });
    expect((await publish({ a: A, b: B, night_id: "theirs-1", title: "Not mine" }, ad.cookie)).status).toBe(404);
    await night(ad.id, { id: "short-1", a: A, b: C, lines: CH1.slice(0, 3) });
    expect((await (await publish({ a: A, b: C, night_id: "short-1", title: "Too short" }, ad.cookie)).json()).error).toBe("too_short");
  });

  it("keeps the title PG (it shows on the teaser) and inside the two lines", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    const tries: [string, number, string][] = [
      ["Naked in his kitchen", 422, "title_not_pg"],
      ["Sex on the harbour wall", 422, "title_not_pg"],
      ["When she was sixteen", 422, "title_refused"],
      ["   ", 400, "invalid_title"],
    ];
    for (const [title, status, error] of tries) {
      const res = await publish({ a: A, b: B, night_id: "n1", title }, ad.cookie);
      expect(res.status, title).toBe(status);
      expect((await res.json()).error, title).toBe(error);
    }
    expect(await t.db.query(`select 1 from adult_shorts`).then((r) => r.rows.length)).toBe(0);
  });

  it("takes as its cover only one of the admin's own pictures of the two of them (stored only once they passed the check)", async () => {
    const ad = await admin();
    const other = await admin();
    await wholeNight(ad.id);
    await image("both", ad.id, "scene");
    await image("frame", ad.id, "frame", { a: B, b: A });
    await image("alone", ad.id, "baseline", { b: null });
    await image("theirs", other.id, "scene");
    await image("clip", ad.id, "video", { mime: "video/mp4" });
    await image("others", ad.id, "scene", { b: C });
    // A video's keyframe had only the age question (lib/adult/check.ts "keyframe"): not a cover until its shot has
    // passed moderation and been kept.
    expect((await publish({ a: A, b: B, night_id: "n1", title: "Fine", cover_id: "frame" }, ad.cookie)).status).toBe(422);
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, source_image) values ('frame-shot', $1, $2, $3, 'video', 'PG placeholder', 'video/mp4', $4, 'ready', 'frame')`,
      [ad.id, B, A, PNG],
    );
    for (const cover of ["both", "frame"]) expect((await publish({ a: A, b: B, night_id: "n1", title: "Fine", cover_id: cover }, ad.cookie)).status, cover).toBe(201);
    for (const cover of ["alone", "theirs", "clip", "others", "nope"]) expect((await publish({ a: A, b: B, night_id: "n1", title: "Fine", cover_id: cover }, ad.cookie)).status, cover).toBe(422);
  });

  it("can be taken down (the undo) and put back up: down, viewers and the teaser don't see it; its owner still does", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    await image("cover-1", ad.id, "scene");
    const short = await published(ad);
    const sub = await subscriber();
    expect((await listShorts(t.db)).map((s) => s.id)).toEqual([short.id]);
    const down = await (await toggle({ id: short.id, published: false }, ad.cookie)).json();
    expect(down.short.published).toBe(false);
    expect(await listShorts(t.db)).toEqual([]);
    expect(await teaserShorts(t.db)).toEqual([]);
    expect((await watch(short.id, sub.cookie)).status).toBe(404);
    expect((await media(short.id, "cover-1", sub.cookie)).status).toBe(404);
    expect(await viewShort(t.db, sub.id, short.id)).toBeNull();
    expect((await viewShort(t.db, ad.id, short.id))?.episode?.chapters).toHaveLength(2);
    as(null);
    await expect(ShortPage({ params: Promise.resolve({ id: short.id }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    const up = await (await toggle({ id: short.id, published: true }, ad.cookie)).json();
    expect(up.short.published).toBe(true);
    expect((await watch(short.id, sub.cookie)).status).toBe(200);
    // Only its owner can take it down.
    const other = await admin();
    expect((await toggle({ id: short.id, published: false }, other.cookie)).status).toBe(404);
  });
});

describe("watching a Short", () => {
  it("an entitled viewer gets the card first and the night only once they press play; no private note ever goes", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    await image("cover-1", ad.id, "scene");
    await videoOfChapter1(ad.id);
    const short = await published(ad);
    const sub = await subscriber();
    const before = await viewShort(t.db, sub.id, short.id);
    expect(before).toMatchObject({ id: short.id, watched: false, episode: null, lines: CH1.length + CH2.length, video: true });
    const res = await watch(short.id, sub.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ep = body.short.episode;
    expect(ep.chapters.map((c: { chapter: number }) => c.chapter)).toEqual([1, 2]);
    expect(ep.chapters[0].lines[0]).toEqual({ who: "a", text: CH1[0].text, stage: 0 });
    expect(ep.chapters[0].lines.at(-1)).toEqual({ who: "b", text: "Yes. Lead the way.", stage: 1 });
    expect(ep.video).toHaveLength(2);
    expect(ep.video[0]).toEqual({
      video: `/api/admin/after-dark/shorts/${short.id}/media/reel-1-vid-1`,
      audio: `/api/admin/after-dark/shorts/${short.id}/media/reel-1-aud-1`,
      poster: `/api/admin/after-dark/shorts/${short.id}/media/reel-1-frm-1`,
      text: spoken(CH1[1].text).speech,
      who: "b",
    });
    const sent = JSON.stringify(body);
    for (const secret of ["PRIVATE-WHY", "PRIVATE-MEMORY", "PRIVATE-FACT", "moved_to", "fact_ids", "place_history", '"why"', '"memory"']) expect(sent).not.toContain(secret);
    // Watched now: the page has it from the start, once, free (no tokens, no usage counted).
    expect((await viewShort(t.db, sub.id, short.id))?.episode?.chapters).toHaveLength(2);
    expect((await watch(short.id, sub.cookie)).status).toBe(200);
    expect(await t.db.query(`select count(*)::int as n from adult_short_views`).then((r) => r.rows[0].n)).toBe(1);
    expect(await t.count("orders")).toBe(0);
    expect(await t.db.query(`select count(*)::int as n from adult_usage`).then((r) => r.rows[0].n)).toBe(0);
  });

  it("serves its cover to any entitled viewer, its video's files only once they've pressed play, and nothing else", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    await image("cover-1", ad.id, "scene");
    await image("elsewhere", ad.id, "scene");
    await videoOfChapter1(ad.id);
    const short = await published(ad);
    const sub = await subscriber();
    expect((await media(short.id, "cover-1", sub.cookie)).status).toBe(200);
    expect((await media(short.id, "cover-1", sub.cookie)).headers.get("cache-control")).toContain("private");
    for (const f of ["reel-1-vid-1", "reel-1-aud-1", "reel-1-frm-2"]) expect((await media(short.id, f, sub.cookie)).status, f).toBe(404);
    await watch(short.id, sub.cookie);
    const vid = await media(short.id, "reel-1-vid-1", sub.cookie);
    expect(vid.status).toBe(200);
    expect(vid.headers.get("content-type")).toBe("video/mp4");
    expect((await media(short.id, "reel-1-aud-2", sub.cookie)).status).toBe(200);
    // Not another picture of theirs, by this Short's route; and nothing to anyone After Dark isn't open to.
    expect((await media(short.id, "elsewhere", sub.cookie)).status).toBe(404);
    for (const cookie of [undefined, session(userIdOf(newUserCookie()))]) expect((await media(short.id, "cover-1", cookie)).status).toBe(404);
    // Its owner has it all without pressing play.
    expect((await media(short.id, "reel-1-vid-2", ad.cookie)).status).toBe(200);
  });

  it("gives a bot nothing, and anyone After Dark isn't open to nothing to play", async () => {
    const ad = await admin();
    await wholeNight(ad.id);
    const short = await published(ad, { cover_id: null });
    expect((await watch(short.id, ad.cookie, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).status).toBe(404);
    expect((await watch(short.id, ad.cookie, "GPTBot/1.2")).status).toBe(404);
    expect((await watch(short.id)).status).toBe(404);
    expect((await watch(short.id, session(userIdOf(newUserCookie())))).status).toBe(404);
    expect(await t.db.query(`select count(*)::int as n from adult_short_views`).then((r) => r.rows[0].n)).toBe(0);
  });
});

describe("the pages", () => {
  async function seeded() {
    const ad = await admin();
    await wholeNight(ad.id);
    await image("cover-1", ad.id, "scene");
    await videoOfChapter1(ad.id);
    const short = await published(ad);
    return { ad, short };
  }
  const list = async () => renderToStaticMarkup(await ShortsPage());
  const one = async (id: string) => renderToStaticMarkup(await ShortPage({ params: Promise.resolve({ id }) }));
  /** As React writes text into HTML. */
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const NIGHT_WORDS = [...CH1, ...CH2].map((l) => esc(dropForeignActions(l.text).replace(/^\*[^*]+\*\s*/, "").slice(0, 24)));

  it("anyone After Dark isn't open to gets the teaser: the PG title, the names, the length, filler under the blur; never a line, a picture or a video", async () => {
    const { short } = await seeded();
    for (const cookie of [null, session(userIdOf(newUserCookie()))]) {
      as(cookie);
      for (const html of [await list(), await one(short.id)]) {
        expect(html).toContain("The harbour, then his flat");
        expect(html).toContain("Subscribe to unlock");
        expect(html).toContain('href="/after-dark/subscribe"');
        expect(html).toContain("ad-blur");
        expect(html).toContain(`${CH1.length + CH2.length} lines`);
        for (const words of NIGHT_WORDS) expect(html).not.toContain(words);
        for (const leak of ["/media/", "cover-1", "reel-1", "PRIVATE", "<video", "▶ Play"]) expect(html).not.toContain(leak);
      }
    }
  });

  it("an entitled viewer gets the list with covers, and a Short with ▶ Play and none of the night until they press it", async () => {
    const { short } = await seeded();
    const sub = await subscriber();
    as(sub.cookie);
    const html = await list();
    expect(html).toContain(`/api/admin/after-dark/shorts/${short.id}/media/cover-1`);
    expect(html).toContain("with its video");
    expect(html).not.toContain("Subscribe to unlock");
    const page = await one(short.id);
    expect(page).toContain("▶ Play");
    for (const words of NIGHT_WORDS) expect(page).not.toContain(words);
    await watch(short.id, sub.cookie);
    const after = await one(short.id);
    expect(after).toContain("Chapter 1");
    expect(after).toContain("Chapter 2");
    expect(after).toContain("Seven boats. I counted every one of them.");
    // Every line, written as the page writes it (so the checks for their absence above mean something).
    for (const words of NIGHT_WORDS) expect(after).toContain(words);
    expect(after).toContain("The night&#x27;s video");
    expect(after).not.toContain("PRIVATE");
    expect(await list()).toContain("watched");
  });

  it("gives a bot not found, a Short that doesn't exist not found, and the owner the undo", async () => {
    const { ad, short } = await seeded();
    jar.ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    as(null);
    await expect(list()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(one(short.id)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    jar.ua = "Mozilla/5.0 (Macintosh) Chrome/130";
    await expect(one("no-such-short")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    as(ad.cookie);
    const mine = await one(short.id);
    expect(mine).toContain("Take it down");
    // The owner reads it without pressing play.
    expect(mine).toContain("Seven boats. I counted every one of them.");
  });
});
