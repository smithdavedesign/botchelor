import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { GET as drawAheadGet, POST as drawAheadPost } from "@/app/api/admin/after-dark/draw-ahead/route";
import { NO_MEDIA_LIMITS } from "@/lib/adult/acts";
import { BEATS_PER_CHAPTER, beatFrame, beatLabel, beatPictureFor, beatPicturesSettled, fileBeats, findBeats, poseHere, positionIn, rewindBeats } from "@/lib/adult/beats";
import { rateMedia } from "@/lib/adult/steering";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { aheadBudget, settleDrawAhead } from "@/lib/adult/draw-ahead";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { reelCast, reuseBeatPictures, setReelFetchForTests, setReelPausesForTests, type ReelShot } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Beat pictures (lib/adult/beats.ts; David, 2026-10-24): the moments of a chapter worth a picture, offered as the
// theater plays, drawn on yes, on Picture this, or when the chapter closes; a night's video starts from them. Every
// line here is a neutral stand-in, never a real scene's words. No live calls.

describe("finding a chapter's moments", () => {
  const at = (stage: number, text = "kabana lodore mifel.") => ({ text, stage });

  it("finds undressing, sex in the position its first lines name, each new position, the climax and the afterglow", () => {
    const lines = [
      at(2),
      at(3, "*unbuttons his shirt* Slowly."),
      at(3),
      at(4, "*pulls him down* Now."),
      at(4, "*straddles him* Like this."),
      at(4),
      at(4, "*bends her over the bed* Here."),
      at(4),
      at(4, "*comes hard, gasping* Oh."),
      at(4),
      at(4),
      at(4),
      at(4, "*stretches out* Mm."),
    ];
    expect(findBeats(lines, 0, 2, []).map((b) => [b.line, b.kind, b.act])).toEqual([
      [1, "undressing", "undress"],
      [3, "sex", "on_top"],
      [6, "position", "behind"],
      [8, "climax", "behind"],
      [12, "afterglow", "afterglow"],
    ]);
  });

  it("reads only the new lines, never repeats a moment the chapter has, and keeps to the chapter's count", () => {
    const lines = [at(4, "*straddles him* Yes."), at(4), at(4, "*straddles him again* More.")];
    // A chapter that began at sex: its first position is a new position, not sex beginning.
    expect(findBeats(lines, 0, 4, []).map((b) => [b.kind, b.act])).toEqual([["position", "on_top"]]);
    expect(findBeats(lines, 2, 4, [{ line: 0, kind: "position", act: "on_top" }])).toEqual([]);
    const full = Array.from({ length: BEATS_PER_CHAPTER }, (_, i) => ({ line: i, kind: "position" as const, act: `x${i}` }));
    expect(findBeats([at(4, "*bends her over* Now.")], 0, 4, full)).toEqual([]);
    // A moment the viewer chose doesn't count against it.
    expect(findBeats([at(4, "*bends her over* Now.")], 0, 4, [{ line: 0, kind: "chosen", act: "kiss" }])).toHaveLength(1);
  });

  it("leaves out what the pair's limits rule out, and sex they don't name is face to face", () => {
    const lines = [at(3), at(4, "*goes down on him* Mm."), at(4)];
    expect(findBeats(lines, 0, 3, [], (act) => act !== "oral").map((b) => [b.kind, b.act])).toEqual([["sex", "face_to_face"]]);
    expect(findBeats([at(3), at(4, "Now.")], 0, 3, []).map((b) => b.act)).toEqual(["face_to_face"]);
  });

  it("names positions by plain words, and calls each moment by its name", () => {
    expect(positionIn("*rides him slowly* Yes.")).toBe("on_top");
    expect(positionIn("*pins her to the mattress*")).toBe("face_to_face");
    expect(positionIn("*curls into his lap*")).toBe("lap");
    expect(positionIn("*spooning behind her*")).toBe("spooning");
    expect(positionIn("*smiles at him*")).toBeNull();
    expect(beatLabel("sex", "on_top")).toBe("Sex: on top");
    expect(beatLabel("position", "behind")).toBe("A new position: from behind");
    expect(beatLabel("climax", "behind")).toBe("The climax");
  });
});

describe("a moment's picture", () => {
  it("keeps the act's bed only where there is one, and says what was happening without their names", async () => {
    expect(poseHere("On a bed, having sex: here.", "the kitchen")).toBe("Having sex: here.");
    expect(poseHere("On a bed, having sex: here.", "her bedroom")).toBe("On a bed, having sex: here.");
    const [juniper, rafe] = [HOUSE_CHARACTERS[1], HOUSE_CHARACTERS[0]];
    const cast = reelCast(juniper as never, rafe as never);
    const frame = beatFrame({ act: "on_top", kind: "climax" }, cast, [{ text: `*pulls ${rafe.name.split(" ")[0]} closer* Now.` }], "her bedroom", NO_MEDIA_LIMITS);
    expect(frame).toContain("at the peak");
    expect(frame).toContain("What is happening:");
    expect(frame).not.toContain(rafe.name.split(" ")[0]);
    // A moment the limits catch is left out; the act's own still stays.
    const strict = { hit: (w: string) => (/closer/.test(w) ? "no" : null) };
    expect(beatFrame({ act: "on_top", kind: "sex" }, cast, [{ text: "*pulls him closer* Now." }], "her bedroom", strict)).not.toContain("What is happening");
  });
});

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
});
afterEach(async () => {
  await beatPicturesSettled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setReplicateFetchForTests(null);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

// Rafe (he) and Juniper (she); the pair is stored lower id first, so "a" is Juniper.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string, handler: (r: Request) => Promise<Response> = POST, path = "/api/admin/after-dark") =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
function fakeMedia() {
  const edits: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    if (path === "/image/multi-edit") {
      edits.push(String(JSON.parse(String(init?.body ?? "{}")).prompt));
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    }
    return new Response("?", { status: 500 });
  });
  return edits;
}

// Made-up words, never the same twice, so no guard reads two lines as a repeat.
let k = 0;
const word = () => `${["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"][k % 10]}${["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"][Math.floor(k / 10) % 10]}${["a", "e", "i", "o", "u"][Math.floor(k++ / 100) % 5]}`;
const fresh = () => `${word()} ${word()} ${word()} ${word()}.`;
/** The scene model: each step the next reply's lines (the last repeats); the recap, facts and notes their own. */
function scripted(...steps: string[][]) {
  let n = 0;
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They stayed in." });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify({ a: [], b: [] });
      if (/what a private night left behind/.test(messages[0].content)) return JSON.stringify({ a: "A night in.", b: "A night in." });
      const texts = steps[Math.min(n++, steps.length - 1)];
      return JSON.stringify({ lines: texts.map((text, i) => ({ who: i % 2 ? "b" : "a", text: text || fresh(), why: "She wants him closer tonight.", memory: null })) });
    },
  } as never);
}

/** After Dark on (Venice and Hive keys), both baselines in, the pair's scene at sex in her bedroom. */
async function ready(cookie: string, ownerId: string, settings: Record<string, unknown> = {}) {
  await post({ enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", auto_scene_pictures: false, ...settings }, cookie, settingsPost, "/api/admin/after-dark/settings");
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4) on conflict do nothing`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set stage = 4, place = 'her bedroom', set_place = 'her bedroom', lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify([{ who: "a", text: "Come here.", stage: 4 }])]);
  return scene;
}
const beatsOf = async (sceneId: string) =>
  (await t.db.query<{ id: string; line: number; kind: string; act: string; status: string; picture_id: string | null; night_id: string | null }>(`select * from adult_beats where scene_id = $1 order by line`, [sceneId])).rows;

describe("beats as the scene is written", () => {
  it("are found in a step's lines and come back with the scene, offered", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    scripted([`*straddles him* ${fresh()}`, "", "", `*bends her over the bed* ${fresh()}`, "", ""]);
    const r = await (await post({ a: RAFE, b: JUNIPER }, cookie)).json();
    expect(r.scene.beats.map((b: { kind: string; act: string; status: string; label: string }) => [b.kind, b.act, b.status, b.label])).toEqual([
      ["position", "on_top", "offered", "A new position: on top"],
      ["position", "behind", "offered", "A new position: from behind"],
    ]);
    expect((await beatsOf(scene.id)).map((b) => b.line)).toEqual([1, 4]);
  });

  it("aren't found while beat pictures are off", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id, { beat_pictures: false });
    scripted([`*straddles him* ${fresh()}`, "", "", "", "", ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    expect(await beatsOf(scene.id)).toEqual([]);
  });

  it("aren't drawn ahead unless the viewer turned it on", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", "", "", ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    expect((await beatsOf(scene.id)).map((b) => b.status)).toEqual(["offered"]);
  });

  it("draws one on yes, keeps not now for later, and Picture this draws the latest still waiting", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    const edits = fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", `*bends her over the bed* ${fresh()}`, "", ""]);
    const [first, second] = (await (await post({ a: RAFE, b: JUNIPER }, cookie)).json()).scene.beats as { id: string }[];
    const later = await (await post({ a: RAFE, b: JUNIPER, beat: { id: second.id, answer: "later" } }, cookie)).json();
    expect(later.beat.status).toBe("later");
    const now = await (await post({ a: RAFE, b: JUNIPER, beat: { id: first.id, answer: "now" } }, cookie)).json();
    expect(now.beat.status).toBe("drawing");
    await beatPicturesSettled();
    let rows = await beatsOf(scene.id);
    expect(rows.map((b) => b.status)).toEqual(["drawn", "later"]);
    // Drawn from both baselines into the act's still, kept in the gallery as a scene picture with its chapter.
    expect(edits[0]).toContain("sits astride");
    const pic = (await t.db.query<{ kind: string; scene_chapter: number }>(`select kind, scene_chapter from adult_images where id = $1`, [rows[0].picture_id])).rows[0];
    expect(pic).toEqual({ kind: "scene", scene_chapter: 1 });
    // Picture this on the last line: the beat still waiting at or before it.
    const chosen = await (await post({ a: RAFE, b: JUNIPER, picture_now: { line: 6 } }, cookie)).json();
    expect(chosen.beat.id).toBe(second.id);
    await beatPicturesSettled();
    rows = await beatsOf(scene.id);
    expect(rows.map((b) => b.status)).toEqual(["drawn", "drawn"]);
    expect(edits).toHaveLength(2);
    // With none waiting, the moment itself, as its position says.
    const own = await (await post({ a: RAFE, b: JUNIPER, picture_now: { line: 6 } }, cookie)).json();
    expect(own.beat).toMatchObject({ kind: "chosen", act: "behind" });
    await beatPicturesSettled();
    expect(edits).toHaveLength(3);
  });

  it("takes the owner's own words for the exact scene: they lead the picture, and taboo is refused", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const edits = fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", "", "", ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    // Picture this with the owner's own direction: a fresh picture led by their words (not the waiting beat).
    const guided = await (await post({ a: RAFE, b: JUNIPER, picture_now: { line: 5, custom: "she looks back over her shoulder, biting her lip", dialog: "don't stop" } }, cookie)).json();
    expect(guided.beat.kind).toBe("chosen");
    await beatPicturesSettled();
    const last = edits[edits.length - 1];
    expect(last).toContain("Most important, do exactly this: she looks back over her shoulder, biting her lip.");
    expect(last).toContain('A speech bubble near them reads: "don\'t stop".');
    // Taboo in the owner's words is refused before anything is drawn.
    const before = edits.length;
    const bad = await post({ a: RAFE, b: JUNIPER, picture_now: { line: 5, custom: "she looks like a schoolgirl, barely a teen" } }, cookie);
    expect(bad.status).toBe(422);
    await beatPicturesSettled();
    expect(edits).toHaveLength(before);
  });

  it("are drawn when the chapter closes if never chosen, go with the night, and a rewind takes back what it unwrites", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    const edits = fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", "", "", ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    await fileBeats(t.db, scene.id, 1, "night-1");
    await beatPicturesSettled();
    let rows = await beatsOf(scene.id);
    expect(rows.map((b) => [b.status, b.night_id])).toEqual([["drawn", "night-1"]]);
    expect(edits).toHaveLength(1);
    // A rewind of that close brings the beat home; one past the lines kept is gone.
    await rewindBeats(t.db, scene.id, 1, 1, "night-1");
    expect(await beatsOf(scene.id)).toEqual([]);
    scripted([`*straddles him* ${fresh()}`, "", "", "", "", ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    await post({ a: RAFE, b: JUNIPER, rewind: true }, cookie);
    rows = await beatsOf(scene.id);
    expect(rows).toEqual([]);
  });
});

describe("a video of the night", () => {
  it("starts a shot from the beat picture before its line, at the same stage and place, each picture once", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", "", "", ""]);
    const [beat] = (await (await post({ a: RAFE, b: JUNIPER }, cookie)).json()).scene.beats as { id: string }[];
    await post({ a: RAFE, b: JUNIPER, beat: { id: beat.id, answer: "now" } }, cookie);
    await beatPicturesSettled();
    const pic = (await beatsOf(scene.id))[0].picture_id!;
    const pair = [JUNIPER, RAFE].sort() as [string, string];
    expect(await beatPictureFor(t.db, id, pair, { chapter: 1, night_id: null }, 5, 4, "her bedroom")).toEqual({ id: pic, eyes: null });
    expect(await beatPictureFor(t.db, id, pair, { chapter: 1, night_id: null }, 0, 4, "her bedroom")).toBeNull();
    expect(await beatPictureFor(t.db, id, pair, { chapter: 1, night_id: null }, 5, 3, "her bedroom")).toBeNull();
    expect(await beatPictureFor(t.db, id, pair, { chapter: 1, night_id: null }, 5, 4, "the kitchen")).toBeNull();
    // One the viewer 👎'd doesn't start a shot (a fresh, steered keyframe does), and does again once the 👎 is taken back.
    expect(await rateMedia(t.db, id, pic, -1, ["face"])).toMatchObject({ ok: true });
    expect(await beatPictureFor(t.db, id, pair, { chapter: 1, night_id: null }, 5, 4, "her bedroom")).toBeNull();
    await rateMedia(t.db, id, pic, 0);
    expect(await beatPictureFor(t.db, id, pair, { chapter: 1, night_id: null }, 5, 4, "her bedroom")).toEqual({ id: pic, eyes: null });
    const shots: ReelShot[] = [2, 5].map((line) => ({ line, who: "a", text: "Now.", motion: "m", status: "queued" }));
    await reuseBeatPictures(t.db, id, pair, shots, { chapters: [{ chapter: 1, night_id: null, lines: 7 }], chapterOf: Array(7).fill(0) }, [0], Array(7).fill("her bedroom"), Array(7).fill(4));
    expect(shots.map((s) => [s.from_beat ?? false, s.media_id ?? null])).toEqual([
      [true, pic],
      [false, null],
    ]);
  });
});

// David, 2026-10-29: "draw ahead is a good idea, but we would need to limit per chapter and pre charge people tokens if
// they choose it" (lib/adult/draw-ahead.ts).
describe("draw ahead", () => {
  const turn = (on: boolean, cookie: string, at?: number) => post({ a: RAFE, b: JUNIPER, on, ...(at !== undefined ? { at } : {}) }, cookie, drawAheadPost, "/api/admin/after-dark/draw-ahead");
  const view = async (cookie: string) =>
    (await (await drawAheadGet(new Request(`${BASE_URL}/api/admin/after-dark/draw-ahead?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).draw_ahead as { offered: boolean; on: boolean; price: number; pictures: number; paid: boolean };
  /** A subscriber with `tokens` bought tokens, their night with the pair at sex (After Dark set up by an admin). */
  async function subscriber(tokens: number, settings: Record<string, unknown> = {}) {
    const boss = await admin();
    await post({ enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", auto_scene_pictures: false, ...settings }, boss.cookie, settingsPost, "/api/admin/after-dark/settings");
    const id = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
    if (tokens) await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), id, tokens]);
    const cookie = signedIn(id);
    const scene = await ready(cookie, id);
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [id])).rows[0]?.used ?? 0;
    return { id, cookie, scene, used };
  }

  it("draws each moment as it's written once the viewer turns it on: the chapter's own pictures and draw_ahead_pictures more", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id, { pictures_per_chapter: 1, draw_ahead_pictures: 1 });
    expect(await view(cookie)).toEqual({ offered: true, on: false, price: 0, included: false, pictures: 1, paid: false });
    expect((await turn(true, cookie)).status).toBe(200);
    fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", `*bends her over the bed* ${fresh()}`, "", `*pins her to the mattress* ${fresh()}`, ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    await beatPicturesSettled();
    // Two drawn at once (one of the chapter's, one more); the third waits for "Picture this?" as before.
    const beats = await beatsOf(scene.id);
    expect(beats.map((b) => b.status)).toEqual(["drawn", "drawn", "offered"]);
    expect(await view(cookie)).toMatchObject({ on: true, paid: true });
  });

  // #1005 (David, 2026-10-30: "a subscription that includes an allowance, tokens for extras"): Draw ahead is included
  // with a subscription, bounded by the month's pictures; draw_ahead_tokens is left for a viewer with none.
  it("is included for a subscriber: nothing taken, even with no tokens, and it never turns itself off for want of one", async () => {
    const sub = await subscriber(0);
    expect(await view(sub.cookie)).toMatchObject({ price: 0, included: true });
    expect((await (await turn(true, sub.cookie)).json()).note).toMatch(/Drawing ahead: .*a chapter, included with your subscription\)\.$/);
    fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", `*bends her over the bed* ${fresh()}`, "", ""]);
    await post({ a: RAFE, b: JUNIPER }, sub.cookie);
    await beatPicturesSettled();
    expect((await beatsOf(sub.scene.id)).map((b) => b.status)).toEqual(["drawn", "drawn"]);
    expect(await view(sub.cookie)).toMatchObject({ on: true, paid: true });
    expect(await sub.used()).toBe(0);
    expect((await (await turn(false, sub.cookie)).json()).refunded).toBe(0);
    expect(await sub.used()).toBe(0);
  });

  it("a viewer without a subscription pays draw_ahead_tokens a chapter, given back when nothing was drawn, and is turned off without one", async () => {
    // A subscriber whose subscription lapses mid-chapter: the step's own path (aheadBudget) charges them from then on.
    const sub = await subscriber(5);
    await turn(true, sub.cookie);
    await t.db.query(`update adult_entitlements set subscription_status = 'lapsed' where user_id = $1`, [sub.id]);
    expect(await aheadBudget(t.db, sub.scene.id, 1)).not.toBeNull();
    expect(await sub.used()).toBe(1);
    expect(await settleDrawAhead(t.db, sub.scene.id, 1)).toBe(1);
    expect(await sub.used()).toBe(0);
    const broke = await subscriber(0);
    await turn(true, broke.cookie);
    await t.db.query(`update adult_entitlements set subscription_status = 'lapsed' where user_id = $1`, [broke.id]);
    expect(await aheadBudget(t.db, broke.scene.id, 1)).toBeNull();
    const note = (await t.db.query<{ picture_note: string; draw_ahead: boolean }>(`select picture_note, draw_ahead from adult_scenes where id = $1`, [broke.scene.id])).rows[0];
    expect(note).toMatchObject({ draw_ahead: false });
    expect(note.picture_note).toMatch(/Draw ahead is off: it takes 1 token a chapter/);
  });

  it("turned on, draws the chapter's moments still waiting from the line on stage; never while the settings don't offer it", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    fakeMedia();
    scripted([`*straddles him* ${fresh()}`, "", "", `*bends her over the bed* ${fresh()}`, "", ""]);
    await post({ a: RAFE, b: JUNIPER }, cookie);
    expect((await beatsOf(scene.id)).map((b) => [b.line, b.status])).toEqual([
      [1, "offered"],
      [4, "offered"],
    ]);
    expect((await (await turn(true, cookie, 2)).json()).drawing).toBe(1);
    await beatPicturesSettled();
    expect((await beatsOf(scene.id)).map((b) => [b.line, b.status])).toEqual([
      [1, "offered"],
      [4, "drawn"],
    ]);
    await post({ draw_ahead: false }, cookie, settingsPost, "/api/admin/after-dark/settings");
    await turn(false, cookie);
    expect((await turn(true, cookie)).status).toBe(409);
    expect((await view(cookie)).offered).toBe(false);
  });
});
