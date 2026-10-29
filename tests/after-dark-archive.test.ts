import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { GET as reelGet, PATCH as reelPatch } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { archivedClip, clipChains, keepGoingFrom, playable } from "@/lib/adult/clip-chains";
import { listMedia } from "@/lib/adult/media";
import { rateItem } from "@/lib/adult/library";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { TAG_FIXES } from "@/lib/adult/rating-tags";
import { archiveShot, listReels, setReelFetchForTests, setReelPausesForTests, type Reel, type ReelShot } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { filmed } from "@/lib/adult/shorts";
import { rateMedia, setFaceReference } from "@/lib/adult/steering";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Taking a shot out of a video into the Archive, never deleting it (David, 2026-10-24), and what a viewer's ratings and
// face do to their next video. No live calls.
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

// Rafe (he) and Juniper (she); the pair is stored lower id first, so "a" is Juniper.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const send = (handler: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] } : CLEAN_MOD),
  );
}
/** Venice: keyframes, queues, and a shot that's done on the first retrieve. Records what was asked. */
function fakeVenice() {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}
const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];
const lines = Array.from({ length: 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage: 2 }));

/** After Dark on (Venice and Hive keys), both baselines in, and the pair's scene at kissing. */
async function ready(cookie: string, ownerId: string) {
  await send(settingsPost, "POST", "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const res = await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }));
  const scene = (await res.json()).scene as { id: string };
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [scene.id, JSON.stringify(lines)]);
}
const clip = async (cookie: string, body: Record<string, unknown>) => send(clipsPost, "POST", "/api/admin/after-dark/clips", body, cookie);
const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;
const archive = (cookie: string, body: Record<string, unknown>) => send(reelPatch, "PATCH", "/api/admin/after-dark/reel", body, cookie);
/** A finished clip of the kiss. */
async function kiss(cookie: string): Promise<Reel> {
  const made = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
  const done = await advance(made.id, cookie);
  expect(done.status).toBe("ready");
  return done;
}

describe("taking a shot out of its video", () => {
  it("moves it to the Archive and back, keeping it all along, and Keep going waits until it's back", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const first = await kiss(cookie);
    const shot = first.shots[0];
    const out = await archive(cookie, { id: first.id, media_id: shot.media_id, archived: true });
    expect(out.status).toBe(200);
    const archived = (await out.json()).reel as Reel;
    expect(archived.shots[0].archived_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(playable(archived.shots[0])).toBe(false);
    expect(archivedClip(archived)).toBe(true);
    // Kept: the reel, its shot and its file are all still there.
    expect((await t.db.query(`select 1 from adult_images where id = $1 and status = 'ready'`, [shot.media_id])).rows).toHaveLength(1);
    const listed = await listReels(t.db, id, RAFE, JUNIPER);
    expect(listed).toHaveLength(1);
    expect(listed[0].shots[0]).toMatchObject({ status: "ready", media_id: shot.media_id, archived_at: archived.shots[0].archived_at });
    // Out of the gallery too: it's in the Archive.
    expect((await listMedia(t.db, [RAFE, JUNIPER], id)).map((m) => m.id)).not.toContain(shot.media_id);
    // …unless a gallery asks for the Archive too: then it's flagged (lib/media-filter.ts lists it under 🗄 Archived).
    expect((await listMedia(t.db, [RAFE, JUNIPER], id, { withArchived: true })).find((m) => m.id === shot.media_id)).toMatchObject({ archived: true });
    // Keep going isn't offered, and isn't taken, from a clip in the Archive.
    expect(keepGoingFrom(clipChains(listed)[0])).toBeNull();
    const refused = await clip(cookie, { continue: first.id });
    expect(refused.status).toBe(409);
    expect((await refused.json()).message).toBe("That clip is in the Archive. Put it back to keep going from it.");
    // Archiving twice keeps the first time.
    const again = (await (await archive(cookie, { id: first.id, media_id: shot.media_id, archived: true })).json()).reel as Reel;
    expect(again.shots[0].archived_at).toBe(archived.shots[0].archived_at);
    // Put back: it plays, and Keep going carries on from it.
    const back = (await (await archive(cookie, { id: first.id, media_id: shot.media_id, archived: false })).json()).reel as Reel;
    expect(back.shots[0].archived_at).toBeUndefined();
    expect(playable(back.shots[0])).toBe(true);
    expect((await listMedia(t.db, [RAFE, JUNIPER], id)).map((m) => m.id)).toContain(shot.media_id);
    // A clip's stars (the library's, given to its reel) come with its shot, for the galleries' rating filter.
    await rateItem(t.db, id, first.id, 2);
    expect((await listMedia(t.db, [RAFE, JUNIPER], id)).find((m) => m.id === shot.media_id)).toMatchObject({ archived: false, stars: 2 });
    expect((await clip(cookie, { continue: first.id })).status).toBe(200);
  });

  it("is theirs only, a shot that came through only, and not while the video is still being made", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const made = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    const busy = await archive(cookie, { id: made.id, media_id: made.shots[0].media_id, archived: true });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe("still_making");
    const done = await advance(made.id, cookie);
    expect((await archive((await admin()).cookie, { id: done.id, media_id: done.shots[0].media_id, archived: true })).status).toBe(404);
    expect((await archive(cookie, { id: done.id, media_id: "not-a-shot", archived: true })).status).toBe(404);
    expect((await archive(cookie, { id: "nope", media_id: done.shots[0].media_id, archived: true })).status).toBe(404);
    expect((await archive(cookie, { id: done.id, media_id: done.shots[0].media_id })).status).toBe(422);
    // Hidden from anyone After Dark isn't open to.
    expect((await archive(signedIn(userIdOf(newUserCookie())), { id: done.id, media_id: done.shots[0].media_id, archived: true })).status).toBe(404);
    expect(await archiveShot(t.db, id, done.id, done.shots[0].media_id!, true)).toMatchObject({ ok: true });
  });
});

describe("a chain of clips with one in the Archive", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 24, 12, m)).toISOString();
  const shot: ReelShot = { line: 0, who: "a", text: "", motion: "", status: "ready", media_id: "v", frame_id: "f" };
  const c = (id: string, m: number, from: string | null, opts: { status?: Reel["status"]; archived?: boolean } = {}): Reel => ({
    id,
    status: opts.status ?? "ready",
    tokens: 0,
    created_at: at(m),
    kind: "clip",
    clip: { act: "kiss", swap: false, from, stage: 2, place: null, label: "A slow kiss" },
    shots: [{ ...shot, media_id: `v-${id}`, status: opts.status === "failed" ? "failed" : opts.status === "making" ? "queued" : "ready", ...(opts.archived ? { archived_at: at(m + 30) } : {}) }],
  });

  it("keeps going from the last clip that still plays, and the one kept going from there takes the archived one's place", () => {
    const end = clipChains([c("c1", 1, null), c("c2", 2, "c1"), c("c3", 3, "c2", { archived: true })]);
    expect(end.map((ch) => ch.map((r) => r.id))).toEqual([["c1", "c2", "c3"]]);
    expect(keepGoingFrom(end[0])!.id).toBe("c2");
    const tried = clipChains([c("c1", 1, null), c("c2", 2, "c1"), c("c3", 3, "c2", { archived: true }), c("c4", 4, "c2")]);
    expect(tried.map((ch) => ch.map((r) => r.id))).toEqual([["c1", "c2", "c4"]]);
    expect(keepGoingFrom(tried[0])!.id).toBe("c4");
    // Still being made: nothing offered until it's in.
    expect(keepGoingFrom(clipChains([c("c1", 1, null), c("c2", 2, "c1", { archived: true }), c("c3", 3, "c1", { status: "making" })])[0])).toBeNull();
  });

  it("plays on past one in the middle, and a chain with every clip archived plays nothing", () => {
    const middle = clipChains([c("c1", 1, null), c("c2", 2, "c1", { archived: true }), c("c3", 3, "c2")]);
    expect(middle.map((ch) => ch.map((r) => r.id))).toEqual([["c1", "c2", "c3"]]);
    expect(middle[0].flatMap((r) => r.shots.filter(playable).map((s) => s.media_id))).toEqual(["v-c1", "v-c3"]);
    expect(keepGoingFrom(middle[0])!.id).toBe("c3");
    const gone = clipChains([c("c1", 1, null, { archived: true })]);
    expect(gone[0].every(archivedClip)).toBe(true);
    expect(keepGoingFrom(gone[0])).toBeNull();
  });
});

describe("a Short and the Archive", () => {
  it("films a night by the shots that play: one taken out doesn't count", () => {
    const said = [{ who: "a" as const, text: "Hello there.", stage: 0 }];
    const good: ReelShot = { line: 0, who: "a", text: "Hello there.", motion: "", status: "ready", media_id: "v1" };
    const stray: ReelShot = { line: 3, who: "b", text: "Not in these lines.", motion: "", status: "ready", media_id: "v2" };
    expect(filmed(said, [good, stray])).toBe(false);
    expect(filmed(said, [good, { ...stray, archived_at: "2026-10-24T12:00:00.000Z" }])).toBe(true);
    expect(filmed(said, [{ ...good, archived_at: "2026-10-24T12:00:00.000Z" }])).toBe(false);
  });
});

describe("a viewer's next video", () => {
  it("starts from the face they picked and steers each shot away from what their ratings said was off", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    fakeHive();
    const first = await kiss(cookie);
    // The shot morphed: 👎, jerky or morphing. And a face of Juniper alone they like better than her baseline.
    expect((await rateMedia(t.db, id, first.shots[0].media_id!, -1, ["motion"])).ok).toBe(true);
    expect((await listReels(t.db, id, RAFE, JUNIPER))[0].shots[0]).toMatchObject({ rating: -1, tags: ["motion"] });
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('juniper-liked', $1, $2, 'scene', 'p', 'image/png', $3)`, [id, JUNIPER, Buffer.from(PNG)]);
    expect(await setFaceReference(t.db, id, JUNIPER, "juniper-liked")).toEqual({ ok: true, image_id: "juniper-liked", nude: false });
    seen.length = 0;
    const next = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    expect(next.status).toBe("making");
    const faces = (seen.find((s) => s.path === "/image/multi-edit")!.body.images as string[]).map(mediaOf);
    expect(faces.slice(0, 2)).toEqual(["juniper-liked", "base-rafe"]);
    const queued = seen.find((s) => s.path === "/video/queue")!.body;
    expect(String(queued.negative_prompt)).toMatch(/^child, teen, minor/);
    expect(String(queued.negative_prompt)).toContain(TAG_FIXES.motion.video!);
    // A rating taken back steers nothing.
    await rateMedia(t.db, id, first.shots[0].media_id!, 0);
    seen.length = 0;
    await advance(next.id, cookie);
    await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" });
    expect(String(seen.find((s) => s.path === "/video/queue")!.body.negative_prompt)).not.toContain(TAG_FIXES.motion.video!);
  });
});
