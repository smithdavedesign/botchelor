import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { GET as picturesGet, POST as picturesPost } from "@/app/api/admin/after-dark/pictures/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { ACTS, actMenu, povFor, crossesTaboo, type MenuAct } from "@/lib/adult/acts";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { chooseView, directorHint, framingScores, scoreFrom, scoresFrom } from "@/lib/adult/framing";
import { deriveTags, type TagSourceRow } from "@/lib/adult/media-tags";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { eyesFromTag, pickShots, pictureEyes, povPrompt, reelCast, setReelFetchForTests, setReelPausesForTests, shotPrompt, type Reel } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { rateMedia } from "@/lib/adult/steering";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Which framing works for which act, and first-person views of the two of them (lib/adult/framing.ts, acts.ts povFor,
// reels.ts povPrompt; David, 2026-10-26): no live calls.
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
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

// Rafe (he) and Juniper (she); the pair is stored lower id first, so "a" is Juniper.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
}
function fakeVenice() {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
    return new Response("?", { status: 500 });
  });
  return seen;
}
const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];
/** After Dark on, both baselines in, and the pair's night at sex in her bedroom. */
async function ready(cookie: string, ownerId: string, stage = 4) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p. Nude, alone, waist-up', 'image/png', $4) on conflict do nothing`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  const lines = Array.from({ length: 6 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage }));
  await t.db.query(`update adult_scenes set stage = $2, place = 'her bedroom', set_place = 'her bedroom', lines = $3::jsonb where id = $1`, [scene.id, stage, JSON.stringify(lines)]);
}
async function castOf() {
  const [juniper, rafe] = await Promise.all([loadCharacter(t.db, JUNIPER), loadCharacter(t.db, RAFE)]);
  return { cast: reelCast(juniper!, rafe!), names: [juniper!.name, rafe!.name] as [string, string] };
}

describe("framing scores", () => {
  it("start from our QA: going down first person works, both in frame face to face and the afterglow are experimental", () => {
    const s = scoresFrom({});
    expect(s.badge("oral", "pov")).toBe("works");
    expect(s.badge("close", "pair")).toBe("works");
    expect(s.badge("face_to_face", "pair")).toBe("experimental");
    expect(s.badge("afterglow", "pair")).toBe("experimental");
    expect(s.badge("on_top", "pov")).toBe("experimental");
    // No ratings at all: nothing to say yet.
    expect(s.badge("spooning", "pair")).toBeNull();
    expect(chooseView(s, "oral", true)).toBe("pov");
    expect(chooseView(s, "close", true)).toBe("pair");
    expect(chooseView(s, "oral", false)).toBe("pair");
    // A beat picture's own view: first person where both in frame comes out badly (face to face) or it has ratings of
    // its own that say so (from behind); never on a hunch (a kiss), never where first person did badly (on top).
    expect(chooseView(s, "face_to_face", true)).toBe("pov");
    expect(chooseView(s, "behind", true)).toBe("pov");
    expect(chooseView(s, "kiss", true)).toBe("pair");
    expect(chooseView(s, "on_top", true)).toBe("pair");
  });

  it("follow the viewer's own ratings, never anyone else's, and not a 👎 that only said how far it went", async () => {
    // Our QA caps at 8 ratings: their own soon outweigh it.
    expect(scoreFrom([8, 0], [0, 14], "pov").badge).toBe("experimental");
    const me = await admin();
    const other = await admin();
    for (let k = 0; k < 8; k++) {
      const id = `fd-${k}`;
      await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready')`, [id, other.id, JUNIPER, RAFE, Buffer.from(PNG)]);
      await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'act', 'close', 'choice')`, [id, other.id]);
      await rateMedia(t.db, other.id, id, -1, ["face"]);
    }
    // Someone else's 👎s on "close together" don't move my scores.
    expect((await framingScores(t.db, me.id)).badge("close", "pair")).toBe("works");
    expect((await framingScores(t.db, other.id)).badge("close", "pair")).toBe("experimental");
    // "Too explicit" alone is about how far, not the framing.
    const mine = "mine-1";
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready')`, [mine, me.id, JUNIPER, RAFE, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'act', 'kiss', 'choice')`, [mine, me.id]);
    await rateMedia(t.db, me.id, mine, -1, ["too_explicit"]);
    expect((await framingScores(t.db, me.id)).score("kiss", "pair").n).toBe(1);
  });

  it("give the director one short line", () => {
    const hint = directorHint(scoresFrom({}), ACTS.map((a) => ({ id: a.id, label: a.label, hasPov: Boolean(a.pov) })));
    expect(hint).toMatch(/^What comes out best: seen through one of their eyes for [^;]*going down/);
    expect(hint).toContain("both in frame for standing close");
    expect(hint.length).toBeLessThan(300);
  });
});

describe("first-person views of the two of them", () => {
  it("every still, through either's eyes, names nobody, fills every gap, holds to the lines, and keeps the viewer's face out", async () => {
    const { cast } = await castOf();
    for (const act of ACTS) {
      for (const swap of [false, true]) {
        for (const eyes of ["a", "b"] as const) {
          const pov = povFor(act, cast, eyes, swap);
          if (!pov) continue;
          expect(pov.still).not.toMatch(/[{}]/);
          expect(checkAdultText({ s: pov.still }).ok).toBe(true);
          expect(crossesTaboo(pov.still)).toBe(false);
          expect(pov.still).toMatch(/^Seen through /);
          expect(pov.shown).toBe(eyes === "a" ? 1 : 0);
        }
      }
    }
    // Spooning has no view (both faces away), going down only from the one gone down on.
    expect(ACTS.find((a) => a.id === "spooning")!.pov).toBeUndefined();
    const oral = ACTS.find((a) => a.id === "oral")!;
    expect([povFor(oral, cast, "a"), povFor(oral, cast, "b")].filter(Boolean)).toHaveLength(1);
  });

  it("make a keyframe of the one in full only, the viewer never a face, within the edit model's limit", async () => {
    const { cast } = await castOf();
    const oral = ACTS.find((a) => a.id === "oral")!;
    const eyes = (["a", "b"] as const).find((e) => povFor(oral, cast, e))!;
    const pov = povFor(oral, cast, eyes)!;
    const p = povPrompt(cast, eyes, pov.still, "her bedroom", 4, true, { custom: "x ".repeat(600), steer: "sharp focus, fine detail" });
    expect(p.length).toBeLessThanOrEqual(1500);
    expect(p).toMatch(/^Make one first-person photograph, seen through the eyes of the (wo)?man, of the (wo)?man from Picture 1, in the place from Picture 2\./);
    expect(p).toContain("never a face");
    expect(p).toContain("Sharp focus, fine detail.");
    expect(p).not.toMatch(/Picture 3/);
    // The video: first person, and a line the viewer says is off camera.
    const shot = { who: eyes, text: "Don't stop.", motion: "She moves slowly.", eyes } as const;
    expect(shotPrompt(cast, shot, true)).toMatch(/A first-person shot, seen through the eyes of/);
    expect(shotPrompt(cast, shot, true)).toContain("off camera");
  });

  it("are on the menu as views, with their badges, the acts that come out best first within a stage", async () => {
    const { cast, names } = await castOf();
    const menu: MenuAct[] = actMenu({ stage: 4, publicPlace: false }, cast, names, undefined, scoresFrom({}));
    const oral = menu.find((a) => a.id === "oral")!;
    // Through the eyes of the one gone down on: either of them, one each way round.
    expect(oral.views).toHaveLength(2);
    expect(oral.views!.map((v) => v.swapped).sort()).toEqual([false, true]);
    for (const v of oral.views!) expect(v).toMatchObject({ label: expect.stringMatching(/^From \w+'s eyes$/), badge: "works" });
    expect(menu.find((a) => a.id === "face_to_face")!.badge).toBe("experimental");
    expect(menu.find((a) => a.id === "spooning")!.views).toEqual([]);
    // Gentlest first still; within the acts sex opens, the best first.
    expect(menu[0].stage).toBe(0);
    const atSex = menu.filter((a) => a.stage === 4).map((a) => a.id);
    expect(atSex.indexOf("oral")).toBeLessThan(atSex.indexOf("face_to_face"));
  });
});

describe("a first-person picture from the menu", () => {
  it("starts from the one in full's face only, is tagged as seen through whose eyes, and an act without that view is refused", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    fakeHive();
    const menu = (await (await picturesGet(new Request(`${BASE_URL}/api/admin/after-dark/pictures?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()) as { acts: MenuAct[] };
    const view = menu.acts.find((a) => a.id === "oral")!.views![0];
    const res = await call(picturesPost, "/api/admin/after-dark/pictures", { a: RAFE, b: JUNIPER, act: "oral", swap: view.swapped, outfit: "nude", framing: "medium", place: "her bedroom", eyes: view.eyes }, cookie);
    expect(res.status).toBe(200);
    const pic = (await res.json()).picture as { id: string };
    const edit = seen.find((s) => s.path === "/image/multi-edit")!;
    const faces = (edit.body.images as string[]).map(mediaOf).filter((x): x is string => Boolean(x));
    expect(faces).toEqual([view.eyes === "a" ? "base-rafe" : "base-juniper"]);
    expect(String(edit.body.prompt)).toMatch(/^Make one first-person photograph/);
    const tags = (await t.db.query<{ kind: string; value: string }>(`select kind, value from adult_media_tags where media_id = $1 order by kind`, [pic.id])).rows;
    expect(tags).toEqual(expect.arrayContaining([{ kind: "act", value: "oral" }, { kind: "pov", value: view.eyes }, { kind: "who", value: "pair" }]));
    expect((await t.db.query<{ level: number }>(`select level from adult_images where id = $1`, [pic.id])).rows[0].level).toBe(3);
    // Spooning has no first-person view.
    const no = await call(picturesPost, "/api/admin/after-dark/pictures", { a: RAFE, b: JUNIPER, act: "spooning", outfit: "nude", framing: "medium", place: "her bedroom", eyes: "a" }, cookie);
    expect(no.status).toBe(422);
    // A storyboard shot started from it is filmed first person (pictureEyes, the pair's order).
    expect(await pictureEyes(t.db, pic.id, [JUNIPER, RAFE].sort() as [string, string])).toBe(view.eyes);
  });

  it("as a clip: its keyframe from one face, its video first person", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    fakeHive();
    const { cast } = await castOf();
    const oral = ACTS.find((a) => a.id === "oral")!;
    const eyes = (["a", "b"] as const).find((e) => povFor(oral, cast, e))!;
    const res = await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, act: "oral", eyes }, cookie);
    expect(res.status).toBe(200);
    const reel = (await res.json()).reel as Reel;
    expect(reel.clip).toMatchObject({ act: "oral", eyes });
    expect(reel.shots[0].eyes).toBe(eyes);
    const edit = seen.find((s) => s.path === "/image/multi-edit")!;
    expect((edit.body.images as string[]).map(mediaOf).filter(Boolean)).toHaveLength(1);
    expect(String(seen.find((s) => s.path === "/video/queue")!.body.prompt)).toMatch(/A first-person shot, seen through the eyes of/);
  });
});

describe("the director", () => {
  it("can see up to two shots through one of their eyes, named as they're named, and keeps the rest in frame", async () => {
    const { cast } = await castOf();
    const lines = Array.from({ length: 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans in* This is line number ${i}, said softly.`, stage: 4 }));
    const shot = (line: number, eyes: string | null) => ({ line, frame: `Shot ${line}, a still.`, motion: "They move.", eyes });
    setAdultModelForTests({ complete: async () => JSON.stringify({ shots: [shot(1, cast[0].tag), shot(3, cast[1].tag), shot(5, cast[0].tag), shot(7, "a stranger")] }) });
    const picks = await pickShots(t.db, lines, 4, cast, lines.map(() => "her bedroom"), lines.map(() => 4), null, "What comes out best: …");
    expect(picks.map((p) => p.eyes ?? null)).toEqual(["a", "b", null, null]);
    expect(eyesFromTag(cast, cast[1].tag.toUpperCase())).toBe("b");
  });
});

describe("tags", () => {
  it("read a Studio first-person pick as first person (and its act), and a Together shoot's view as whose eyes", () => {
    const row = (choices: Record<string, unknown>, kind = "shoot", pair: string | null = null): TagSourceRow => ({
      id: "x", kind: "scene", mime: "image/png", character_b: pair, scene_place: null, prompt: "", preset: null, shoot_kind: kind, choices,
      beat_act: null, beat_place: null, beat_stage: null, clip: null, shot: null,
    });
    const solo = deriveTags(row({ pov: "on_top", level: 3 }));
    expect(solo).toEqual(expect.arrayContaining([{ kind: "pov", value: "yes", source: "choice" }, { kind: "act", value: "on_top", source: "choice" }]));
    expect(deriveTags(row({ pov: "selfie" })).some((t) => t.kind === "pov")).toBe(false);
    const pair = deriveTags(row({ act: "oral", eyes: "b", stage: 4 }, "pair", RAFE));
    expect(pair).toEqual(expect.arrayContaining([{ kind: "pov", value: "b", source: "choice" }, { kind: "act", value: "oral", source: "choice" }]));
  });
});

describe("the chips", () => {
  it("mark what works and what's experimental, offer the views, and open an act on the view that works", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { FramingMark, ViewChips, openingView, actMark } = await import("@/app/after-dark/FramingChips");
    const { cast, names } = await castOf();
    const menu = actMenu({ stage: 4, publicPlace: false }, cast, names, undefined, scoresFrom({}));
    const oral = menu.find((a) => a.id === "oral")!;
    const close = menu.find((a) => a.id === "close")!;
    expect(renderToStaticMarkup(createElement(FramingMark, { badge: "works" }))).toContain("★");
    expect(renderToStaticMarkup(createElement(FramingMark, { badge: "experimental" }))).toContain("Experimental");
    const chips = renderToStaticMarkup(createElement(ViewChips, { act: oral, eyes: null, onPick: () => {} }));
    expect(chips).toContain("👥 Both in frame");
    expect(chips).toMatch(/👁 From \w+&#x27;s eyes/);
    // Going down opens first person (it works; both in frame has nothing to say); close together stays both in frame.
    expect(openingView(oral).eyes).not.toBeNull();
    expect(openingView(close).eyes).toBeNull();
    expect(actMark(menu.find((a) => a.id === "face_to_face")!)).toBe("experimental");
  });
});
