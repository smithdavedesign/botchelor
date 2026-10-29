import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as presenceGet, POST as presencePost } from "@/app/api/admin/after-dark/presence/route";
import { GET as presenceFileGet } from "@/app/api/admin/after-dark/presence/[id]/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { collectPresence, EXPRESSIONS, expressionPrompt, LOOP_PROMPT, makePresence, presenceOf } from "@/lib/adult/presence";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { deleteAfterDarkData } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// A character's presence (lib/adult/presence.ts; docs/PRDs/theater-immersion.md #1 and #2): no live calls here.
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
  setReplicatePausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setReplicateFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

const [RAFE, JUNIPER, OUTSIDER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[5].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = new Uint8Array([0, 0, 0, 24]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.1 }] }] };
const CHILD_MOD = { output: [{ classes: [{ class: "no_child_present", value: 0.5 }, { class: "yes_child_present", value: 0.5 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
/** Hive: everything passes, unless `refuse` answers a call. */
function fakeHive(refuse: (n: number) => unknown = () => null) {
  let n = 0;
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    const custom = vlm ? null : refuse(n++);
    if (custom instanceof Response) return custom;
    if (custom) return Response.json(custom);
    return Response.json(vlm ? ADULTS : CLEAN_MOD);
  });
}
/** Venice: face edits, a queued loop, and a retrieve that's `done()` or still making. Records what was asked. */
function fakeVenice(opts: { done?: () => boolean; edit?: (n: number) => Response | null } = {}) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let edits = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/image/multi-edit") return opts.edit?.(edits++) ?? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: "loop-q1" });
    if (path === "/video/retrieve")
      return opts.done?.() === false ? Response.json({ status: "PROCESSING" }) : new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    if (path === "/video/complete") return Response.json({ success: true });
    return new Response("?", { status: 500 });
  });
  return seen;
}
/** After Dark on (Venice and Hive keys) and a face each for Rafe and Juniper. */
async function ready(cookie: string, ownerId: string, settings: Record<string, unknown> = {}) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", ...settings }, cookie);
  for (const [pid, c] of [["face-juniper", JUNIPER], ["face-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
}
const parts = async (owner: string) =>
  (await t.db.query<{ part: string; expression: string | null; status: string; error: string | null }>(`select part, expression, status, error from adult_presence where owner_id = $1 order by part, expression`, [owner])).rows;

describe("a character's presence", () => {
  it("is seven expressions of the face they keep, each checked, and a loop queued from that face, then collected", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { presence_loop_model: "wan-2.6-flash-image-to-video" });
    fakeHive();
    const seen = fakeVenice({ done: () => false });
    const made = await makePresence(t.db, id, JUNIPER, BASE_URL);
    expect(made).toEqual({ ok: true, made: 7, queued: true, failed: [] });
    // Each edit is the face itself, asked for one look; the loop starts from that same face.
    const edits = seen.filter((s) => s.path === "/image/multi-edit");
    expect(edits.map((e) => e.body.prompt)).toEqual(expect.arrayContaining(Object.keys(EXPRESSIONS).map((e) => expressionPrompt(e as keyof typeof EXPRESSIONS))));
    expect(edits.every((e) => String((e.body.images as string[])[0]).includes("/media/face-juniper"))).toBe(true);
    const queued = seen.find((s) => s.path === "/video/queue")!;
    expect(queued.body).toMatchObject({ model: "wan-2.6-flash-image-to-video", prompt: LOOP_PROMPT, duration: "5s" });
    expect(String(queued.body.image_url)).toContain("/media/face-juniper");
    // Queued first, so Venice renders it while the expressions are drawn.
    expect(seen.findIndex((s) => s.path === "/video/queue")).toBeLessThan(seen.findIndex((s) => s.path === "/image/multi-edit"));

    let p = (await presenceOf(t.db, id, [JUNIPER]))[JUNIPER];
    expect(p).toMatchObject({ face_id: "face-juniper", loop: null, making: true, missing: 0 });
    expect(Object.keys(p.expressions).sort()).toEqual(Object.keys(EXPRESSIONS).sort());
    // Still making at Venice: nothing kept yet.
    expect(await collectPresence(t.db, id)).toBe(0);
    // Done: checked, kept, counted in the month's clips.
    fakeVenice();
    expect(await collectPresence(t.db, id)).toBe(1);
    p = (await presenceOf(t.db, id, [JUNIPER]))[JUNIPER];
    expect(p.loop).toBeTruthy();
    expect(p.making).toBe(false);
    const usage = (await t.db.query<{ pictures: number; clips: number }>(`select pictures, clips from adult_usage where owner_id = $1`, [id])).rows[0];
    expect(usage).toMatchObject({ pictures: 7, clips: 1 });
    // A second ask makes nothing again.
    const again = fakeVenice();
    expect(await makePresence(t.db, id, JUNIPER, BASE_URL)).toEqual({ ok: true, made: 0, queued: false, failed: [] });
    expect(again).toHaveLength(0);
    // Their account deleted: it goes with their other After Dark data.
    await deleteAfterDarkData(t.db, id);
    expect(await parts(id)).toEqual([]);
  });

  it("keeps out an expression the check refuses, logs it, and draws only that one again on the next ask", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    // The first moderation call is the first expression drawn: refused as a minor.
    fakeHive((n) => (n === 0 ? CHILD_MOD : null));
    fakeVenice({ done: () => false });
    const made = await makePresence(t.db, id, RAFE, BASE_URL);
    expect(made).toMatchObject({ ok: true, made: 6, queued: true });
    if (made.ok) expect(made.failed).toHaveLength(1);
    const failed = (await parts(id)).filter((r) => r.status === "failed");
    expect(failed).toHaveLength(1);
    expect((await t.db.query(`select 1 from adult_rejections where owner_id = $1 and reason like 'presence %'`, [id])).rows).toHaveLength(1);
    const p = (await presenceOf(t.db, id, [RAFE]))[RAFE];
    expect(Object.keys(p.expressions)).toHaveLength(6);
    expect(p.missing).toBe(1);
    // Asked again: only the refused one is drawn.
    fakeHive();
    const seen = fakeVenice({ done: () => false });
    expect(await makePresence(t.db, id, RAFE, BASE_URL)).toEqual({ ok: true, made: 1, queued: false, failed: [] });
    expect(seen.filter((s) => s.path === "/image/multi-edit")).toHaveLength(1);
  });

  it("goes stale when they keep a new face, and an expression lost mid-draw is asked for again", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeHive();
    fakeVenice({ done: () => false });
    await makePresence(t.db, id, JUNIPER, BASE_URL);
    // A new face kept: the old presence isn't theirs any more.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-juniper-2', $1, $2, 'baseline', 'p', 'image/png', $3)`, [id, JUNIPER, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'face-juniper-2')`, [id, JUNIPER]);
    expect(await presenceOf(t.db, id, [JUNIPER])).toEqual({});
    // One of the new face's expressions left "making" by a function that died, long ago: it counts as missing.
    await t.db.query(
      `insert into adult_presence (id, owner_id, character_id, face_id, part, expression, status, updated_at) values ('lost', $1, $2, 'face-juniper-2', 'expression', 'smile', 'making', now() - interval '1 hour')`,
      [id, JUNIPER],
    );
    expect((await presenceOf(t.db, id, [JUNIPER]))[JUNIPER]).toMatchObject({ making: false, missing: 8 });
  });

  it("says why it can't start: no face yet, or no output check", async () => {
    const { id, cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice" }, cookie);
    expect(await makePresence(t.db, id, JUNIPER, BASE_URL)).toMatchObject({ ok: false, error: "no_face" });
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-juniper', $1, $2, 'baseline', 'p', 'image/png', $3)`, [id, JUNIPER, Buffer.from(PNG)]);
    expect(await makePresence(t.db, id, JUNIPER, BASE_URL)).toMatchObject({ ok: false, error: "not_set_up" });
  });
});

describe("the presence routes", () => {
  it("are hidden from a visitor, refuse a character outside their After Dark, and serve a file to its owner only", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeHive();
    fakeVenice({ done: () => false });
    // A visitor: not found.
    expect((await presenceGet(new Request(`${BASE_URL}/api/admin/after-dark/presence?ids=${JUNIPER}`))).status).toBe(404);
    expect((await call(presencePost, "/api/admin/after-dark/presence", { character_id: JUNIPER })).status).toBe(404);
    // Someone not in their After Dark: not found either.
    expect((await call(presencePost, "/api/admin/after-dark/presence", { character_id: OUTSIDER }, cookie)).status).toBe(404);
    expect((await call(presencePost, "/api/admin/after-dark/presence", {}, cookie)).status).toBe(422);
    await makePresence(t.db, id, JUNIPER, BASE_URL);
    const got = await presenceGet(new Request(`${BASE_URL}/api/admin/after-dark/presence?ids=${JUNIPER},${RAFE},${OUTSIDER}`, { headers: { cookie } }));
    const { presence } = (await got.json()) as { presence: Record<string, { expressions: Record<string, string> }> };
    expect(Object.keys(presence)).toEqual([JUNIPER]);
    const fileId = presence[JUNIPER].expressions.smile;
    const file = await presenceFileGet(new Request(`${BASE_URL}/api/admin/after-dark/presence/${fileId}`, { headers: { cookie } }), { params: Promise.resolve({ id: fileId }) });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    // Another admin can't have it.
    const other = await admin();
    const theirs = await presenceFileGet(new Request(`${BASE_URL}/api/admin/after-dark/presence/${fileId}`, { headers: { cookie: other.cookie } }), { params: Promise.resolve({ id: fileId }) });
    expect(theirs.status).toBe(404);
  });

  it("says at once when it can't start, rather than starting nothing in the background", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
    const res = await call(presencePost, "/api/admin/after-dark/presence", { character_id: JUNIPER }, cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_face");
  });
});
