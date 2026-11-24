// Waiting on a step in After Dark's theater (lib/adult/write-watch.ts; David, 2026-11-24: "the longer writer model takes
// too long and times out and only after you refresh page you see the writing"). The page no longer depends on one long
// answer: it asks for it to be kept alive, looks at the scene itself while it waits, and follows a write whose answer
// it lost. Here: what a look at the scene means, the kept answer on the route and in the page's request, and the
// write's mark staying fresh. No live calls; the lines are mild.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { requestKept } from "@/app/after-dark/kept-request";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { continueScene, openScene } from "@/lib/adult/scenes";
import {
  answerLost,
  hasNewLines,
  KEPT_ANSWER,
  KEPT_ANSWER_HEADER,
  keptAnswerOf,
  linesAdded,
  lostWriteVerdict,
  WATCH_QUIET_LOOKS,
  writeLanded,
  writesLines,
  WRITING_BEAT_MS,
  WRITING_STALE_MS,
  type SeenScene,
} from "@/lib/adult/write-watch";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

const line = (who: "a" | "b", text: string) => ({ who, text });
const HELLO = [line("a", "You made it."), line("b", "I said I would.")];
const MORE = [...HELLO, line("a", "Stay a while."), line("b", "I was hoping you'd ask.")];

describe("what a look at the scene means", () => {
  it("has new lines when the server has one the page isn't showing: more of them, another take, or another chapter's", () => {
    const page: SeenScene = { chapter: 2, lines: HELLO };
    expect(hasNewLines(page, { chapter: 2, lines: MORE })).toBe(true);
    // The same lines again, or fewer of them (a redo's step taken back, its new take not written yet): nothing to show.
    expect(hasNewLines(page, { chapter: 2, lines: HELLO })).toBe(false);
    expect(hasNewLines(page, { chapter: 2, lines: HELLO.slice(0, 1) })).toBe(false);
    // A redo's new take: as many lines as before, and one of them is different.
    expect(hasNewLines(page, { chapter: 2, lines: [HELLO[0], line("b", "I nearly didn't.")] })).toBe(true);
    expect(hasNewLines(page, { chapter: 2, lines: [line("b", HELLO[0].text), HELLO[1]] })).toBe(true);
    // Another chapter with lines in it (a scenario's new night, the chapter after this one); an empty one shows nothing yet.
    expect(hasNewLines(page, { chapter: 1, lines: HELLO })).toBe(true);
    expect(hasNewLines(page, { chapter: 3, lines: [] })).toBe(false);
    // A scene that never said its chapter is on its first.
    expect(hasNewLines({ lines: [] }, { chapter: 1, lines: HELLO })).toBe(true);
    expect(hasNewLines({ lines: HELLO }, { chapter: 1, lines: HELLO })).toBe(false);
  });

  it("a write has landed when it left lines, or filled its chapter and closed it", () => {
    const before: SeenScene = { chapter: 2, lines: HELLO };
    expect(writeLanded(before, { chapter: 2, lines: MORE })).toBe(true);
    expect(writeLanded(before, { chapter: 3, lines: [] })).toBe(true);
    expect(writeLanded(before, { chapter: 2, lines: HELLO })).toBe(false);
    // A scenario placed whose first lines didn't come: a new night with nothing in it.
    expect(writeLanded(before, { chapter: 1, lines: [] })).toBe(false);
  });

  it("knows the moves that write lines from the ones that answer at once", () => {
    for (const body of [{}, { direction: "they share a cab", steer_mode: "nudge" }, { whisper: { to: "a", text: "say yes" } }, { redo: true }, { scenario: "snowed-in" }]) {
      expect(writesLines(body), JSON.stringify(body)).toBe(true);
    }
    for (const body of [{ rewind: true }, { reset: true }, { set_scene: "the roof" }, { set_scene: "the roof", roleplay: { id: "neighbours" } }, { roleplay: null }, { forget_whisper: "a" }, { limits: { intensity: "slow_burn" } }]) {
      expect(writesLines(body), JSON.stringify(body)).toBe(false);
    }
  });

  it("an answer is lost when nothing came back, or a proxy's own page did; the app's refusals are answers", () => {
    expect(answerLost(null)).toBe(true);
    // The edge's page for a request it cut off: no JSON of ours in it.
    expect(answerLost({ ok: false, status: 504, data: {} })).toBe(true);
    expect(answerLost({ ok: false, status: 524, data: {} })).toBe(true);
    expect(answerLost({ ok: true, status: 200, data: { scene: {} } })).toBe(false);
    expect(answerLost({ ok: false, status: 422, data: { error: "not_continued", message: "That steer crosses one of the lines." } })).toBe(false);
    expect(answerLost({ ok: false, status: 502, data: { error: "not_continued", message: "The writer didn't answer." } })).toBe(false);
    expect(answerLost({ ok: false, status: 500, data: { error: "internal_error" } })).toBe(false);
    expect(answerLost({ ok: false, status: 404, data: {} })).toBe(false);
  });

  it("follows a lost write by the scene's own mark: writing while it's in flight, then landed or nothing", () => {
    const before: SeenScene = { chapter: 1, lines: HELLO };
    // In flight, with or without its lines kept yet (they're kept before the step's pictures are drawn).
    expect(lostWriteVerdict(before, { chapter: 1, lines: HELLO, writing_for: 130 }, 0)).toBe("writing");
    expect(lostWriteVerdict(before, { chapter: 1, lines: MORE, writing_for: 150 }, 1)).toBe("writing");
    // Over, and its lines are there.
    expect(lostWriteVerdict(before, { chapter: 1, lines: MORE }, 0)).toBe("landed");
    expect(lostWriteVerdict(before, { chapter: 2, lines: [] }, 0)).toBe("landed");
    // No write in flight and nothing new: not believed on one look (the answer can be lost before the server has
    // marked the write), only on WATCH_QUIET_LOOKS in a row.
    expect(WATCH_QUIET_LOOKS).toBeGreaterThanOrEqual(2);
    expect(lostWriteVerdict(before, { chapter: 1, lines: HELLO }, 0)).toBe("again");
    expect(lostWriteVerdict(before, { chapter: 1, lines: HELLO }, WATCH_QUIET_LOOKS - 1)).toBe("nothing");
    // The look itself failed: nothing is concluded from it.
    expect(lostWriteVerdict(before, null, 5)).toBe("again");
  });

  it("counts what a followed write added, for autoplay's own stop", () => {
    const before: SeenScene = { chapter: 1, lines: HELLO };
    expect(linesAdded(before, { chapter: 1, lines: MORE })).toBe(2);
    expect(linesAdded(before, { chapter: 1, lines: HELLO })).toBe(0);
    // Another take of the same length is still something new; a chapter closed is too.
    expect(linesAdded(before, { chapter: 1, lines: [HELLO[0], line("b", "I nearly didn't.")] })).toBe(1);
    expect(linesAdded(before, { chapter: 2, lines: [] })).toBe(1);
  });

  it("a write's mark outlives the longest step it's kept fresh for, and is let go after that", () => {
    // Kept fresh several times inside the window, so one missed beat never reads as a dead write.
    expect(WRITING_STALE_MS).toBeGreaterThanOrEqual(WRITING_BEAT_MS * 4);
  });
});

describe("a kept answer, as the page reads it", () => {
  const respond = (body: string, init: ResponseInit = {}) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200, ...init }));
  afterEach(() => vi.restoreAllMocks());

  it("reads the real status and JSON from inside the stream, however many newlines came first", async () => {
    const fetched = respond(`\n\n\n${JSON.stringify({ kept: true, status: 200, body: { scene: { id: "s" }, added: 2 } })}`);
    expect(await requestKept("/api/admin/after-dark", { a: "x", b: "y" })).toEqual({ ok: true, status: 200, data: { scene: { id: "s" }, added: 2 }, message: "Something went wrong. Try again." });
    // It asked for the answer to be kept, as a POST of JSON.
    const [, init] = fetched.mock.calls[0];
    expect(new Headers(init?.headers).get(KEPT_ANSWER_HEADER)).toBe(KEPT_ANSWER);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ a: "x", b: "y" });
  });

  it("a refusal inside it is a refusal, with its own status and words", async () => {
    respond(`\n${JSON.stringify({ kept: true, status: 422, body: { error: "not_continued", message: "That steer crosses one of the lines that never move." } })}`);
    const r = await requestKept("/api/admin/after-dark");
    expect(r).toMatchObject({ ok: false, status: 422, message: "That steer crosses one of the lines that never move." });
    expect(answerLost(r)).toBe(false);
  });

  it("a stream that ended early is no answer at all, and a proxy's page is an answer lost", async () => {
    // Cut off after the newlines, or part-way through the JSON: the caller takes it as lost and follows the write.
    respond("\n\n");
    await expect(requestKept("/api/admin/after-dark")).rejects.toThrow("ended early");
    respond(`\n{"kept":true,"status":200,"body":{"scene":`);
    await expect(requestKept("/api/admin/after-dark")).rejects.toThrow("ended early");
    respond("<html><body>error code: 524</body></html>", { status: 524 });
    const cut = await requestKept("/api/admin/after-dark");
    expect(cut).toMatchObject({ ok: false, status: 524, data: {} });
    expect(answerLost(cut)).toBe(true);
  });

  it("an answer that wasn't kept is read the plain way: a server a deploy behind, a refusal before the write, the stream's own failure", async () => {
    respond(JSON.stringify({ scene: { id: "s" }, added: 1 }));
    expect(await requestKept("/api/admin/after-dark")).toMatchObject({ ok: true, status: 200, data: { scene: { id: "s" }, added: 1 } });
    respond(JSON.stringify({ error: "not_found" }), { status: 404 });
    expect(await requestKept("/api/admin/after-dark")).toMatchObject({ ok: false, status: 404, data: { error: "not_found" } });
    respond(`\n${JSON.stringify({ error: "internal_error" })}`);
    const failed = await requestKept("/api/admin/after-dark");
    expect(failed).toMatchObject({ ok: false, status: 500 });
    expect(answerLost(failed)).toBe(false);
  });

  it("only a whole kept answer counts as one", () => {
    expect(keptAnswerOf({ kept: true, status: 200, body: { a: 1 } })).toEqual({ kept: true, status: 200, body: { a: 1 } });
    expect(keptAnswerOf({ kept: true, status: 204, body: null })).toEqual({ kept: true, status: 204, body: {} });
    for (const not of [null, "kept", { status: 200, body: {} }, { kept: true, status: "200", body: {} }, { kept: true, status: 20, body: {} }, { scene: {} }]) expect(keptAnswerOf(not), JSON.stringify(not)).toBeNull();
  });
});

describe("the scene's route", () => {
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
    setSeasonCastForTests([RAFE, JUNIPER]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setAdultModelForTests(null);
    setSeasonCastForTests(null);
  });

  const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
  const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
  const post = (body: unknown, cookie?: string, kept = false) =>
    POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(kept ? { [KEPT_ANSWER_HEADER]: KEPT_ANSWER } : {}) }, body: JSON.stringify(body) }));
  const get = (query: string, cookie: string) => GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}${query}`, { headers: { cookie } }));
  async function admin() {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    const cookie = signedIn(id);
    const set = await settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ enabled: true, openrouter_key: "placeholder-text-ABCD" }) }));
    expect(set.status).toBe(200);
    return { id, cookie };
  }
  const writes = (lines = HELLO) => setAdultModelForTests({ complete: async () => JSON.stringify({ lines, explicit: false, picture: null }) });

  it("keeps a write's answer alive when the page asks: a stream that is a 200 from its first byte, the real status and JSON inside", async () => {
    const { cookie } = await admin();
    writes();
    const res = await post({ a: RAFE, b: JUNIPER }, cookie, true);
    expect(res.status).toBe(200);
    // Nothing between here and the page may hold the newlines back or cache it.
    expect(res.headers.get("cache-control")).toBe("no-store, no-transform");
    const kept = keptAnswerOf(JSON.parse(await res.text()));
    expect(kept).toMatchObject({ kept: true, status: 200, body: { added: HELLO.length } });
    expect((kept!.body.scene as { lines: unknown[] }).lines).toHaveLength(HELLO.length);
    // A refusal is said the same way, its status inside: the steer is never written.
    const refused = keptAnswerOf(JSON.parse(await (await post({ a: RAFE, b: JUNIPER, direction: "she is fifteen" }, cookie, true)).text()));
    expect(refused).toMatchObject({ kept: true, status: 422, body: { error: "not_continued" } });
    expect(String(refused!.body.message)).toContain("crosses one of the lines that never move");
  });

  it("answers everyone else the plain way: a caller that didn't ask, and anyone After Dark isn't open to", async () => {
    const { cookie } = await admin();
    writes();
    const plain = await post({ a: RAFE, b: JUNIPER }, cookie);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toContain("application/json");
    expect(await plain.json()).toMatchObject({ added: HELLO.length });
    // A stranger, and a signed-in visitor with no After Dark: the same not-found as ever, never a stream.
    const stranger = await post({ a: RAFE, b: JUNIPER }, undefined, true);
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual({ error: "not_found" });
    const visitor = await post({ a: RAFE, b: JUNIPER }, signedIn(userIdOf(newUserCookie())), true);
    expect(visitor.status).toBe(404);
  });

  it("gives the saved nights with the scene when asked, for a page that followed a write to its end", async () => {
    const { cookie } = await admin();
    writes();
    await post({ a: RAFE, b: JUNIPER }, cookie);
    const plain = (await (await get("", cookie)).json()) as Record<string, unknown>;
    expect(plain.scene).toBeTruthy();
    expect(plain).not.toHaveProperty("nights");
    const withNights = (await (await get("&nights=1", cookie)).json()) as { scene: { lines: unknown[] }; nights: unknown[] };
    expect(withNights.scene.lines).toHaveLength(HELLO.length);
    expect(Array.isArray(withNights.nights)).toBe(true);
  });

  it("a write still running keeps its mark fresh, so a long one never reads as dead; one that died is let go", async () => {
    const { id, cookie } = await admin();
    writes();
    // While it's written the scene carries both marks; once it's in, neither.
    let during: { since: unknown; beat: unknown } | null = null;
    setAdultModelForTests({
      complete: async () => {
        const row = (await t.db.query<{ since: unknown; beat: unknown }>(`select writing_since as since, writing_beat as beat from adult_scenes where owner_id = $1`, [id])).rows[0];
        during = row ?? null;
        return JSON.stringify({ lines: HELLO, explicit: false, picture: null });
      },
    });
    expect(await continueScene(t.db, id, RAFE, JUNIPER, null)).toMatchObject({ ok: true });
    expect(during).toMatchObject({ since: expect.anything(), beat: expect.anything() });
    expect((await t.db.query(`select writing_since, writing_beat from adult_scenes where owner_id = $1`, [id])).rows[0]).toEqual({ writing_since: null, writing_beat: null });
    expect((await openScene(t.db, id, RAFE, JUNIPER))?.writing_for).toBeUndefined();
    // Ten minutes in and still saying so (several calls on the slow writer): in flight, and it says how long.
    const mark = (since: number, beat: number | null) =>
      t.db.query(`update adult_scenes set writing_since = now() - make_interval(secs => $2), writing_beat = case when $3::int is null then null else now() - make_interval(secs => $3::int) end where owner_id = $1`, [id, since, beat]);
    await mark(600, 10);
    const long = (await openScene(t.db, id, RAFE, JUNIPER))?.writing_for;
    expect(long).toBeGreaterThanOrEqual(600);
    expect((await (await get("", cookie)).json()).scene.writing_for).toBeGreaterThanOrEqual(600);
    // Its last word was longer ago than the window: the request died (a deploy, a crash), and the page is let go.
    await mark(600, WRITING_STALE_MS / 1000 + 30);
    expect((await openScene(t.db, id, RAFE, JUNIPER))?.writing_for).toBeUndefined();
    // A mark from before the beat existed is judged by when the write began, as it always was.
    await mark(60, null);
    expect((await openScene(t.db, id, RAFE, JUNIPER))?.writing_for).toBeGreaterThanOrEqual(60);
    await mark(WRITING_STALE_MS / 1000 + 60, null);
    expect((await openScene(t.db, id, RAFE, JUNIPER))?.writing_for).toBeUndefined();
  });
});
