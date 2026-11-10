import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as momentsPost } from "@/app/api/admin/after-dark/moments/route";
import { GET as studioGet, POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { PICTURE_FIELD_MAX } from "@/lib/adult/beats";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { CHAIN_MAX, NEXT_WORDS_MAX, SEAMLESS_RUN_MAX } from "@/lib/adult/clip-chains";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests, VENICE_CHAT } from "@/lib/adult/moderation";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { animatePrompt, EMPTY_PLACE, EMPTY_PLACE_NEGATIVE } from "@/lib/adult/studio-catalog";
import { canKeepGoing, chainTo, nextStartsFresh, seamlessRunTo, type AnimationLinks } from "@/lib/adult/studio-chains";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// ▶▶ Keep going for the Studio's animations (lib/adult/studio-keep-going.ts, David 2026-11-09): the end frame cut by the
// moments route (the real ffmpeg on a real little clip), then the next link animated from it. Venice, Hive and the
// alone check are stubbed; nothing explicit is made: the words below only ever get refused or stubbed.

describe("the chain, on the page (lib/adult/studio-chains.ts)", () => {
  const link = (from: string | null, seamless: boolean, words: string | null = null) => ({ from, seamless, words });
  const links: AnimationLinks = { a: link(null, false), b: link("a", true), c: link("b", true), d: link("c", false, "she laughs"), x: link("gone", true) };

  it("walks a chain back to the animation it began with, and stops where one is gone", () => {
    expect(chainTo("d", links)).toEqual(["a", "b", "c", "d"]);
    expect(chainTo("a", links)).toEqual(["a"]);
    expect(chainTo("x", links)).toEqual(["x"]);
    expect(seamlessRunTo("c", links)).toBe(2);
    expect(seamlessRunTo("d", links)).toBe(0);
  });

  it(`starts fresh after ${SEAMLESS_RUN_MAX} seamless links in a row, and stops offering Keep going at ${CHAIN_MAX}`, () => {
    expect(nextStartsFresh("b", links)).toBe(false);
    expect(nextStartsFresh("c", links)).toBe(true);
    expect(nextStartsFresh("d", links)).toBe(false);
    expect(canKeepGoing("d", links)).toBe(true);
    expect(canKeepGoing("not-an-animation", links)).toBe(false);
    const full: AnimationLinks = Object.fromEntries(Array.from({ length: CHAIN_MAX }, (_, i) => [`v${i}`, link(i ? `v${i - 1}` : null, false)]));
    expect(chainTo(`v${CHAIN_MAX - 1}`, full)).toHaveLength(CHAIN_MAX);
    expect(canKeepGoing(`v${CHAIN_MAX - 1}`, full)).toBe(false);
    expect(canKeepGoing(`v${CHAIN_MAX - 2}`, full)).toBe(true);
  });

  it("takes the owner's words as long as a picture's own What's happening", () => {
    expect(NEXT_WORDS_MAX).toBe(PICTURE_FIELD_MAX);
  });

  it("clears the place in an animation's prompt only when asked (nude somewhere public), and is as it was otherwise", () => {
    const plain = animatePrompt({ noun: "woman" }, 2, "carries on from this very moment, in the same place");
    expect(animatePrompt({ noun: "woman" }, 2, "carries on from this very moment, in the same place", {}, {})).toBe(plain);
    expect(plain).not.toContain(EMPTY_PLACE);
    const empty = animatePrompt({ noun: "woman" }, 2, "carries on from this very moment, in the same place", {}, { emptyPlace: true });
    expect(empty).toContain(`${EMPTY_PLACE}.`);
  });

  it("names a chain on its card, plays it as one film, and says when it's as long as it goes", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: AnimationChain } = await import("@/app/after-dark/studio/[id]/AnimationChain");
    const props = { characterId: "c1", trimOf: () => null, price: () => "3 tokens", onState: () => {} };
    const first = renderToStaticMarkup(createElement(AnimationChain, { ...props, id: "a", links }));
    expect(first).toContain("▶▶ Keep going…");
    expect(first).not.toContain("Play all");
    const later = renderToStaticMarkup(createElement(AnimationChain, { ...props, id: "d", links }));
    expect(later).toContain("Kept going · shot 4 of 4");
    expect(later).toContain("“she laughs”");
    expect(later).toContain("▶ Play all 4");
    const full: AnimationLinks = Object.fromEntries(Array.from({ length: CHAIN_MAX }, (_, i) => [`v${i}`, link(i ? `v${i - 1}` : null, false)]));
    const last = renderToStaticMarkup(createElement(AnimationChain, { ...props, id: `v${CHAIN_MAX - 1}`, links: full }));
    expect(last).toContain("Kept going as far as it goes");
    expect(last).not.toContain("▶▶ Keep going…");
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
/** The alone check (Venice's vision model): what it answers, and how often it was asked. */
const alone = { answer: "unset" as string | number, asked: 0 };
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
  setStudioPausesForTests(false);
  setCheckSleepForTests(async () => {});
  // Never a live call: the alone check answers what a test sets (a status number fails it), "unset" fails it too.
  alone.answer = "unset";
  alone.asked = 0;
  setModerationFetchForTests(async (input: RequestInfo | URL) => {
    if (String(input) !== VENICE_CHAT) return new Response("not stubbed", { status: 599 });
    alone.asked++;
    if (typeof alone.answer === "number") return new Response("no", { status: alone.answer });
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: alone.answer }) } }] });
  });
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
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    seen.push(String(input) === HIVE_VLM ? "vlm" : "moderation");
    return Response.json(String(input) === HIVE_VLM ? answer("ADULTS") : mod(0.9));
  });
  return seen;
}
/** Venice, stubbed: the face edits, and videos queued and then ready (a real MP4) once `video.ready`; `fail` refuses a queue. */
function fakeVenice() {
  const edits: { prompt: string; images: string[] }[] = [];
  const video = { ready: false, fail: false, queued: [] as Record<string, unknown>[] };
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(input).endsWith("/image/multi-edit")) {
      edits.push({ prompt: body.prompt, images: body.images });
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
type State = { animating: unknown[]; shoots: { kind: string; status: string; pictures: string[] }[]; animation_links: AnimationLinks };
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const moments = (body: unknown, cookie: string) =>
  momentsPost(new Request(`${BASE_URL}/api/admin/after-dark/moments`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const state = async (me: Me) => (await (await studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?character=${me.character}`, { headers: { cookie: me.cookie } }))).json()).state as State;
const used = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;

/** After Dark on and the Studio open; a subscriber with 20 tokens and a character of theirs with a face (dressed). */
async function setup(): Promise<Me> {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [id, `g-${id}`, `${id.slice(0, 8)}@example.test`]);
  const c = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 29 }), raw)).json()) as { id: string };
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 20, 'test')`, [crypto.randomUUID(), id]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    studio: { open_to: "entitled" },
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [id, c.id]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [id, c.id, Buffer.from(PNG)]);
  return { id, cookie: signedIn(id), character: c.id };
}

describe("Keep going on a Studio animation", () => {
  let venice: ReturnType<typeof fakeVenice>;
  /** The animation being made, collected (Venice has it ready): the newest video's id. */
  async function collected(me: Me): Promise<string> {
    venice.video.ready = true;
    const s = await state(me);
    venice.video.ready = false;
    expect(s.animating).toHaveLength(0);
    expect(s.shoots[0]).toMatchObject({ kind: "animate", status: "ready" });
    return s.shoots[0].pictures[0];
  }
  /** A picture animated and collected: its video's id. */
  async function animated(me: Me, imageId = "face-1"): Promise<string> {
    const res = await post({ action: "animate", character_id: me.character, image_id: imageId, motion: "turn", seconds: 5 }, me.cookie);
    expect(res.status).toBe(200);
    return collected(me);
  }
  /** Its end cut to a frame (the moments route), then the next link from it. */
  async function keepGoing(me: Me, videoId: string, extra: Record<string, unknown> = {}) {
    const cut = await moments({ action: "frame", media_id: videoId, at: "end" }, me.cookie);
    expect(cut.status).toBe(200);
    const frame = ((await cut.json()) as { frame: { id: string } }).frame.id;
    const res = await post({ action: "keep_going", character_id: me.character, video_id: videoId, frame_id: frame, seconds: 5, ...extra }, me.cookie);
    const body = (await res.json()) as { message?: string; error?: string; shoot?: { kind: string; status: string; tokens: number } };
    return { status: res.status, body, frame };
  }
  const nothingSpent = async (me: Me, before: { used: number; queued: number; edits: number }) => {
    expect(await used(me.id)).toBe(before.used);
    expect(venice.video.queued).toHaveLength(before.queued);
    expect(venice.edits).toHaveLength(before.edits);
  };
  const now = async (me: Me) => ({ used: await used(me.id), queued: venice.video.queued.length, edits: venice.edits.length });

  it("carries on straight from the frame it ended on: the owner's words lead it, at Animate's price, and the link names the one before", async () => {
    const me = await setup();
    const hive = fakeHive();
    venice = fakeVenice();
    const first = await animated(me);
    expect(await used(me.id)).toBe(3);
    expect((await state(me)).animation_links[first]).toEqual({ from: null, seamless: false, words: null });
    hive.length = 0;
    const { status, body, frame } = await keepGoing(me, first, { prompt: "she turns to the window and smiles", dialog: "Come here." });
    expect(status).toBe(200);
    // The cut frame got the age question (the moments route), and is kept out of the gallery as the animation's.
    expect(hive).toEqual(["vlm"]);
    const row = (await t.db.query<{ kind: string; source_image: string; character_id: string; character_b: string | null }>(`select kind, source_image, character_id, character_b from adult_images where id = $1`, [frame])).rows[0];
    expect(row).toEqual({ kind: "frame", source_image: first, character_id: me.character, character_b: null });
    expect(body.shoot).toMatchObject({ kind: "animate", status: "making", tokens: 3 });
    expect(body.message).toMatch(/^Keeping it going from where it ended: /);
    expect(await used(me.id)).toBe(6);
    // Queued from that very frame, nothing drawn; the words lead, what she says is said, and it carries on from here.
    expect(venice.edits).toHaveLength(0);
    const queued = venice.video.queued[1];
    expect(String(queued.image_url)).toContain(`/media/${frame}.png?until=`);
    expect(String(queued.prompt)).toContain("Most important, do exactly this: she turns to the window and smiles.");
    expect(String(queued.prompt)).toContain("Come here.");
    expect(String(queued.prompt)).toContain("carries on from this very moment, in the same place");
    expect(String(queued.prompt)).not.toContain(EMPTY_PLACE);
    expect(alone.asked).toBe(0);
    // One at a time: asked while that one's being made (the page asks before it cuts a frame), it waits.
    const wait = await post({ action: "keep_going", character_id: me.character, video_id: first, seconds: 5 }, me.cookie);
    expect([wait.status, ((await wait.json()) as { error: string }).error]).toEqual([409, "busy"]);
    // Collected like any animation: the link says where it came from, and what was asked.
    const next = await collected(me);
    const links = (await state(me)).animation_links;
    expect(links[next]).toEqual({ from: first, seamless: true, words: "she turns to the window and smiles" });
    expect(chainTo(next, links)).toEqual([first, next]);
    expect((await t.db.query<{ source_image: string }>(`select source_image from adult_images where id = $1`, [next])).rows[0].source_image).toBe(frame);
    // A frame carries on one link only.
    const again = await post({ action: "keep_going", character_id: me.character, video_id: first, frame_id: frame, seconds: 5 }, me.cookie);
    expect(again.status).toBe(404);
    // Without words, it carries on as they were: the prompt says so, and no guide leads.
    const quiet = await keepGoing(me, next);
    expect(quiet.status).toBe(200);
    expect(String(venice.video.queued[2].prompt)).toContain("in the same pose and place, moving on naturally from what they were doing");
    expect(String(venice.video.queued[2].prompt)).not.toContain("Most important");
  });

  it(`draws their face fresh on the cut frame every ${SEAMLESS_RUN_MAX + 1}rd link (and when asked); a queue that fails gives the tokens back`, async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    let video = await animated(me);
    for (let k = 0; k < SEAMLESS_RUN_MAX; k++) {
      expect((await keepGoing(me, video)).status).toBe(200);
      video = await collected(me);
    }
    expect(nextStartsFresh(video, (await state(me)).animation_links)).toBe(true);
    // Asked first, the page hears it'll start from their faces drawn fresh.
    const ask = await post({ action: "keep_going", character_id: me.character, video_id: video, seconds: 5 }, me.cookie);
    expect([ask.status, await ask.json()]).toEqual([200, { ready: true, fresh: true }]);
    // The queue fails: the tokens come back, and the fresh frame drawn for it goes.
    venice.video.fail = true;
    const before = await used(me.id);
    const failed = await keepGoing(me, video);
    expect(failed.status).toBe(502);
    expect(failed.body.message).toMatch(/Your tokens are back\.$/);
    expect(await used(me.id)).toBe(before);
    expect(venice.edits).toHaveLength(1);
    expect((await t.db.query(`select 1 from adult_images where prompt like '%faces made fresh%'`)).rows).toHaveLength(0);
    // Again, from the same cut frame (nothing started from it): the face drawn fresh on it, checked, kept as a frame.
    venice.video.fail = false;
    const res = await post({ action: "keep_going", character_id: me.character, video_id: video, frame_id: failed.frame, seconds: 5 }, me.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { message: string }).message).toMatch(/faces drawn fresh \(every third link is/);
    expect(venice.edits).toHaveLength(2);
    const edit = venice.edits[1];
    expect(edit.images[0]).toContain(`/media/${failed.frame}.png?`);
    expect(edit.images[1]).toContain("/media/face-1.png?");
    const fresh = (await t.db.query<{ id: string; source_image: string }>(`select id, source_image from adult_images where kind = 'frame' and prompt like '%faces made fresh%'`)).rows;
    expect(fresh).toEqual([{ id: expect.any(String), source_image: video }]);
    expect(String(venice.video.queued.at(-1)!.image_url)).toContain(`/media/${fresh[0].id}.png?`);
    const next = await collected(me);
    expect((await state(me)).animation_links[next]).toMatchObject({ from: video, seamless: false });
    // Fresh faces when asked, on any link (and not "every third").
    const asked = await keepGoing(me, next, { mode: "fresh" });
    expect(asked.status).toBe(200);
    expect(asked.body.message).toMatch(/with their faces drawn fresh: it takes/);
    expect(venice.edits).toHaveLength(3);
  });

  it("refuses before anything is spent: the lines, their limits, their studio limit, a full chain, a frame that isn't its own", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    const first = await animated(me);
    const before = await now(me);
    // Asked first, without a frame (the page does, before it cuts one): refused at once, with nothing cut or spent.
    const frames = async () => (await t.db.query(`select 1 from adult_images where kind = 'frame'`)).rows.length;
    const cutBefore = await frames();
    const check = await post({ action: "keep_going", character_id: me.character, video_id: first, seconds: 5, prompt: "she looks like a teenager" }, me.cookie);
    expect([check.status, ((await check.json()) as { message: string }).message]).toEqual([422, "Those words cross one of the lines After Dark never crosses."]);
    const fine = await post({ action: "keep_going", character_id: me.character, video_id: first, seconds: 5, prompt: "she smiles" }, me.cookie);
    expect([fine.status, await fine.json()]).toEqual([200, { ready: true, fresh: false }]);
    expect(await frames()).toBe(cutBefore);
    await nothingSpent(me, before);
    const refused = async (extra: Record<string, unknown>, status: number, message: RegExp) => {
      const r = await keepGoing(me, first, extra);
      expect(r.status, JSON.stringify(r.body)).toBe(status);
      expect(r.body.message).toMatch(message);
      await nothingSpent(me, before);
    };
    await refused({ prompt: "she looks like a teenager" }, 422, /lines After Dark never crosses/);
    await refused({ prompt: "she smiles", dialog: "I'm still in high school" }, 422, /lines After Dark never crosses/);
    await post({ action: "limits", character_id: me.character, hard_nos: ["pain"] }, me.cookie);
    await refused({ prompt: "a playful spank" }, 422, /past the limits you've set: crossed a hard limit \(Pain\)/);
    await post({ action: "limits", character_id: me.character, intensity: "flirty" }, me.cookie);
    await refused({ prompt: "she undresses slowly" }, 422, /Those words go past suggestive: their studio limit/);
    // A frame cut from another video isn't this one's.
    const other = await moments({ action: "frame", media_id: first, at: 1 }, me.cookie);
    const elsewhere = ((await other.json()) as { frame: { id: string } }).frame.id;
    await t.db.query(`update adult_images set source_image = 'somewhere-else' where id = $1`, [elsewhere]);
    expect((await post({ action: "keep_going", character_id: me.character, video_id: first, frame_id: elsewhere, seconds: 5 }, me.cookie)).status).toBe(404);
    // Not one of their Studio animations.
    expect((await post({ action: "keep_going", character_id: me.character, video_id: "face-1", frame_id: elsewhere, seconds: 5 }, me.cookie)).status).toBe(404);
    // A chain CHAIN_MAX long: as far as it goes.
    let from = (await t.db.query<{ shoot_id: string }>(`select shoot_id from adult_images where id = $1`, [first])).rows[0].shoot_id;
    let last = first;
    for (let k = 1; k < CHAIN_MAX; k++) {
      const shoot = crypto.randomUUID();
      const choices = { source: "f", level: 0, from, cut: { video: last, frame: `f${k}`, at: 2.9, seamless: false }, facts: { people: [me.character, null], place: null, aspect: null, pov: null } };
      await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, tokens, asked, status) values ($1, $2, $3, 'animate', $4::jsonb, 'm', 'venice', 0, 1, 'ready')`, [shoot, me.id, me.character, JSON.stringify(choices)]);
      last = `link-${k}`;
      await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, shoot_id) values ($1, $2, $3, 'video', 'Studio clip: kept going', 'video/mp4', $4, 'ready', $5)`, [last, me.id, me.character, MP4, shoot]);
      from = shoot;
    }
    const links = (await state(me)).animation_links;
    expect(chainTo(last, links)).toHaveLength(CHAIN_MAX);
    expect(canKeepGoing(last, links)).toBe(false);
    const full = await keepGoing(me, last);
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(new RegExp(`kept going ${CHAIN_MAX - 1} times, as far as it goes`));
    await nothingSpent(me, before);
  });

  it("somewhere public: nude only with the place empty (nobody brought in, the frame checked for anyone else), nothing explicit", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    // A picture of her alone at the beach, dressed, animated.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, scene_place, level) values ('beach-1', $1, $2, 'scene', 'p', 'image/png', $3, 'the beach', 0)`, [me.id, me.character, Buffer.from(PNG)]);
    const first = await animated(me, "beach-1");
    const before = await now(me);
    const attempt = async (prompt: string) => keepGoing(me, first, { prompt });
    // Nothing explicit there; nobody brought in to watch; the frame shows her alone, or it's refused (and logged).
    let r = await attempt("having sex");
    expect([r.status, r.body.message]).toEqual([422, "Nothing explicit somewhere public: that stays private."]);
    r = await attempt("she undresses in front of strangers");
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/stays with the place empty/);
    expect(alone.asked).toBe(0);
    alone.answer = "MORE";
    r = await attempt("she undresses");
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/Someone else is in that frame/);
    expect(alone.asked).toBe(1);
    expect((await t.db.query(`select 1 from adult_rejections where reason like 'studio keep going: someone else%'`)).rows).toHaveLength(1);
    // The check can't run: closed.
    alone.answer = 500;
    r = await attempt("she undresses");
    expect(r.status).toBe(503);
    await nothingSpent(me, before);
    // Alone: it goes, with the place kept empty in the prompt and the negative.
    alone.answer = "ONE";
    r = await attempt("she undresses");
    expect(r.status).toBe(200);
    const queued = venice.video.queued.at(-1)!;
    expect(String(queued.prompt)).toContain(`${EMPTY_PLACE}.`);
    expect(String(queued.negative_prompt)).toContain(EMPTY_PLACE_NEGATIVE);
  });

  it("somewhere public with two of them: nothing past kissing", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    const house = HOUSE_CHARACTERS[0].id;
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-h', $1, $2, 'baseline', 'p', 'image/png', $3)`, [me.id, house, Buffer.from(PNG)]);
    const [lo, hi] = [me.character, house].sort();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, scene_place, level) values ('pair-1', $1, $2, $3, 'scene', 'p', 'image/png', $4, 'the bar', 0)`, [me.id, lo, hi, Buffer.from(PNG)]);
    const first = await animated(me, "pair-1");
    const before = await now(me);
    const r = await keepGoing(me, first, { prompt: "they undress each other" });
    expect([r.status, r.body.message]).toEqual([422, "Nothing past kissing somewhere public: that waits until they're somewhere private."]);
    await nothingSpent(me, before);
    const kiss = await keepGoing(me, first, { prompt: "they kiss" });
    expect(kiss.status).toBe(200);
    const queued = venice.video.queued.at(-1)!;
    expect(String(queued.prompt)).toContain("carry on from this very moment");
    expect(String(queued.negative_prompt)).not.toContain(EMPTY_PLACE_NEGATIVE);
    expect(alone.asked).toBe(0);
  });

  it("cuts a frame only from an animation among videos of one", async () => {
    const me = await setup();
    fakeHive();
    venice = fakeVenice();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('solo-video', $1, $2, 'video', 'A clip', 'video/mp4', $3, 'ready')`, [me.id, me.character, MP4]);
    const res = await moments({ action: "frame", media_id: "solo-video", at: "end" }, me.cookie);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toMatch(/isn't there/);
    // An admin's Studio animation is theirs to keep going too (admins pay nothing).
    await claimAdmin(t.db, me.id);
    const first = await animated(me);
    const before = await used(me.id);
    expect((await keepGoing(me, first)).status).toBe(200);
    expect(await used(me.id)).toBe(before);
  });
});
