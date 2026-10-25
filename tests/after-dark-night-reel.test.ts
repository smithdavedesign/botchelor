import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { runAdultTool } from "@/lib/adult/mcp";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { byFiling, chaptersLabel, groupNights, runningNight } from "@/lib/adult/nights";
import { acrossChapters, DIRECTOR_MAX_LINES, listReels, pickShots, reelCast, reelNight, setReelFetchForTests, setReelPausesForTests, settleIfDone, shareOut, type Reel, type ReelShot } from "@/lib/adult/reels";
import { filmedNight, nightVideos, type NightRow } from "@/lib/adult/shorts";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// A video of the whole night (lib/adult/reels.ts, David 2026-10-23): the director model and the media providers are
// stubbed, and every line is a neutral placeholder.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const PAIR = [CAST_A, CAST_B].sort() as [string, string];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const make = (cookie: string, body: Record<string, unknown> = {}) => call(reelPost, "/api/admin/after-dark/reel", { a: CAST_A, b: CAST_B, ...body }, cookie);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };

/** `n` neutral placeholder lines of chapter `c`, turn about. */
const linesOf = (c: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*nods* Placeholder line ${i} of chapter ${c} goes here.` }));

async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

/** After Dark set up (stub keys), each one's baseline, and the pair's scene opened. */
async function ready(cookie: string, owner: string) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", reel_shots: 3, auto_scene_pictures: false }, cookie);
  for (const [pid, c] of [["base-a", CAST_A], ["base-b", CAST_B]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, owner, c, Buffer.from(PNG)]);
  }
  expect((await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).status).toBe(200);
}

/** A saved chapter, filed `ago` minutes ago. */
async function saved(owner: string, id: string, chapter: number | null, lines: unknown[], ago: number, extra: { place?: string; set?: string; stage?: number; history?: unknown[] } = {}) {
  await t.db.query(
    `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, set_place, stage, chapter, place_history, created_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, now() - make_interval(mins => $11))`,
    [id, owner, ...PAIR, JSON.stringify(lines), extra.place ?? null, extra.set ?? null, extra.stage ?? 0, chapter, JSON.stringify(extra.history ?? []), ago],
  );
}

/** The running scene: its chapter, lines and where it is now. */
async function sceneAt(owner: string, chapter: number, lines: unknown[], extra: { place?: string; set?: string; stage?: number; history?: unknown[] } = {}) {
  await t.db.query(
    `update adult_scenes set chapter = $4, lines = $5::jsonb, place = $6, set_place = $7, stage = $8, place_history = $9::jsonb where owner_id = $1 and character_a = $2 and character_b = $3`,
    [owner, ...PAIR, chapter, JSON.stringify(lines), extra.place ?? null, extra.set ?? null, extra.stage ?? 0, JSON.stringify(extra.history ?? [])],
  );
}

/** Venice's keyframes and video queue, recorded; Hive passes everything. */
function fakeMedia() {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
  return seen;
}

/** The director, stubbed: it records what it was asked and picks these lines. */
function director(lines: number[] | null) {
  const asked: string[] = [];
  setAdultModelForTests({
    complete: async (msgs) => {
      asked.push(msgs.map((m) => m.content).join("\n"));
      return lines ? JSON.stringify({ shots: lines.map((line) => ({ line, frame: "", motion: "" })) }) : "not json";
    },
  });
  return asked;
}

describe("a night is every chapter since it began", () => {
  it("gathers the saved chapters and the one being written, in order, and stops at a Start over", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    // An earlier night (chapters 1 and 2, then Start over), then tonight: chapter 1 saved, the scene on chapter 2.
    await saved(id, "old-1", 1, linesOf(1, 7), 50);
    await saved(id, "old-2", 2, linesOf(2, 7), 40);
    await saved(id, "now-1", 1, linesOf(1, 12), 10, { place: "the harbour", set: "harbour", stage: 2, history: [{ place: "the harbour", set: "harbour", home: null, chapter: 1 }] });
    await sceneAt(id, 2, linesOf(2, 8), { place: "his flat", set: "his flat", stage: 4 });
    const night = (await reelNight(t.db, id, CAST_A, CAST_B, null, "night"))!;
    expect(night.scope).toBe("night");
    expect(night.chapters).toEqual([
      { chapter: 1, night_id: "now-1", lines: 12 },
      { chapter: 2, night_id: null, lines: 8 },
    ]);
    expect(night.lines).toHaveLength(20);
    expect(night.lines[0].text).toContain("line 0 of chapter 1");
    expect(night.lines[12].text).toContain("line 0 of chapter 2");
    expect(night.chapterOf.slice(10, 14)).toEqual([0, 0, 1, 1]);
    // Each line where its own chapter had it, and as far as its chapter had gone.
    expect(night.places[0]).toBe("harbour");
    expect(night.places[19]).toBe("his flat");
    expect([night.stages[0], night.stages[19]]).toEqual([2, 4]);
    // Where it stands now is the latest chapter's; the place history is the night's.
    expect(night.where).toMatchObject({ place: "his flat", set: "his flat", stage: 4 });
    expect(night.where.history.map((s) => s.place)).toEqual(["the harbour"]);
    // A saved chapter's whole night: its own chapters only, ended by the Start over.
    const before = (await reelNight(t.db, id, CAST_A, CAST_B, "old-1", "night"))!;
    expect(before.chapters.map((c) => c.night_id)).toEqual(["old-1", "old-2"]);
    // Start over: the scene is back on chapter 1, and tonight's chapters are a night that ended.
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, chapter, created_at) values ('now-2', $1, $2, $3, $4::jsonb, 2, now() - interval '1 minute')`, [id, ...PAIR, JSON.stringify(linesOf(2, 8))]);
    await sceneAt(id, 1, linesOf(1, 6));
    const fresh = (await reelNight(t.db, id, CAST_A, CAST_B, null, "night"))!;
    expect(fresh.chapters).toEqual([{ chapter: 1, night_id: null, lines: 6 }]);
    expect(fresh.scope).toBe("chapter");
  });

  it("one chapter is as it was: the running scene's lines and place, or one saved chapter's", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await saved(id, "now-1", 1, linesOf(1, 12), 10, { place: "the harbour", set: "harbour", stage: 2 });
    const history = [
      { place: "the harbour", set: "harbour", home: null, chapter: 1 },
      { place: "his flat", set: "his flat", home: null, chapter: 2 },
    ];
    await sceneAt(id, 2, linesOf(2, 8), { place: "his flat", set: "his flat", stage: 4, history });
    const chapter = (await reelNight(t.db, id, CAST_A, CAST_B))!;
    expect(chapter.scope).toBe("chapter");
    expect(chapter.lines.map((l) => l.text)).toEqual(linesOf(2, 8).map((l) => l.text));
    expect(chapter.where).toEqual({ place: "his flat", set: "his flat", history, date: null, stage: 4 });
    expect(chapter.chapters).toEqual([{ chapter: 2, night_id: null, lines: 8 }]);
    const one = (await reelNight(t.db, id, CAST_A, CAST_B, "now-1"))!;
    expect(one.lines).toHaveLength(12);
    expect(one.where).toMatchObject({ place: "the harbour", set: "harbour", stage: 2 });
    // Someone else's chapter: not found.
    expect(await reelNight(t.db, (await admin()).id, CAST_A, CAST_B, "now-1", "night")).toBeNull();
  });

  it("the page says the same: the running night's chapters, and how a video's read", () => {
    const at = (m: number) => new Date(m * 60_000).toISOString();
    const saved = [
      { id: "y2", chapter: 2, created_at: at(4), lines: 120 },
      { id: "y1", chapter: 1, created_at: at(3), lines: 121 },
      { id: "x1", chapter: 1, created_at: at(1), lines: 30 },
    ];
    expect(runningNight(saved, { chapter: 3, lines: 8 })).toEqual([
      { chapter: 1, night_id: "y1", lines: 121 },
      { chapter: 2, night_id: "y2", lines: 120 },
      { chapter: 3, night_id: null, lines: 8 },
    ]);
    // Just after a chapter closed: the chapters saved so far.
    expect(runningNight(saved, { chapter: 3, lines: 0 }).map((c) => c.chapter)).toEqual([1, 2]);
    // After Start over: only the scene.
    expect(runningNight(saved, { chapter: 1, lines: 4 })).toEqual([{ chapter: 1, night_id: null, lines: 4 }]);
    expect(groupNights(byFiling(saved), { chapter: 3 }).map((g) => g.rows.map((r) => r.id))).toEqual([["x1"], ["y1", "y2"]]);
    expect(chaptersLabel([{ chapter: 1 }, { chapter: 2 }])).toBe("Whole night, chapters 1–2");
    expect(chaptersLabel([{ chapter: 2 }])).toBe("Chapter 2");
  });
});

describe("the director picks across the whole night", () => {
  it("numbers the lines straight through the chapters and labels each by its own", async () => {
    const [ca, cb] = await Promise.all([loadCharacter(t.db, CAST_A), loadCharacter(t.db, CAST_B)]);
    const cast = reelCast(ca!, cb!);
    const lines = [...linesOf(1, 12), ...linesOf(2, 8)];
    const chapterOf = lines.map((_, i) => (i < 12 ? 0 : 1));
    const asked = director([3, 9, 15]);
    const picks = await pickShots(t.db, lines, 3, cast, lines.map(() => "the harbour"), lines.map(() => 2), { chapterOf, chapters: [{ chapter: 1 }, { chapter: 2 }] });
    expect(picks.map((p) => p.line)).toEqual([3, 9, 15]);
    expect(asked[0]).toContain("The whole night, in 2 chapters one after another, its lines numbered straight through: Chapter 1 is lines 0–11; Chapter 2 is lines 12–19.");
    expect(asked[0]).toContain(`0 | chapter 1 | ${cast[0].tag} | the harbour | kissing | (nods) Placeholder line 0 of chapter 1 goes here.`);
    expect(asked[0]).toContain(`12 | chapter 2 | ${cast[0].tag} |`);
    expect(asked[0]).toContain("its strongest moments across all of its chapters, how it opens, how it builds, its peak");
    expect(asked[0]).toContain("at least one from each chapter, not only the latest chapter");
    // One chapter: the prompt as it was, no chapter column.
    const one = director([1, 4, 7]);
    await pickShots(t.db, linesOf(2, 8), 3, cast, linesOf(2, 8).map(() => "the harbour"), linesOf(2, 8).map(() => 2));
    expect(one[0]).toContain(`0 | ${cast[0].tag} | the harbour | kissing |`);
    expect(one[0]).not.toContain("chapter 2 |");
  });

  it("cuts a night too long for the prompt fairly across its chapters, and falls back per chapter", async () => {
    const [ca, cb] = await Promise.all([loadCharacter(t.db, CAST_A), loadCharacter(t.db, CAST_B)]);
    const cast = reelCast(ca!, cb!);
    // Three full chapters and a short fourth: more than the director is shown.
    const sizes = [125, 120, 120, 9];
    const lines = sizes.flatMap((n, c) => linesOf(c + 1, n));
    const chapterOf = sizes.flatMap((n, c) => Array.from({ length: n }, () => c));
    const night = { chapterOf, chapters: sizes.map((_, c) => ({ chapter: c + 1 })) };
    const asked = director(null);
    const picks = await pickShots(t.db, lines, 6, cast, lines.map(() => null), lines.map(() => 1), night);
    const shown = [...asked[0].matchAll(/^(\d+) \| chapter (\d) \|/gm)].map((m) => ({ i: Number(m[1]), chapter: Number(m[2]) }));
    expect(shown).toHaveLength(DIRECTOR_MAX_LINES);
    expect(asked[0]).toContain("It's long, so only some of each chapter's lines are here.");
    // Every chapter is there to pick from, about its share: the short one too.
    const per = [1, 2, 3, 4].map((c) => shown.filter((s) => s.chapter === c).length);
    expect(per.every((n) => n > 0)).toBe(true);
    expect(per[3]).toBeGreaterThanOrEqual(3);
    expect(Math.max(...per.slice(0, 3)) - Math.min(...per.slice(0, 3))).toBeLessThanOrEqual(3);
    // Still numbered across the night, in order.
    expect(shown.map((s) => s.i)).toEqual([...shown.map((s) => s.i)].sort((p, q) => p - q));
    // The model's reply couldn't be read: the spread, per chapter, so the first chapter isn't lost.
    expect(new Set(picks.map((p) => chapterOf[p.line]))).toEqual(new Set([0, 1, 2, 3]));
    expect(picks).toHaveLength(6);
    expect(shareOut([125, 120, 120, 9], 6).reduce((t, n) => t + n, 0)).toBe(6);
    expect(shareOut([10, 0, 10], 30)).toEqual([10, 0, 10]);
    // Fewer shots than chapters: spread across the night, past the middle.
    expect(shareOut([5, 5, 5, 5], 2)).toEqual([1, 0, 0, 1]);
    expect(acrossChapters([{ i: 0 }, { i: 1 }, { i: 2 }], 2, [0, 0, 1]).map((x) => x.i)).toEqual([1, 2]);
  });
});

describe("a video of the whole night", () => {
  async function tonight(owner: string) {
    await saved(owner, "now-1", 1, linesOf(1, 12), 10, { place: "the harbour", set: "harbour", stage: 2, history: [{ place: "the harbour", set: "harbour", home: null, chapter: 1 }] });
    await sceneAt(owner, 2, linesOf(2, 8), {
      place: "his flat",
      set: "his flat",
      stage: 4,
      history: [
        { place: "the harbour", set: "harbour", home: null, chapter: 1 },
        { place: "his flat", set: "his flat", home: null, chapter: 2 },
      ],
    });
  }

  it("is the default with more than one chapter: each shot in its own chapter's place, dressed for its own stage, and the row records it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await tonight(id);
    const seen = fakeMedia();
    const asked = director([2, 9, 15]);
    const res = await make(cookie);
    expect(res.status).toBe(200);
    const reel = (await res.json()).reel as Reel;
    expect(asked[0]).toContain("Chapter 1 is lines 0–11; Chapter 2 is lines 12–19.");
    expect(reel.scope).toBe("night");
    expect(reel.chapters).toEqual([
      { chapter: 1, night_id: "now-1", lines: 12 },
      { chapter: 2, night_id: null, lines: 8 },
    ]);
    expect(reel.shots.map((s) => [s.line, s.chapter, s.night_id, s.chapter_line])).toEqual([
      [2, 1, "now-1", 2],
      [9, 1, "now-1", 9],
      [15, 2, null, 3],
    ]);
    const prompts = seen.filter((s) => s.path === "/image/multi-edit").map((e) => String(e.body.prompt));
    const harbour = prompts.filter((p) => p.includes("The place: harbour."));
    const flat = prompts.filter((p) => p.includes("The place: his flat."));
    expect([harbour.length, flat.length]).toEqual([2, 1]);
    for (const p of harbour) expect(p).toContain("both fully clothed");
    expect(flat[0]).toContain("both are nude unless the moment says otherwise");
    const row = (await t.db.query<{ scope: string; chapters: unknown }>(`select scope, chapters from adult_reels where id = $1`, [reel.id])).rows[0];
    expect(row).toEqual({ scope: "night", chapters: reel.chapters });
    expect((await listReels(t.db, id, CAST_A, CAST_B))[0]).toMatchObject({ scope: "night", chapters: reel.chapters });
  });

  it("films just this chapter when asked, a saved chapter as before, and a single chapter is a chapter", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await tonight(id);
    fakeMedia();
    let asked = director([1, 4, 7]);
    const chapter = (await (await make(cookie, { scope: "chapter" })).json()).reel as Reel;
    expect(chapter.scope).toBe("chapter");
    expect(chapter.chapters).toEqual([{ chapter: 2, night_id: null, lines: 8 }]);
    expect(chapter.shots.every((s) => s.chapter === undefined)).toBe(true);
    expect(asked[0]).not.toContain("chapter 1");
    await t.db.query(`update adult_reels set status = 'ready'`);
    // A saved chapter from Their nights, on its own.
    asked = director([1, 4, 7]);
    const one = (await (await make(cookie, { night_id: "now-1", scope: "chapter" })).json()).reel as Reel;
    expect(one).toMatchObject({ scope: "chapter", chapters: [{ chapter: 1, night_id: "now-1", lines: 12 }] });
    expect(asked[0]).toContain("Placeholder line 11 of chapter 1");
    await t.db.query(`update adult_reels set status = 'ready'`);
    // Neither "chapter" nor "night": refused.
    expect((await make(cookie, { scope: "everything" })).status).toBe(422);
    // After Start over there's one chapter: the default films it, as a chapter.
    await t.db.query(`update adult_scenes set chapter = 1, lines = $1::jsonb`, [JSON.stringify(linesOf(1, 7))]);
    director([1, 3, 5]);
    expect(((await (await make(cookie)).json()).reel as Reel).scope).toBe("chapter");
  });

  it("over MCP: the whole night by default, the chapter when asked", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await tonight(id);
    // MCP's scenes are the first admin's: this one.
    await t.db.query(`delete from admins where user_id <> $1`, [id]);
    fakeMedia();
    director([2, 9, 15]);
    const night = (await runAdultTool(t.db, "after_dark_reel", { a: CAST_A, b: CAST_B })) as { data: { reel: Reel } };
    expect(night.data.reel).toMatchObject({ scope: "night", chapters: [{ chapter: 1 }, { chapter: 2 }] });
    await t.db.query(`update adult_reels set status = 'ready'`);
    director([1, 4, 7]);
    const chapter = (await runAdultTool(t.db, "after_dark_reel", { a: CAST_A, b: CAST_B, scope: "chapter" })) as { data: { reel: Reel } };
    expect(chapter.data.reel).toMatchObject({ scope: "chapter", chapters: [{ chapter: 2, night_id: null, lines: 8 }] });
    expect(await runAdultTool(t.db, "after_dark_reel", { a: CAST_A, b: CAST_B, scope: "all" })).toEqual({ error: expect.stringMatching(/^scope is "night"/) });
  });

  it("is a Short's video for the chapters it filmed, the running one matched to the chapter filed since", () => {
    const row = (id: string, chapter: number, n: number): NightRow => ({
      id, chapter, lines: linesOf(chapter, n), place: null, stage: 0, date_setting: null, date_venue: null, set_place: null, place_history: null, created_at: new Date(chapter * 60_000),
    });
    const rows = [row("c1", 1, 12), row("c2", 2, 9)];
    const shot = (chapter: number, at: number, night_id: string | null): ReelShot => ({
      line: at + (chapter === 2 ? 12 : 0), chapter, night_id, chapter_line: at, who: at % 2 ? "b" : "a", text: `Placeholder line ${at} of chapter ${chapter} goes here.`, motion: "", status: "ready", media_id: `m${chapter}${at}`,
    });
    expect(filmedNight(rows, [shot(1, 2, "c1"), shot(2, 3, null)])).toEqual(new Set(["c1", "c2"]));
    // A shot whose line isn't there (another night's): not this night's video.
    expect(filmedNight(rows, [shot(1, 2, "c1"), shot(2, 11, null)])).toBeNull();
    expect(filmedNight(rows, [{ ...shot(1, 2, "c1"), chapter_line: undefined }])).toBeNull();
  });

  it("is found as the night's video when the night is published", async () => {
    const { id } = await admin();
    await saved(id, "c1", 1, linesOf(1, 12), 10);
    await saved(id, "c2", 2, linesOf(2, 9), 5);
    const shots = [
      { line: 2, chapter: 1, night_id: "c1", chapter_line: 2, who: "a", text: "Placeholder line 2 of chapter 1 goes here.", motion: "", status: "ready", media_id: "m1" },
      { line: 15, chapter: 2, night_id: null, chapter_line: 3, who: "b", text: "Placeholder line 3 of chapter 2 goes here.", motion: "", status: "ready", media_id: "m2" },
    ];
    await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, scope, chapters) values ('whole', $1, $2, $3, 'ready', 0, $4::jsonb, 'night', '[]'::jsonb)`, [id, ...PAIR, JSON.stringify(shots)]);
    const rows = (await t.db.query<NightRow>(`select id, lines, place, stage, date_setting, date_venue, set_place, chapter, place_history, created_at from adult_nights order by created_at`)).rows;
    expect(await nightVideos(t.db, id, PAIR, rows)).toEqual(["whole"]);
  });
});

describe("the storyboard: plan, draw, then film", () => {
  it("plans with no media or tokens, draws the pictures, then films — each step in turn", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await sceneAt(id, 1, linesOf(1, 8), { place: "the harbour", set: "harbour", stage: 2 });
    const seen = fakeMedia();
    director([2, 4, 6]);

    // Plan: a draft, every shot picked but not drawn, and nothing drawn or queued.
    const plan = (await (await make(cookie, { action: "plan" })).json()).reel as Reel;
    expect(plan.status).toBe("draft");
    expect(plan.shots.map((s) => s.status)).toEqual(["planned", "planned", "planned"]);
    expect(plan.shots.every((s) => s.place === "harbour" && s.stage === 2)).toBe(true);
    expect(plan.shots.every((s) => !s.media_id)).toBe(true);
    expect(seen).toHaveLength(0);
    // A draft stays out of the pair's videos until it's filmed.
    expect(await listReels(t.db, id, CAST_A, CAST_B)).toHaveLength(0);

    // Draw: the keyframes are drawn and kept, the draft is still a draft, no video is queued.
    const drawn = (await (await make(cookie, { action: "draw", id: plan.id })).json()).reel as Reel;
    expect(drawn.status).toBe("draft");
    expect(drawn.shots.map((s) => s.status)).toEqual(["frame_ready", "frame_ready", "frame_ready"]);
    expect(drawn.shots.every((s) => s.media_id && s.frame_id)).toBe(true);
    expect(seen.filter((s) => s.path === "/image/multi-edit")).toHaveLength(3);
    expect(seen.filter((s) => s.path === "/video/queue")).toHaveLength(0);

    // Drawing again is a no-op: the frames are kept, nothing is redrawn.
    await make(cookie, { action: "draw", id: plan.id });
    expect(seen.filter((s) => s.path === "/image/multi-edit")).toHaveLength(3);

    // The movie can't be made until every kept shot is approved.
    const notYet = await make(cookie, { action: "film", id: plan.id });
    expect(notYet.status).toBe(409);
    expect((await notYet.json()).error).toBe("needs_approval");

    // Redraw one shot to the owner's own words: it's drawn again (its words lead the keyframe), approval cleared.
    const first = drawn.shots[0].media_id!;
    const redrawn = (await (await make(cookie, { action: "redraw", id: plan.id, media_id: first, custom: "she leans in close" })).json()).reel as Reel;
    expect(redrawn.shots[0]).toMatchObject({ status: "frame_ready", approved: false });
    expect(seen.filter((s) => s.path === "/image/multi-edit")).toHaveLength(4); // one more draw, just that shot
    expect(String(seen.filter((s) => s.path === "/image/multi-edit").at(-1)!.body.prompt)).toContain("Most important, do exactly this: she leans in close.");

    // Approve all, then film: the videos are queued and the draft becomes a reel being made.
    const approved = (await (await make(cookie, { action: "approve", id: plan.id, media_id: null, approved: true })).json()).reel as Reel;
    expect(approved.shots.filter((s) => s.status === "frame_ready").every((s) => s.approved)).toBe(true);
    const filmed = (await (await make(cookie, { action: "film", id: plan.id })).json()).reel as Reel;
    expect(filmed.status).toBe("making");
    expect(filmed.shots.map((s) => s.status)).toEqual(["queued", "queued", "queued"]);
    expect(seen.filter((s) => s.path === "/video/queue")).toHaveLength(3);
    // It's now in the pair's videos.
    expect((await listReels(t.db, id, CAST_A, CAST_B)).map((r) => r.id)).toContain(plan.id);

    // Filming again is refused: it's no longer a draft.
    expect((await make(cookie, { action: "film", id: plan.id })).status).toBe(409);
  });

  it("per shot: the lines before it, the owner's words draw just that one, a picture of theirs starts one, and a finished shot films again", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await sceneAt(id, 1, linesOf(1, 8), { place: "the harbour", set: "harbour", stage: 2 });
    const seen = fakeMedia();
    director([2, 4, 6]);
    const plan = (await (await make(cookie, { action: "plan" })).json()).reel as Reel;
    // Where in the night each one is: up to five lines before its own.
    expect(plan.shots[0].before?.map((l) => l.text)).toEqual([0, 1].map((i) => `*nods* Placeholder line ${i} of chapter 1 goes here.`));
    expect(plan.shots[2].before).toHaveLength(5);
    expect(plan.shots[2].before?.[4]).toMatchObject({ who: "b", text: expect.stringContaining("line 5 of") });

    // The owner's words on a shot not drawn yet: only that one is drawn, to their words.
    const one = (await (await make(cookie, { action: "redraw", id: plan.id, shot: 1, custom: "she pulls him closer by the collar" })).json()).reel as Reel;
    expect(one.shots.map((s) => s.status)).toEqual(["planned", "frame_ready", "planned"]);
    expect(one.shots[1]).toMatchObject({ custom: "she pulls him closer by the collar", approved: false });
    const edits = seen.filter((x) => x.path === "/image/multi-edit");
    expect(edits).toHaveLength(1);
    expect(String(edits[0].body.prompt)).toContain("she pulls him closer by the collar");
    // Words that cross a line are refused, and nothing is drawn.
    expect((await make(cookie, { action: "redraw", id: plan.id, shot: 0, custom: "she says she's sixteen" })).status).toBe(422);

    // A picture of the two of them they already have starts a shot: nothing drawn, it needs approving.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data) values ('theirs-1', $1, $2, $3, 'scene', 'p', 'image/png', $4)`, [id, CAST_A, CAST_B, Buffer.from(PNG)]);
    const picked = (await (await make(cookie, { action: "use_picture", id: plan.id, shot: 0, image_id: "theirs-1" })).json()).reel as Reel;
    expect(picked.shots[0]).toMatchObject({ status: "frame_ready", media_id: "theirs-1", frame_id: "theirs-1", from_picture: true, approved: false });
    expect(seen.filter((x) => x.path === "/image/multi-edit")).toHaveLength(1);
    // Someone else's picture isn't theirs to use.
    const other = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data) values ('not-theirs', $1, $2, $3, 'scene', 'p', 'image/png', $4)`, [other, CAST_A, CAST_B, Buffer.from(PNG)]);
    expect((await make(cookie, { action: "use_picture", id: plan.id, shot: 2, image_id: "not-theirs" })).status).toBe(404);

    // Approve the kept ones and film: the shot still planned isn't filmed.
    await make(cookie, { action: "approve", id: plan.id, media_id: null, approved: true });
    const filmed = (await (await make(cookie, { action: "film", id: plan.id })).json()).reel as Reel;
    expect(filmed.shots.map((s) => s.status)).toEqual(["queued", "queued", "planned"]);
    expect(seen.filter((x) => x.path === "/video/queue")).toHaveLength(2);
    const queued = seen.filter((x) => x.path === "/video/queue");
    expect(queued[0].body.image_url).toMatch(/\/media\/theirs-1\?/);

    // Films again only once it's done; then just that shot is queued again from its own start picture.
    expect((await make(cookie, { action: "refilm", id: plan.id, media_id: "theirs-1" })).status).toBe(409);
    const advance = async () => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${plan.id}`, { headers: { cookie } }))).json()).reel as Reel;
    let done = await advance();
    for (let k = 0; k < 5 && done.status === "making"; k++) done = await advance();
    expect(done.status).toBe("ready");
    const video = done.shots[0].media_id!;
    expect(video).not.toBe("theirs-1");
    const again = (await (await make(cookie, { action: "refilm", id: plan.id, media_id: video })).json()).reel as Reel;
    expect(again.status).toBe("making");
    expect(again.shots[0]).toMatchObject({ status: "queued", frame_id: "theirs-1" });
    expect(again.shots[1].status).toBe("ready");
    const requeued = seen.filter((x) => x.path === "/video/queue");
    expect(requeued).toHaveLength(3);
    expect(requeued[2].body.image_url).toMatch(/\/media\/theirs-1\?/);
    let back = await advance();
    for (let k = 0; k < 5 && back.status === "making"; k++) back = await advance();
    expect(back.status).toBe("ready");
    expect(back.shots[0].media_id).not.toBe(video);
    expect(back.shots.every((s) => s.refilm_tokens === undefined)).toBe(true);
  });

  it("uses a video they already made for a shot: done as it is, not filmed, and not someone else's", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await sceneAt(id, 1, linesOf(1, 8), { place: "the harbour", set: "harbour", stage: 2 });
    const seen = fakeMedia();
    director([2, 4, 6]);
    const plan = (await (await make(cookie, { action: "plan" })).json()).reel as Reel;
    // A video of the two of them they already made (a clip or a studio animation).
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data) values ('vid-1', $1, $2, $3, 'video', 'p', 'video/mp4', $4)`, [id, CAST_A, CAST_B, Buffer.from(PNG)]);
    const used = (await (await make(cookie, { action: "use_video", id: plan.id, shot: 0, video_id: "vid-1" })).json()).reel as Reel;
    expect(used.shots[0]).toMatchObject({ status: "ready", media_id: "vid-1", from_video: true, approved: true });
    expect(seen.filter((x) => x.path === "/image/multi-edit")).toHaveLength(0); // nothing drawn
    // Someone else's video isn't theirs to use.
    const other = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data) values ('vid-other', $1, $2, $3, 'video', 'p', 'video/mp4', $4)`, [other, CAST_A, CAST_B, Buffer.from(PNG)]);
    expect((await make(cookie, { action: "use_video", id: plan.id, shot: 1, video_id: "vid-other" })).status).toBe(404);
    // Draw and approve another shot, then film: the reused video stays ready (not re-filmed), the drawn one is queued.
    await make(cookie, { action: "redraw", id: plan.id, shot: 1, custom: "they lean in close" });
    await make(cookie, { action: "approve", id: plan.id, media_id: null, approved: true });
    const filmed = (await (await make(cookie, { action: "film", id: plan.id })).json()).reel as Reel;
    expect(filmed.shots[0]).toMatchObject({ status: "ready", media_id: "vid-1", from_video: true });
    expect(filmed.shots[1].status).toBe("queued");
    const queued = seen.filter((x) => x.path === "/video/queue");
    expect(queued).toHaveLength(1);
    expect(queued[0].body.image_url).not.toMatch(/\/media\/vid-1\?/);
  });

  it("films a storyboard made only of videos they already have, without spending", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await sceneAt(id, 1, linesOf(1, 8), { place: "the harbour", set: "harbour", stage: 2 });
    const seen = fakeMedia();
    director([2]);
    const plan = (await (await make(cookie, { action: "plan" })).json()).reel as Reel;
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data) values ('vid-only', $1, $2, $3, 'video', 'p', 'video/mp4', $4)`, [id, CAST_A, CAST_B, Buffer.from(PNG)]);
    await make(cookie, { action: "use_video", id: plan.id, shot: 0, video_id: "vid-only" });
    const filmed = (await (await make(cookie, { action: "film", id: plan.id })).json()).reel as Reel;
    expect(filmed.status).toBe("ready");
    expect(filmed.shots[0]).toMatchObject({ status: "ready", media_id: "vid-only", from_video: true });
    expect(seen.filter((x) => x.path === "/video/queue")).toHaveLength(0);
  });

  it("a shot filmed again settles on its own: its price back if it fails, the reel's own share never refunded twice", async () => {
    const owner = userIdOf(newUserCookie());
    await t.db.query(`insert into pack_episode_usage (user_id, used) values ($1, 20)`, [owner]);
    const shot = (status: string, extra: Record<string, unknown> = {}) => ({ line: 1, who: "a", text: "hi there you", frame: "", motion: "", status, frame_id: "f", media_id: "m", ...extra });
    const reel = async (rid: string, shots: unknown[]) => {
      await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots) values ($1, $2, $3, $4, 'making', 15, $5::jsonb)`, [rid, owner, ...PAIR, JSON.stringify(shots)]);
      return settleIfDone(t.db, rid);
    };
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [owner])).rows[0].used;
    // The new video failed: its 5 come back, and only those (the first take's failed share was settled long ago).
    const failed = await reel("refilm-failed", [shot("ready"), shot("failed", { refilm_tokens: 5 }), shot("failed")]);
    expect(failed.status).toBe("ready");
    expect(await used()).toBe(15);
    expect(failed.shots.every((s) => s.refilm_tokens === undefined)).toBe(true);
    // It came in: nothing back.
    await reel("refilm-ok", [shot("ready"), shot("ready", { refilm_tokens: 5 })]);
    expect(await used()).toBe(15);
  });

  it("suggests each shot's best-fitting pictures of theirs by its tags, and draws a shot like one (its pose, framing and place)", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const lines = linesOf(1, 8).map((l, i) => (i === 4 ? { who: "b" as const, text: "*kneels* She takes him in her mouth, slowly." } : l));
    await sceneAt(id, 1, lines, { place: "the harbour", set: "harbour", stage: 4 });
    const seen = fakeMedia();
    director([2, 4, 6]);
    const plan = (await (await make(cookie, { action: "plan" })).json()).reel as Reel;
    // One of them alone, first-person, of that act and pinned for dates; and a plain picture of the other.
    await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, status) values ('sh-pov', $1, $2, 'shoot', '{"filthy": "pov_blowjob", "level": 3}'::jsonb, 'ready')`, [id, CAST_A]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, shoot_id) values ('pov-pic', $1, $2, 'scene', 'p', 'image/png', $3, 'sh-pov')`, [id, CAST_A, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ('pov-pic', $1, 'date', 'yes', 'manual')`, [id]);
    const res = await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?suggest=${plan.id}`, { headers: { cookie } }));
    const { suggestions } = (await res.json()) as { suggestions: Record<string, { id: string; pov: boolean; pinned: boolean; pair: boolean }[]> };
    // The shot on that line gets it first; it's first-person and pinned.
    const k = plan.shots.findIndex((s) => s.line === 4);
    expect(suggestions[k][0]).toMatchObject({ id: "pov-pic", pov: true, pinned: true, pair: false });
    // Not for someone else's draft.
    const stranger = signedIn(userIdOf(newUserCookie()));
    expect((await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?suggest=${plan.id}`, { headers: { cookie: stranger } }))).status).toBe(404);
    // Draw a shot like that picture: it's Picture 3, and the prompt takes only its pose, framing and place.
    const drawn = (await (await make(cookie, { action: "redraw", id: plan.id, shot: k, reference: "pov-pic" })).json()).reel as Reel;
    expect(drawn.shots[k]).toMatchObject({ status: "frame_ready", ref_id: "pov-pic" });
    const edit = seen.filter((x) => x.path === "/image/multi-edit").at(-1)!;
    expect(edit.body.images as string[]).toHaveLength(3);
    expect((edit.body.images as string[])[2]).toMatch(/\/media\/pov-pic\?/);
    expect(String(edit.body.prompt)).toContain("posed, framed and placed like Picture 3");
    // A picture that isn't this pair's can't be drawn like.
    expect((await make(cookie, { action: "redraw", id: plan.id, shot: 0, reference: "nobody's" })).status).toBe(404);
  });

  it("won't film a draft with no kept picture", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await sceneAt(id, 1, linesOf(1, 8), { place: "the harbour", set: "harbour", stage: 2 });
    fakeMedia();
    director([2, 4, 6]);
    const plan = (await (await make(cookie, { action: "plan" })).json()).reel as Reel;
    // Straight to film, before any picture is drawn.
    const res = await make(cookie, { action: "film", id: plan.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_frames");
  });
});
