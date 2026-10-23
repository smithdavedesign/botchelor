import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { GET as clipsGet, POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { ACTS, actFor, actMenu, actSays, crossesTaboo, NO_MEDIA_LIMITS, rolesFor, type MediaLimits } from "@/lib/adult/acts";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { CHAIN_MAX, clipChains, keepGoingFrom } from "@/lib/adult/clip-chains";
import { directHere } from "@/lib/adult/clips";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { continuePrompt, listReels, reelCast, setReelFetchForTests, setReelPausesForTests, shotPrompt, type Reel } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { getAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { normalizeScene } from "@/lib/venues";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Clips on demand (lib/adult/clips.ts, lib/adult/acts.ts; David 2026-10-22): no live calls here.
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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[3].id]);
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
const [RAFE, JUNIPER, MARISOL] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[3].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const scripted = (reply: string) => setAdultModelForTests({ complete: async () => reply });
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const CHILD_MOD = { output: [{ classes: [{ class: "no_child_present", value: 0.5 }, { class: "yes_child_present", value: 0.5 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
/** Hive: everything passes, unless `refuse` answers a call (n counts the calls). */
function fakeHive(refuse: (n: number, vlm: boolean) => unknown = () => null) {
  let n = 0;
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    seen.push(vlm ? "vlm" : "moderation");
    const custom = refuse(n++, vlm);
    if (custom instanceof Response) return custom;
    if (custom) return Response.json(custom);
    return Response.json(vlm ? ADULTS : CLEAN_MOD);
  });
  return seen;
}
/** Venice: keyframes, queues, and a shot that's done on the first retrieve. Records what was asked. */
function fakeVenice(opts: { keyframe?: () => Response; queue?: () => Response } = {}) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/image/multi-edit") return opts.keyframe?.() ?? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/audio/speech") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    if (path === "/video/queue") return opts.queue?.() ?? Response.json({ model: body.model, queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}
const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];
const night = (n: number, stage: number) =>
  Array.from({ length: n }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage }));

/** After Dark on (Venice and Hive keys), both baselines in, and the pair's scene at `stage` with these lines. */
async function ready(cookie: string, ownerId: string, opts: { lines?: unknown[]; stage?: number; place?: string | null; settings?: Record<string, unknown> } = {}) {
  const stage = opts.stage ?? 0;
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", ...opts.settings }, cookie);
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const res = await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }));
  const scene = (await res.json()).scene as { id: string; a: { id: string }; b: { id: string } };
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = $3, place = $4, set_place = $4 where id = $1`, [scene.id, JSON.stringify(opts.lines ?? night(8, stage)), stage, opts.place === undefined ? "her bedroom" : opts.place]);
  return scene;
}
const clip = (cookie: string, body: Record<string, unknown>) => call(clipsPost, "/api/admin/after-dark/clips", body, cookie);
const menu = async (cookie: string) => (await (await clipsGet(new Request(`${BASE_URL}/api/admin/after-dark/clips?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()) as {
  price: number;
  here: { available: boolean; why: string | null };
  acts: { id: string; available: boolean; why: string | null; says: string }[];
};
const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;

async function castOf() {
  const [juniper, rafe] = await Promise.all([loadCharacter(t.db, JUNIPER), loadCharacter(t.db, RAFE)]);
  return { cast: reelCast(juniper!, rafe!), names: [juniper!.name, rafe!.name] as [string, string] };
}

describe("the act menu", () => {
  it("offers only what the night has reached, and nothing past kissing somewhere public", async () => {
    const { cast, names } = await castOf();
    const at = (stage: number, publicPlace = false) => Object.fromEntries(actMenu({ stage, publicPlace }, cast, names).map((a) => [a.id, a.available ? "yes" : a.why]));
    expect(at(0)).toMatchObject({ close: "yes", dance: "yes", cuddle: "Once they've got to tension and the first touches", kiss: "Once they've got to kissing", on_top: "Once they've got to sex" });
    expect(at(2)).toMatchObject({ cuddle: "yes", kiss: "yes", wall: "yes", undress: "Once they've got to undressing" });
    expect(Object.values(at(4)).every((v) => v === "yes")).toBe(true);
    // In a restaurant at sex: they kiss, and the rest waits until they've gone somewhere private.
    expect(at(4, true)).toMatchObject({ kiss: "yes", wall: "yes", undress: "Somewhere private first", on_top: "Somewhere private first", afterglow: "Somewhere private first" });
    expect(actMenu({ stage: 4, publicPlace: false }, cast, names)).toHaveLength(ACTS.length);
  });

  it("never offers what the pair's limits rule out: past the intensity, a hard no, or words that cross one", async () => {
    const { cast, names } = await castOf();
    const ids = (limits: MediaLimits) => actMenu({ stage: 4, publicPlace: false }, cast, names, limits).map((a) => a.id);
    // Flirty goes as far as undressing: no sex acts on the menu at all, not even locked.
    expect(ids({ ...NO_MEDIA_LIMITS, maxStage: 3 })).toEqual(["close", "dance", "cuddle", "kiss", "wall", "undress"]);
    expect(ids({ ...NO_MEDIA_LIMITS, maxStage: 2 })).not.toContain("undress");
    // A hard no by id, and one by its words (lib/adult/limits.ts's matcher: here, anything "against a wall").
    expect(ids({ ...NO_MEDIA_LIMITS, hardNos: ["oral"] })).not.toContain("oral");
    expect(ids({ ...NO_MEDIA_LIMITS, hit: (text) => (/against a wall/.test(text) ? "crossed a hard limit (Walls)" : null) })).not.toContain("wall");
    expect(ids(NO_MEDIA_LIMITS)).toContain("oral");
  });

  it("puts both of them in every still, posed and placed, faces visible, never by name; who leads follows the act, and swaps", async () => {
    const { cast, names } = await castOf();
    expect(cast.map((p) => p.tag)).toEqual(["the woman", "the man"]);
    for (const act of ACTS) {
      for (const swap of [false, true]) {
        const a = actFor(act, cast, swap);
        for (const text of [a.frame, a.motion, a.next]) {
          expect(text).not.toMatch(/Juniper|Rafe|Calloway|\{|\}/);
          expect(checkAdultText({ text }).ok).toBe(true);
          expect(crossesTaboo(text)).toBe(false);
        }
        expect(a.frame).toMatch(/the woman/i);
        expect(a.frame).toMatch(/the man/i);
        expect(a.frame).toMatch(/faces?\b/);
        expect(a.frame).toMatch(/^[A-Z]/);
      }
    }
    const onTop = ACTS.find((a) => a.id === "on_top")!;
    const behind = ACTS.find((a) => a.id === "behind")!;
    // A man and a woman: on top is her, behind is him, unless swapped.
    expect(rolesFor(onTop, cast)).toEqual({ x: 0, y: 1 });
    expect(actFor(onTop, cast).frame).toContain("the woman sits astride the man's hips");
    expect(actFor(onTop, cast, true).frame).toContain("the man sits astride the woman's hips");
    expect(actFor(behind, cast).frame).toContain("having sex from behind: the woman is on her hands and knees and the man kneels behind her");
    expect(actSays(onTop, cast, names)).toBe("Juniper on top of Rafe");
    expect(actSays(behind, cast, names, true)).toBe("Juniper behind Rafe");
    // Two women: told apart by their hair, the first leading unless swapped.
    const marisol = (await loadCharacter(t.db, MARISOL))!;
    const juniper = (await loadCharacter(t.db, JUNIPER))!;
    const women = reelCast(juniper, marisol);
    const lap = actFor(ACTS.find((a) => a.id === "lap")!, women);
    expect(lap.frame).toContain(`${women[1].tag} sits on the edge of a bed and ${women[0].tag} sits astride ${women[1].tag}'s lap`);
    expect(women.map((w) => w.tag)).toEqual(["the woman with long auburn hair", "the woman with a sleek black bob"]);
  });

  it("holds David's lines on anything a picture or video model reads: no step-family, teacher and student, school or age-play", () => {
    for (const bad of ["her stepsister watches", "step-dad and", "a teacher and her student", "his professor leans in", "in a school uniform", "back in the dorm", "age play", "daddy's little one", "pigtails and"]) {
      expect(crossesTaboo(bad)).toBe(true);
    }
    for (const fine of ["a pottery class at dusk", "the pupils of her eyes widen", "old friends from the pottery studio", "she steps closer", "a step back"]) expect(crossesTaboo(fine)).toBe(false);
  });
});

describe("a clip from the menu", () => {
  it("films the act from a keyframe of both baselines in the night's set, checked before it's kept, with nobody speaking (David, 2026-10-22)", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 4 });
    await t.db.query(`insert into place_sets (normalized, label, status, mime, data) values ($1, $2, 'ready', 'image/jpeg', $3)`, [normalizeScene("her bedroom"), "her bedroom", Buffer.from([0xff, 0xd8, 0xff])]);
    const seen = fakeVenice();
    const checks = fakeHive();
    const res = await clip(cookie, { a: RAFE, b: JUNIPER, act: "on_top" });
    expect(res.status).toBe(200);
    const started = (await res.json()).reel as Reel;
    expect(started).toMatchObject({ status: "making", tokens: 0, kind: "clip", clip: { act: "on_top", swap: false, from: null, stage: 4, label: "On top" } });
    const edit = seen.find((s) => s.path === "/image/multi-edit")!;
    expect((edit.body.images as string[]).slice(0, 2).map(mediaOf)).toEqual(["base-juniper", "base-rafe"]);
    expect((edit.body.images as string[])[2]).toMatch(/^data:image\/jpeg;base64,/);
    const prompt = String(edit.body.prompt);
    expect(prompt).toMatch(/^Make one photograph of the woman from Picture 1 and the man from Picture 2 together, in the place from Picture 3\./);
    expect(prompt).toContain("the woman sits astride the man's hips");
    expect(prompt).toContain("A medium shot from the side, from their thighs up.");
    expect(prompt).toContain("Explicit, uncensored, photorealistic. Both are adults.");
    expect(prompt).not.toMatch(/Juniper|Rafe/);
    expect(prompt.length).toBeLessThanOrEqual(1500);
    // Hive saw the keyframe (moderation and the age question) before it was kept, and the video started from it.
    expect(checks).toEqual(["moderation", "vlm"]);
    const frame = (await t.db.query<{ id: string }>(`select id from adult_images where kind = 'frame'`)).rows[0];
    expect(started.shots[0].frame_id).toBe(frame.id);
    const queued = seen.find((s) => s.path === "/video/queue")!;
    expect(mediaOf(queued.body.image_url)).toBe(frame.id);
    expect(queued.body).toMatchObject({ model: "wan-3-0-image-to-video", duration: "5s", audio: true });
    expect(String(queued.body.prompt)).toMatch(/^The woman rides him slowly, rolling her hips; the man holds the woman's hips and moves with her\. Two people only/);
    expect(String(queued.body.prompt)).toMatch(/Neither of them speaks: only their breathing and the sounds of the room\.$/);
    // Collected by the reel poll, checked again, and listed with the pair's videos as a clip.
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots[0]).toMatchObject({ status: "ready", frame_id: frame.id });
    const listed = await listReels(t.db, id, RAFE, JUNIPER);
    expect(listed.map((r) => [r.kind, r.clip?.label])).toEqual([["clip", "On top"]]);
  });

  it("refuses what the night hasn't reached, or somewhere public, before anything is spent", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2 });
    const seen = fakeVenice();
    fakeHive();
    const early = await clip(cookie, { a: RAFE, b: JUNIPER, act: "on_top" });
    expect(early.status).toBe(422);
    expect((await early.json()).message).toBe("On top: once they've got to sex.");
    await t.db.query(`update adult_scenes set stage = 4, place = 'the restaurant', set_place = 'restaurant'`);
    const out = await clip(cookie, { a: RAFE, b: JUNIPER, act: "undress" });
    expect(out.status).toBe(422);
    expect((await out.json()).message).toBe("Undressing each other: somewhere private first.");
    expect((await clip(cookie, { a: RAFE, b: JUNIPER, act: "nope" })).status).toBe(422);
    expect(seen).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_reels`)).rows).toHaveLength(0);
    // A kiss is fine in public.
    expect((await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).status).toBe(200);
  });

  it("costs a subscriber clip_tokens (3 by default), and gives them back when the check discards it or a provider fails", async () => {
    const { id: adminId, cookie: adminCookie } = await admin();
    await ready(adminCookie, adminId, { stage: 2 });
    expect((await getAdultSettings(t.db)).clip_tokens).toBe(3);
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const cookie = signedIn(sub);
    const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene;
    await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2 where id = $1`, [scene.id, JSON.stringify(night(8, 2))]);
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0]?.used ?? 0;
    expect((await menu(cookie)).price).toBe(3);
    expect((await menu(adminCookie)).price).toBe(0);
    fakeVenice();
    fakeHive();
    expect((await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 20, 'test')`, [crypto.randomUUID(), sub]);

    // The keyframe shows a child signal: discarded, never stored, logged, and the tokens back.
    fakeHive((n, vlm) => (!vlm ? CHILD_MOD : null));
    const refused = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    expect(refused).toMatchObject({ status: "failed", tokens: 3 });
    expect(refused.shots[0]).toMatchObject({ status: "discarded" });
    expect(await used()).toBe(0);
    expect((await t.db.query(`select 1 from adult_images where kind = 'frame'`)).rows).toHaveLength(0);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows[0].reason).toMatch(/^keyframe: moderation: yes_child_present/);

    // Venice out of credit: nothing made, the tokens back.
    fakeHive();
    fakeVenice({ keyframe: () => new Response(JSON.stringify({ error: "Insufficient USD or Diem balance" }), { status: 402 }) });
    const broke = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    expect(broke.status).toBe("failed");
    expect(broke.shots[0].reason).toMatch(/^Venice 402/);
    expect(await used()).toBe(0);

    // A video the check discards when it's collected: the tokens back then.
    fakeVenice();
    const made = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    expect(made.status).toBe("making");
    expect(await used()).toBe(3);
    fakeHive(() => CHILD_MOD);
    const settled = await advance(made.id, cookie);
    expect(settled).toMatchObject({ status: "failed" });
    expect(settled.shots[0].status).toBe("discarded");
    expect(await used()).toBe(0);
    // One that comes through is paid for.
    fakeHive();
    const kept = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    expect((await advance(kept.id, cookie)).status).toBe("ready");
    expect(await used()).toBe(3);
  });

  it("is one video at a time, with the videos of the night", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2, lines: night(12, 2) });
    fakeVenice();
    fakeHive();
    scripted("not json");
    const reel = await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER }, cookie);
    expect((await reel.json()).reel.status).toBe("making");
    const busy = await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" });
    expect(busy.status).toBe(409);
    expect((await busy.json()).message).toMatch(/still being made/);
  });

  it("lists the menu for the night as it stands, with who's who by name", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 1, lines: night(1, 1) });
    const m = await menu(cookie);
    expect(m.here).toEqual({ available: false, why: "Write a few lines first" });
    expect(m.acts.find((a) => a.id === "cuddle")).toMatchObject({ available: true, says: "Juniper and Rafe, cuddled up" });
    expect(m.acts.find((a) => a.id === "on_top")).toMatchObject({ available: false, why: "Once they've got to sex", says: "Juniper on top of Rafe" });
    expect((await clipsGet(new Request(`${BASE_URL}/api/admin/after-dark/clips?a=${RAFE}&b=${JUNIPER}`))).status).toBe(404);
  });
});

describe("a clip from here", () => {
  it("films the latest moment as the director writes it, held to the stage the night has reached, and says the line it picks", async () => {
    const { id, cookie } = await admin();
    const lines = [...night(6, 2), { who: "b", text: "*pulls her in by the waist* Come here, you menace.", stage: 2 }];
    await ready(cookie, id, { stage: 2, lines });
    const seen = fakeVenice();
    fakeHive();
    scripted(JSON.stringify({ frame: "By the window, Juniper with her back to the glass and Rafe close in front of her, kissing, both dressed. Medium shot.", motion: "Rafe pulls Juniper in by the waist; she laughs into the kiss.", line: 6 }));
    const res = await clip(cookie, { a: RAFE, b: JUNIPER, here: true });
    expect(res.status).toBe(200);
    const started = (await res.json()).reel as Reel;
    expect(started.clip).toMatchObject({ act: null, label: "From here", stage: 2 });
    expect(started.shots[0]).toMatchObject({ line: 6, who: "b", text: "Come here, you menace." });
    const prompt = String(seen.find((s) => s.path === "/image/multi-edit")!.body.prompt);
    expect(prompt).toContain("By the window, the woman with her back to the glass and the man close in front of her, kissing, both dressed.");
    expect(prompt).toContain("they're dressed as the moment says, not nude");
    const queued = seen.find((s) => s.path === "/video/queue")!;
    expect(String(queued.body.prompt)).toMatch(/^The man pulls the woman in by the waist; she laughs into the kiss\./);
    expect(String(queued.body.prompt)).toMatch(/The man, in a man's voice, says: "Come here, you menace\."$/);
  });

  it("falls back to the plain still when what the director wrote goes past the night, or crosses a limit", async () => {
    const { cast } = await castOf();
    const lines = night(6, 1);
    scripted(JSON.stringify({ frame: "On the bed, both nude, the woman on top of the man, having sex.", motion: "She thrusts against him.", line: 99 }));
    const d = await directHere(t.db, cast, lines, lines.map(() => "her bedroom"), 1, NO_MEDIA_LIMITS);
    expect(d.frame).toBe("The woman and the man, close together, one's hand on the other's waist, both dressed, looking into each other's eyes. Medium shot, both faces visible.");
    expect(d.motion).toBe("The man leans closer, and the other answers it.");
    expect(d.line).toBeNull();
    scripted(JSON.stringify({ frame: "They stand by the wall, close, both dressed.", motion: "He presses her against the wall.", line: 5 }));
    const limited = await directHere(t.db, cast, lines, lines.map(() => null), 1, { ...NO_MEDIA_LIMITS, hit: (x) => (/wall/.test(x) ? "crossed a hard limit (Walls)" : null) });
    expect(limited.frame).not.toMatch(/wall/);
    expect(limited.motion).not.toMatch(/wall/);
    expect(limited.line).toBe(5);
  });

  it("needs a few lines first", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 0, lines: night(1, 0) });
    const res = await clip(cookie, { a: RAFE, b: JUNIPER, here: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("too_short");
  });
});

describe("keep going", () => {
  it("carries a finished clip on: its keyframe is the third picture, the act's next motion, up to a chain's end", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2 });
    const seen = fakeVenice();
    fakeHive();
    const first = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    // Not before it's in.
    expect((await clip(cookie, { continue: first.id })).status).toBe(409);
    expect((await advance(first.id, cookie)).status).toBe("ready");
    const firstFrame = (await advance(first.id, cookie)).shots[0].frame_id!;
    seen.length = 0;
    const res = await clip(cookie, { continue: first.id });
    expect(res.status).toBe(200);
    const next = (await res.json()).reel as Reel;
    expect(next.clip).toMatchObject({ act: "kiss", from: first.id, label: "A slow kiss", stage: 2 });
    const edit = seen.find((s) => s.path === "/image/multi-edit")!;
    expect((edit.body.images as string[]).map(mediaOf)).toEqual(["base-juniper", "base-rafe", firstFrame]);
    expect(String(edit.body.prompt)).toMatch(/^Make one photograph of the woman from Picture 1 and the man from Picture 2 together, a few seconds after the moment in Picture 3\./);
    expect(String(edit.body.prompt)).toContain("after this: They kiss slowly and deeply; the woman's thumb strokes the man's cheek.");
    expect(String(seen.find((s) => s.path === "/video/queue")!.body.prompt)).toMatch(/^They part for a breath, foreheads together, then kiss again, deeper\./);
    // Someone else's clip isn't theirs to keep going, even another admin's.
    expect((await clip((await admin()).cookie, { continue: first.id })).status).toBe(404);
    // A chain stops at CHAIN_MAX shots.
    let from = next;
    for (let k = 2; k < CHAIN_MAX; k++) {
      expect((await advance(from.id, cookie)).status).toBe("ready");
      from = (await (await clip(cookie, { continue: from.id })).json()).reel as Reel;
    }
    expect((await advance(from.id, cookie)).status).toBe("ready");
    const full = await clip(cookie, { continue: from.id });
    expect(full.status).toBe(409);
    expect((await full.json()).error).toBe("chain_full");
    const chains = clipChains(await listReels(t.db, id, RAFE, JUNIPER));
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(CHAIN_MAX);
    expect(keepGoingFrom(chains[0])).toBeNull();
  });

  it("asks the director what happens next for a clip from here", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2 });
    const seen = fakeVenice();
    fakeHive();
    scripted(JSON.stringify({ frame: "By the door, the woman and the man kissing, both dressed.", motion: "They kiss by the door.", line: null }));
    const first = (await (await clip(cookie, { a: RAFE, b: JUNIPER, here: true })).json()).reel as Reel;
    await advance(first.id, cookie);
    scripted(JSON.stringify({ motion: "Rafe lifts her chin and kisses her again, slower." }));
    seen.length = 0;
    const next = (await (await clip(cookie, { continue: first.id })).json()).reel as Reel;
    expect(next.shots[0].motion).toBe("The man lifts her chin and kisses her again, slower.");
    expect(String(seen.find((s) => s.path === "/image/multi-edit")!.body.prompt)).toContain("after this: They kiss by the door.");
  });
});

describe("a clip on Replicate", () => {
  it("draws the keyframe with Qwen-Image-Edit and films it with Wan 2.2, and says nothing for an act", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2, settings: { media_provider: "replicate", replicate_key: "placeholder-replicate-RPLC" } });
    fakeHive();
    const seen: { url: string; body: Record<string, unknown> | undefined }[] = [];
    let n = 0;
    setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      seen.push({ url, body });
      if (url.startsWith("https://replicate.delivery/")) return new Response(url.endsWith(".mp4") ? new Uint8Array([0, 0, 0, 24]) : PNG, { headers: { "content-type": url.endsWith(".mp4") ? "video/mp4" : "image/png" } });
      if (url.includes("/models/qwen/qwen-image-edit-2511/predictions")) return Response.json({ id: `k${++n}`, status: "succeeded", output: [`https://replicate.delivery/xe/k${n}/out-0.png`] }, { status: 201 });
      if (url.includes("/models/wan-video/wan-2.2-i2v-fast/predictions")) return Response.json({ id: "v1", status: "starting" }, { status: 201 });
      if (url.endsWith("/predictions/v1")) return Response.json({ id: "v1", status: "succeeded", output: "https://replicate.delivery/xe/v1/output.mp4" });
      return new Response("unexpected", { status: 500 });
    });
    const started = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
    expect(started.shots[0]).toMatchObject({ provider: "replicate", queue_id: "v1" });
    const video = seen.find((s) => s.url.includes("wan-2.2"))!;
    expect(video.body!.input).toMatchObject({ num_frames: 81, disable_safety_checker: true });
    expect(String((video.body!.input as { prompt: string }).prompt)).toMatch(/Neither of them speaks/);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    // No line in it: no voice asked for.
    expect(seen.some((s) => String(s.body?.version ?? "").length === 64)).toBe(false);
    expect(done.shots[0].audio_id).toBeUndefined();
  });
});

describe("the settings and the list", () => {
  it("save the clip price, and play a clip and the ones kept going from it as one", async () => {
    const { cookie } = await admin();
    const saved = await (await call(settingsPost, "/api/admin/after-dark/settings", { clip_tokens: 5 }, cookie)).json();
    expect(saved.settings.clip_tokens).toBe(5);
    expect((await call(settingsPost, "/api/admin/after-dark/settings", { clip_tokens: -1 }, cookie)).status).toBe(422);
    const at = (m: number) => new Date(Date.UTC(2026, 9, 22, 12, m)).toISOString();
    const shot = { line: 0, who: "a" as const, text: "", motion: "", status: "ready" as const, media_id: "v", frame_id: "f" };
    const c = (id: string, m: number, from: string | null, status: Reel["status"] = "ready"): Reel => ({
      id,
      status,
      tokens: 0,
      created_at: at(m),
      kind: "clip",
      clip: { act: "kiss", swap: false, from, stage: 2, place: null, label: "A slow kiss" },
      shots: [{ ...shot, status: status === "failed" ? "failed" : status === "making" ? "queued" : "ready" }],
    });
    // c1 → c2 → (c3 failed, then c4 tried again); x1 on its own, newer.
    const chains = clipChains([c("c1", 1, null), c("c2", 2, "c1"), c("c3", 3, "c2", "failed"), c("c4", 4, "c2"), c("x1", 5, null)]);
    expect(chains.map((ch) => ch.map((r) => r.id))).toEqual([["x1"], ["c1", "c2", "c4"]]);
    expect(keepGoingFrom(chains[1])!.id).toBe("c4");
    // Kept going and it failed: it shows, and it can be tried again from the one before.
    const failedEnd = clipChains([c("c1", 1, null), c("c2", 2, "c1", "failed")]);
    expect(failedEnd[0].map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(keepGoingFrom(failedEnd[0])!.id).toBe("c1");
    expect(keepGoingFrom(clipChains([c("c1", 1, null), c("c2", 2, "c1", "making")])[0])).toBeNull();
  });

  it("keeps a clip with no line silent in the shot prompt, and a continuation within the edit model's limit", async () => {
    const { cast } = await castOf();
    expect(shotPrompt(cast, { who: "a", text: "", motion: "They sway." }, false)).toMatch(/Neither of them speaks/);
    expect(shotPrompt(cast, { who: "a", text: "", motion: "They sway." }, true)).toMatch(/Neither of them speaks/);
    const long = continuePrompt(cast, "they keep going ".repeat(200), 4);
    expect(long.length).toBeLessThanOrEqual(1500);
    expect(long).toMatch(/Explicit, uncensored, photorealistic\. Both are adults\.$/);
    expect(continuePrompt(cast, "they sway", 4, { explicit: false })).toMatch(/Sensual and tasteful, nothing graphic/);
  });
});

// The scene route is imported so the pair's scene exists the way the page makes it.
void POST;
