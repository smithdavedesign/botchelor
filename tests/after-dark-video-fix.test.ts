import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as momentsPost } from "@/app/api/admin/after-dark/moments/route";
import { GET as studioGet, POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { GET as fixGet, POST as fixPost } from "@/app/api/admin/after-dark/video-fix/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { animatePrompt } from "@/lib/adult/studio-catalog";
import type { AnimationLinks } from "@/lib/adult/studio-chains";
import { cleanProblems, fixLead, fixNegative, fixNote, problemsFromTags, VIDEO_FIXES_MAX, VIDEO_PROBLEMS, type VideoFixState } from "@/lib/adult/video-fix-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// 🩹 Fix for a Studio animation (lib/adult/video-fix.ts, David 2026-11-24: "There is no way to fix a video"): filmed again
// from where it started, told what went wrong; the first fix of a video marked broken free, once; each fix a new version
// that Keep can make the one shown. Venice and Hive are stubbed (a real little MP4 stands in for the video).

describe("what a fix tells the video model (lib/adult/video-fix-shared.ts)", () => {
  it("keeps known problems only, once each, in the chips' order, and starts on what a 👎 said", () => {
    expect(cleanProblems(["blurry", "nope", "wrong_person", "blurry", 3])).toEqual(["wrong_person", "blurry"]);
    expect(cleanProblems("blurry")).toEqual([]);
    // VIDEO_TAGS (lib/adult/rating-tags.ts): the voice and how explicit it was aren't a fix's to put right.
    expect(problemsFromTags(["wrong_person", "voice", "too_tame", "motion", "anatomy"])).toEqual(["wrong_person", "motion", "anatomy"]);
  });

  it("says each problem's put right after what's asked, keeps its terms out once, and names the fix", () => {
    expect(fixLead([])).toBe("");
    expect(fixNegative([])).toBe("");
    expect(fixLead(["wrong_person", "blurry"])).toBe(`${VIDEO_PROBLEMS.wrong_person.lead} ${VIDEO_PROBLEMS.blurry.lead}`);
    expect(fixNegative(["blurry", "blurry"])).toBe("blurry, out of focus");
    expect(fixNegative(["wrong_person", "motion"])).toContain("a face swap, a changing face, morphing face, morphing, warping");
    expect(fixNegative(["action"])).toBe("");
    expect(fixNote(["wrong_person", "still"], null)).toBe("Face changed or wrong person · Barely moves");
    expect(fixNote([], "she laughs")).toBe("“she laughs”");
    expect(fixNote(["blurry"], " she laughs ")).toBe("Blurry — “she laughs”");
    expect(fixNote([], "  ")).toBeNull();
    // In the prompt: right after what's asked, before how it moves.
    const p = animatePrompt({ noun: "woman" }, 0, "turns slowly", { guide: "she waves" }, { fix: fixLead(["still"]) });
    expect(p.indexOf(VIDEO_PROBLEMS.still.lead)).toBeGreaterThan(p.indexOf("she waves"));
    expect(p.indexOf(VIDEO_PROBLEMS.still.lead)).toBeLessThan(p.indexOf("turns slowly"));
    expect(animatePrompt({ noun: "woman" }, 0, "turns slowly", {}, { fix: "" })).toBe(animatePrompt({ noun: "woman" }, 0, "turns slowly"));
  });

  it("offers Fix on a video's tile, bolder after a 👎 it can put right", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: VideoFixButton, videoFixNudge } = await import("@/app/after-dark/VideoFixSheet");
    expect(videoFixNudge(-1, [])).toBe(true);
    expect(videoFixNudge(-1, ["motion"])).toBe(true);
    expect(videoFixNudge(-1, ["too_tame"])).toBe(false);
    expect(videoFixNudge(1, ["motion"])).toBe(false);
    expect(videoFixNudge(null, [])).toBe(false);
    const quiet = renderToStaticMarkup(createElement(VideoFixButton, { id: "v1", src: (id: string) => `/m/${id}`, label: "The video of Mara" }));
    expect(quiet).toContain("🩹 Fix");
    expect(quiet).not.toContain("Something off?");
    const bold = renderToStaticMarkup(createElement(VideoFixButton, { id: "v1", src: (id: string) => `/m/${id}`, label: "The video of Mara", nudge: true }));
    expect(bold).toContain("Something off? Fix films it again, told what went wrong.");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let MP4: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  // 3 s of a moving test pattern: what Venice's finished video stands in for.
  const { files } = await runFfmpeg({
    args: ["-f", "lavfi", "-i", "testsrc2=duration=3:size=240x320:rate=24", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"],
    inputs: {},
    outputs: ["clip.mp4"],
  });
  MP4 = files["clip.mp4"];
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
  setStudioPausesForTests(false);
  setCheckSleepForTests(async () => {});
  // Never a live call: nothing here asks Venice's vision model.
  setModerationFetchForTests(async () => new Response("not stubbed", { status: 599 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setModerationFetchForTests(null);
  setCheckSleepForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
  setStudioPausesForTests(true);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const mod = (nsfw: number, child = 0.01) => ({ output: [{ classes: [{ class: "yes_child_present", value: child }, { class: "no_child_present", value: 1 - child }, { class: "general_nsfw", value: nsfw }] }] });
const answer = (a: string) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: a }) } }] });
/** Hive, stubbed: adults, and how explicit it scores each picture or video. */
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? answer("ADULTS") : mod(0.2)));
}
/** Venice, stubbed: videos queued and then ready (a real MP4) once `video.ready`; `fail` refuses a queue. */
function fakeVenice() {
  const edits: unknown[] = [];
  const video = { ready: false, fail: false, queued: [] as Record<string, unknown>[] };
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(input).endsWith("/image/multi-edit")) {
      edits.push(body);
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    }
    if (String(input).endsWith("/video/queue")) {
      if (video.fail) return new Response("upstream down", { status: 500 });
      video.queued.push(body);
      return Response.json({ queue_id: `q-${video.queued.length}` });
    }
    if (String(input).endsWith("/video/retrieve")) {
      if (body.delete_media_on_completion) return Response.json({ ok: true });
      return video.ready ? new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } }) : Response.json({ status: "PROCESSING" });
    }
    return new Response("?", { status: 500 });
  });
  setMediaFetchForTests(async () => Response.json({ images: [Buffer.from(PNG).toString("base64")] }));
  return { edits, video };
}

type Me = { id: string; cookie: string; character: string };
type Studio = { animating: unknown[]; shoots: { kind: string; status: string; pictures: string[] }[]; animation_links: AnimationLinks; studio_gallery: { id: string }[] };
const studio = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const moments = (body: unknown, cookie: string) =>
  momentsPost(new Request(`${BASE_URL}/api/admin/after-dark/moments`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const studioState = async (me: Me) => (await (await studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?character=${me.character}`, { headers: { cookie: me.cookie } }))).json()).state as Studio;
const fix = async (me: Me, body: Record<string, unknown>) => {
  const res = await fixPost(new Request(`${BASE_URL}/api/admin/after-dark/video-fix`, { method: "POST", headers: { "content-type": "application/json", cookie: me.cookie }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as { message?: string; error?: string; state?: VideoFixState; hidden?: string[]; shoot?: { status: string; tokens: number } } };
};
const fixState = async (me: Me, mediaId: string) => {
  const res = await fixGet(new Request(`${BASE_URL}/api/admin/after-dark/video-fix?media_id=${mediaId}`, { headers: { cookie: me.cookie } }));
  const body = (await res.json()) as { state?: VideoFixState; error?: string };
  return { status: res.status, state: body.state as VideoFixState, error: body.error };
};
const used = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;
const row = async (id: string) =>
  (await t.db.query<{ fixed_from: string | null; fix_root: string | null; fix_kind: string | null; fix_note: string | null; source_image: string | null }>(`select fixed_from, fix_root, fix_kind, fix_note, source_image from adult_images where id = $1`, [id])).rows[0];

const clips = async (who: string) => (await t.db.query<{ clips: number }>(`select clips from adult_usage where owner_id = $1`, [who])).rows[0]?.clips ?? 0;

/** After Dark on and the Studio open; a subscriber with 20 tokens, a character of theirs with a face, and a picture of them. */
async function setup(opts: { pictures?: boolean } = {}): Promise<Me> {
  const id = crypto.randomUUID();
  const cookie = signedInCookie(id);
  await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [id, `g-${id}`, `${id.slice(0, 8)}@example.test`]);
  const c = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 29 }), cookie)).json()) as { id: string };
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 20, 'test')`, [crypto.randomUUID(), id]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    studio: { open_to: "entitled" },
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [id, c.id]);
  if (opts.pictures !== false) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [id, c.id, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('pic-1', $1, $2, 'scene', 'p', 'image/png', $3)`, [id, c.id, Buffer.from(PNG)]);
  }
  return { id, cookie, character: c.id };
}

describe("🩹 Fix on a Studio animation", () => {
  let venice: ReturnType<typeof fakeVenice>;
  /** The animation (or fix) being made, collected (Venice has it ready): the newest video's id. */
  async function collected(me: Me): Promise<string> {
    venice.video.ready = true;
    const s = await studioState(me);
    venice.video.ready = false;
    expect(s.animating).toHaveLength(0);
    expect(s.shoots[0]).toMatchObject({ kind: "animate", status: "ready" });
    return s.shoots[0].pictures[0];
  }
  /** A picture animated and collected: its video's id. */
  async function animated(me: Me, ask: Record<string, unknown> = { motion: "turn" }, imageId = "pic-1"): Promise<string> {
    const res = await studio({ action: "animate", character_id: me.character, image_id: imageId, seconds: 5, ...ask }, me.cookie);
    expect(res.status).toBe(200);
    return collected(me);
  }

  it("films it again from its picture, told what went wrong: the first fix free, each a version beside it, Keep picks the one shown", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    const first = await animated(me);
    expect(await used(me.id)).toBe(3);
    const open = await fixState(me, first);
    expect(open.status).toBe(200);
    expect(open.state).toMatchObject({ root: first, left: VIDEO_FIXES_MAX, making: false, free: true, price: 3, seconds: 5, words: "", motion: "Turn to camera", start: "pic-1", kept: null });
    expect(open.state.versions).toEqual([{ id: first, note: null, shown: true, created_at: expect.any(String) }]);

    // Nothing said wrong and nothing changed: nothing to fix, nothing spent or sent.
    const nothing = await fix(me, { media_id: first, problems: [], words: "" });
    expect([nothing.status, nothing.body.error]).toEqual([422, "nothing_to_fix"]);
    expect(venice.video.queued).toHaveLength(1);

    // Marked broken: free, from the very picture it began with, the problems put right in the prompt and kept out; it
    // replaces a broken clip, so not even the month's clips cap stops it.
    expect(await clips(me.id)).toBe(1);
    await t.db.query(`update adult_settings set cap_clips = 1 where id = 1`);
    const free = await fix(me, { media_id: first, problems: ["wrong_person", "still"] });
    expect(free.status).toBe(200);
    expect(free.body.message).toMatch(/^Filming it again, free: it takes a few minutes, and lands in the gallery beside the one you fixed\.$/);
    expect(free.body.shoot).toMatchObject({ status: "making", tokens: 0 });
    expect(await used(me.id)).toBe(3);
    const sent = venice.video.queued[1];
    expect(String(sent.image_url)).toContain("/media/pic-1.png?until=");
    expect(String(sent.prompt)).toContain(VIDEO_PROBLEMS.wrong_person.lead);
    expect(String(sent.prompt)).toContain(VIDEO_PROBLEMS.still.lead);
    expect(String(sent.prompt)).toContain("turns slowly to face the camera");
    expect(String(sent.negative_prompt)).toContain("a face swap");
    expect(String(sent.negative_prompt)).toContain("frozen");
    // While it's being made: one at a time, the free one spent, a fix counted.
    expect(free.body.state).toMatchObject({ making: true, free: false, left: VIDEO_FIXES_MAX - 1 });
    const busy = await fix(me, { media_id: first, problems: ["blurry"] });
    expect([busy.status, busy.body.error]).toEqual([409, "busy"]);

    // Collected as a new version of it, named for what was wrong, beside it in the gallery.
    const fix1 = await collected(me);
    expect(await row(fix1)).toEqual({ fixed_from: first, fix_root: first, fix_kind: "video", fix_note: "Face changed or wrong person · Barely moves", source_image: "pic-1" });
    const both = await fixState(me, fix1);
    expect(both.state.root).toBe(first);
    expect(both.state.versions.map((v) => [v.id, v.note, v.shown])).toEqual([
      [first, null, true],
      [fix1, "Face changed or wrong person · Barely moves", true],
    ]);
    expect((await studioState(me)).studio_gallery.map((m) => m.id)).toEqual(expect.arrayContaining([first, fix1]));
    expect(await clips(me.id)).toBe(1);

    // From the fix: no longer free, Animate's price, and one of the month's clips like any animation.
    const capped = await fix(me, { media_id: fix1, problems: ["motion"] });
    expect([capped.status, capped.body.error]).toEqual([429, "over_cap"]);
    await t.db.query(`update adult_settings set cap_clips = 5 where id = 1`);
    const paid = await fix(me, { media_id: fix1, problems: ["motion"] });
    expect(paid.status).toBe(200);
    expect(paid.body.message).toMatch(/^Filming it again: /);
    expect(await used(me.id)).toBe(6);
    const fix2 = await collected(me);
    expect(await clips(me.id)).toBe(2);
    expect(await row(fix2)).toMatchObject({ fixed_from: fix1, fix_root: first, fix_note: "Jerky or morphing" });

    // Keep the second: the gallery shows it, not the others (still in the sheet).
    const keep = await fix(me, { action: "keep", media_id: fix2 });
    expect(keep.status).toBe(200);
    expect(keep.body.hidden?.sort()).toEqual([first, fix1].sort());
    expect(keep.body.state).toMatchObject({ kept: fix2 });
    const shown = (await studioState(me)).studio_gallery.map((m) => m.id);
    expect(shown).toContain(fix2);
    expect(shown).not.toContain(first);
    expect(shown).not.toContain(fix1);
    // And back to the original.
    expect((await fix(me, { action: "keep", media_id: first })).status).toBe(200);
    const back = (await studioState(me)).studio_gallery.map((m) => m.id);
    expect(back).toContain(first);
    expect(back).not.toContain(fix2);

    // As many as VIDEO_FIXES_MAX for one video, however they're reached.
    expect((await fix(me, { media_id: first, problems: ["blurry"] })).status).toBe(200);
    await collected(me);
    const over = await fix(me, { media_id: fix2, problems: ["blurry"] });
    expect([over.status, over.body.error]).toEqual([409, "no_fixes_left"]);
    expect((await fixState(me, first)).state.left).toBe(0);
  });

  it("takes new words for what happens, at Animate's price; a free fix that doesn't come through is free again; it starts from the picture as it's kept", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    const first = await animated(me, { guide: "she waves" });
    expect((await fixState(me, first)).state).toMatchObject({ words: "she waves", motion: null });

    // The same words, spaced differently, aren't a change.
    const same = await fix(me, { media_id: first, words: "  she   waves " });
    expect([same.status, same.body.error]).toEqual([422, "nothing_to_fix"]);
    // New words alone: not marked broken, so Animate's price; the words lead it.
    const words = await fix(me, { media_id: first, words: "she blows a kiss" });
    expect(words.status).toBe(200);
    expect(await used(me.id)).toBe(6);
    expect(String(venice.video.queued[1].prompt)).toContain("Most important, do exactly this: she blows a kiss.");
    expect(String(venice.video.queued[1].prompt)).not.toContain("she waves");
    const fix1 = await collected(me);
    expect((await row(fix1)).fix_note).toBe("“she blows a kiss”");
    expect((await fixState(me, fix1)).state).toMatchObject({ words: "she blows a kiss", free: true });

    // The queue fails: nothing spent, nothing counted, still free.
    venice.video.fail = true;
    const down = await fix(me, { media_id: fix1, problems: ["blurry"] });
    expect(down.status).toBe(502);
    expect(down.body.message).not.toMatch(/tokens are back/);
    expect((await fixState(me, fix1)).state).toMatchObject({ free: true, left: VIDEO_FIXES_MAX - 1, making: false });
    venice.video.fail = false;
    // Queued, then it doesn't come through (the check discarded it, Venice gave up): free again, and not counted.
    expect((await fix(me, { media_id: fix1, problems: ["blurry"] })).status).toBe(200);
    expect((await fixState(me, fix1)).state).toMatchObject({ free: false, making: true });
    await t.db.query(`update adult_studio_shoots set status = 'failed' where owner_id = $1 and status = 'making'`, [me.id]);
    expect((await fixState(me, fix1)).state).toMatchObject({ free: true, making: false, left: VIDEO_FIXES_MAX - 1 });
    expect(await used(me.id)).toBe(6);

    // Its picture fixed and that fix kept (lib/adult/fix.ts): the next one starts from the kept picture.
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, fixed_from, fix_root, fix_kind) values ('pic-2', $1, $2, 'scene', 'p', 'image/png', $3, 'pic-1', 'pic-1', 'repair')`,
      [me.id, me.character, Buffer.from(PNG)],
    );
    await t.db.query(`update adult_images set superseded_by = 'pic-2' where id = 'pic-1'`);
    expect((await fixState(me, first)).state.start).toBe("pic-2");
    expect((await fix(me, { media_id: first, problems: ["anatomy"] })).status).toBe(200);
    expect(String(venice.video.queued.at(-1)!.image_url)).toContain("/media/pic-2.png?until=");
    expect(await used(me.id)).toBe(6);
  });

  it("films a link kept going again from the very frame it started from, never a fresh one", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    const first = await animated(me, { motion: "turn" }, "face-1");
    const cut = await moments({ action: "frame", media_id: first, at: "end" }, me.cookie);
    expect(cut.status).toBe(200);
    const frame = ((await cut.json()) as { frame: { id: string } }).frame.id;
    const kept = await studio({ action: "keep_going", character_id: me.character, video_id: first, frame_id: frame, seconds: 5, prompt: "she turns to the window" }, me.cookie);
    expect(kept.status).toBe(200);
    const link = await collected(me);
    const open = await fixState(me, link);
    // A link starts from a frame: there's no picture of theirs to fix first.
    expect(open.state).toMatchObject({ root: link, words: "she turns to the window", start: null, free: true });

    const again = await fix(me, { media_id: link, problems: ["extra"] });
    expect(again.status).toBe(200);
    expect(again.body.message).toMatch(/^Filming it again from where it started, free: /);
    const sent = venice.video.queued.at(-1)!;
    expect(String(sent.image_url)).toContain(`/media/${frame}.png?until=`);
    expect(String(sent.prompt)).toContain("Most important, do exactly this: she turns to the window.");
    expect(String(sent.prompt)).toContain(VIDEO_PROBLEMS.extra.lead);
    expect(String(sent.negative_prompt)).toContain("a stranger walking in");
    expect(venice.edits).toHaveLength(0);
    const fixed = await collected(me);
    expect(await row(fixed)).toMatchObject({ fixed_from: link, fix_root: link, source_image: frame });
    // Still the same link of the same chain.
    expect((await studioState(me)).animation_links[fixed]).toEqual({ from: first, seamless: true, words: "she turns to the window" });
  });

  it("is only for the owner's own Studio animations", async () => {
    const me = await setup();
    const other = await setup({ pictures: false });
    fakeHive();
    venice = fakeVenice();
    const theirs = await animated(me);
    // Someone else's: not found, and nothing sent.
    expect((await fixState(other, theirs)).status).toBe(404);
    const stranger = await fix(other, { media_id: theirs, problems: ["blurry"] });
    expect(stranger.status).toBe(404);
    // A video that isn't a Studio animation (a night's, a clip): not this sheet's.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('night-1', $1, $2, 'video', 'p', 'video/mp4', $3)`, [me.id, me.character, MP4]);
    expect((await fixState(me, "night-1")).status).toBe(404);
    // A picture: not a video.
    expect((await fixState(me, "pic-1")).status).toBe(404);
    expect(venice.video.queued).toHaveLength(1);
    // After Dark not open to them: hidden.
    const res = await fixGet(new Request(`${BASE_URL}/api/admin/after-dark/video-fix?media_id=${theirs}`));
    expect(res.status).toBe(404);
  });
});
