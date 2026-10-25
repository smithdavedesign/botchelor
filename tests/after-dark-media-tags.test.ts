import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as tagsGet, POST as tagsPost } from "@/app/api/admin/after-dark/media/[id]/tags/route";
import { setAdultSwitch } from "@/lib/adult/characters";
import { deriveTags, ensureTagged, modelTagPending, placeKeys, scoreMedia, setTag, type TagSourceRow } from "@/lib/adult/media-tags";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { saveAdultSettings } from "@/lib/adult/settings";
import { sceneBackdrop, sceneClip, sceneMatch } from "@/lib/adult/scene-match";
import { showsLabel } from "@/lib/adult/tag-labels";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// What each After Dark picture and clip shows, as tags, and the theater's matching by them (lib/adult/media-tags.ts;
// David, 2026-10-25: "Star has a blowjob video in the movie theater … tag the assets so we can map them in theater
// mode"). No live calls: the model is stubbed.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  setSeasonCastForTests([]);
});
afterEach(() => setAdultModelForTests(null));

const PNG = Buffer.from([137, 80, 78, 71]);
const MP4 = Buffer.from([0, 0, 0, 24]);
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];

async function pair() {
  const cookie = newUserCookie();
  const owner = userIdOf(cookie);
  const star = ((await (await api.createCharacter(validCharacter({ name: "Star Dust", pronouns: "she/her", age: 24 }), cookie)).json()) as { id: string }).id;
  const chud = ((await (await api.createCharacter(validCharacter({ name: "Chud Crusher", pronouns: "he/him", age: 30 }), cookie)).json()) as { id: string }).id;
  await setAdultSwitch(t.db, owner, star, true);
  await setAdultSwitch(t.db, owner, chud, true);
  const [lo, hi] = [star, chud].sort();
  return { owner, star, chud, lo, hi };
}

/** A Studio shoot of one of them, and one picture from it. */
async function soloShoot(owner: string, who: string, choices: Record<string, unknown>, id: string) {
  await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, status) values ($1, $2, $3, 'shoot', $4::jsonb, 'ready')`, [`sh-${id}`, owner, who, JSON.stringify(choices)]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, shoot_id) values ($1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready', $5)`, [id, owner, who, PNG, `sh-${id}`]);
}
/** A Studio clip animated from one of their pictures. */
async function animated(owner: string, who: string, source: string, id: string) {
  await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, status) values ($1, $2, $3, 'animate', $4::jsonb, 'ready')`, [`sh-${id}`, owner, who, JSON.stringify({ source, motion: "breathe", seconds: 10, level: 3 })]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, source_image, shoot_id) values ($1, $2, $3, 'video', 'Studio clip: breathe', 'video/mp4', $4, 'ready', $5, $6)`, [id, owner, who, MP4, source, `sh-${id}`]);
}
async function sceneAt(owner: string, lo: string, hi: string, lines: { text: string }[], stage: number, place: string | null) {
  await t.db.query(
    `insert into adult_scenes (id, owner_id, character_a, character_b, lines, stage, place) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (owner_id, character_a, character_b) do update set lines = excluded.lines, stage = excluded.stage, place = excluded.place`,
    [`sc-${lo}-${hi}`, owner, lo, hi, JSON.stringify(lines), stage, place],
  );
}
const tagsOf = async (id: string) => (await t.db.query<{ kind: string; value: string; source: string }>(`select kind, value, source from adult_media_tags where media_id = $1 and not removed order by kind, value`, [id])).rows;

describe("tags from what it was made with", () => {
  it("reads the places from free words: a cinema is the movie theater, whatever it's called", () => {
    expect(placeKeys("Dark modern cinema full of people")).toEqual(["movie_theater"]);
    expect(placeKeys("In the movie theatre star dust is blowing Chud")).toEqual(["movie_theater"]);
    expect(placeKeys("a rooftop pool")).toEqual(["pool", "rooftop"]);
    expect(placeKeys("They talk over wine.")).toEqual([]);
  });

  it("a Studio Filthy act is the shared act, first-person when it's with the viewer; the place from its words; a clip shows what its picture shows", () => {
    const base: TagSourceRow = { id: "x", kind: "scene", mime: "image/png", character_b: null, scene_place: null, prompt: "p", preset: "warm", shoot_kind: "shoot", choices: null, beat_act: null, beat_place: null, beat_stage: null, clip: null, shot: null };
    const pic = deriveTags({ ...base, choices: { filthy: "pov_blowjob", level: 3, wardrobe: "topless", extra: { place: "movie theater" } } });
    expect(pic).toEqual(
      expect.arrayContaining([
        { kind: "who", value: "solo", source: "choice" },
        { kind: "act", value: "oral", source: "choice" },
        { kind: "pov", value: "yes", source: "choice" },
        { kind: "stage", value: "3", source: "choice" },
        { kind: "outfit", value: "topless", source: "choice" },
        { kind: "place", value: "movie_theater", source: "derived" },
      ]),
    );
    // From behind, but not with the viewer: the act, no POV.
    const behind = deriveTags({ ...base, choices: { filthy: "all_fours", level: 3 } });
    expect(behind.some((x) => x.kind === "act" && x.value === "behind")).toBe(true);
    expect(behind.some((x) => x.kind === "pov")).toBe(false);
    // A clip from that picture: its act, place and POV come with it.
    const clip = deriveTags({ ...base, kind: "video", mime: "video/mp4", shoot_kind: "animate", choices: { source: "x", level: 3 } }, pic);
    expect(clip).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "act", value: "oral" }), expect.objectContaining({ kind: "pov", value: "yes" }), expect.objectContaining({ kind: "place", value: "movie_theater" })]));
  });

  it("labels a tile with what it shows: the act, the place, POV; nothing when it has none", () => {
    expect(showsLabel([{ kind: "act", value: "oral" }, { kind: "place", value: "movie_theater" }, { kind: "pov", value: "yes" }])).toBe("Going down · Movie theater · POV");
    expect(showsLabel([{ kind: "place", value: "rooftop" }])).toBe("Rooftop");
    expect(showsLabel([{ kind: "who", value: "solo" }])).toBeNull();
    expect(showsLabel(null)).toBeNull();
  });

  it("scores the act most, then the place, the pair over a first-person one over one alone; never past how far the night has gone", () => {
    const c = (tags: [string, string][], b: string | null = null, mime = "image/png") => ({ id: "c", mime, character_id: "s", character_b: b, created_at: "2026-10-25T00:00:00Z", tags: tags.map(([kind, value]) => ({ kind: kind as never, value, source: "choice" as const })) });
    const now = { act: "oral", places: ["movie_theater"], stage: 4 };
    expect(scoreMedia(c([["act", "oral"], ["place", "movie_theater"]], "x"), now)).toBe(12 + 5 + 4);
    expect(scoreMedia(c([["act", "oral"], ["pov", "yes"]]), now)).toBe(12 + 3);
    expect(scoreMedia(c([["act", "oral"], ["pov", "yes"], ["date", "yes"]], null, "video/mp4"), now)).toBe(12 + 3 + 6 + 1);
    expect(scoreMedia(c([["act", "behind"]]), now)).toBeNull();
    // Explicit, while they're still talking: not yet.
    expect(scoreMedia(c([["place", "movie_theater"], ["stage", "3"]]), { act: null, places: ["movie_theater"], stage: 1 })).toBeNull();
  });
});

describe("Star's first-person clip in the movie theater, on her date with Chud", () => {
  it("is tagged from its own record (the back-fill), and fills the theater's backdrop when the scene gets there", async () => {
    const { owner, star, chud, lo, hi } = await pair();
    await soloShoot(owner, star, { filthy: "pov_blowjob", level: 3, extra: { place: "movie theater" } }, "star-pic");
    await animated(owner, star, "star-pic", "star-clip");
    await sceneAt(owner, lo, hi, [{ text: "*leans close* The film's barely started." }, { text: "She sinks to her knees and takes him in her mouth." }], 4, "In the movie theatre");
    expect(await sceneBackdrop(t.db, owner, star, chud)).toEqual({ kind: "clip", id: "star-clip" });
    expect(await sceneClip(t.db, owner, star, chud)).toEqual({ media_id: "star-clip", act: "oral" });
    expect(await sceneMatch(t.db, owner, star, chud)).toEqual({ image_id: "star-pic", act: "oral" });
    expect((await tagsOf("star-clip")).map((x) => `${x.kind}:${x.value}`)).toEqual(expect.arrayContaining(["act:oral", "pov:yes", "place:movie_theater", "stage:3", "who:solo"]));
    // Not yet while they're still talking in the theater: it's explicit.
    await sceneAt(owner, lo, hi, [{ text: "*leans close* The film's barely started." }], 1, "In the movie theatre");
    expect(await sceneBackdrop(t.db, owner, star, chud)).toBeNull();
  });

  it("one of them alone, not first-person, never fills the screen; it's offered as the 📷 picture instead", async () => {
    const { owner, star, chud, lo, hi } = await pair();
    await soloShoot(owner, star, { filthy: "all_fours", level: 3 }, "star-behind");
    await sceneAt(owner, lo, hi, [{ text: "He bends her over the arm of the sofa, from behind." }], 4, "the sofa");
    expect(await sceneBackdrop(t.db, owner, star, chud)).toBeNull();
    expect(await sceneMatch(t.db, owner, star, chud)).toEqual({ image_id: "star-behind", act: "behind" });
  });

  it("a tag the owner takes away stays away; one they add, or a 📌, counts", async () => {
    const { owner, star, chud, lo, hi } = await pair();
    await soloShoot(owner, star, { filthy: "pov_blowjob", level: 3 }, "star-pic");
    await ensureTagged(t.db, owner, [star]);
    await setTag(t.db, owner, "star-pic", "pov", "yes", false);
    // A fresh pass doesn't bring it back.
    await t.db.query(`update adult_images set tagged_at = null where id = 'star-pic'`);
    await ensureTagged(t.db, owner, [star]);
    expect((await tagsOf("star-pic")).some((x) => x.kind === "pov")).toBe(false);
    await sceneAt(owner, lo, hi, [{ text: "She takes him in her mouth." }], 4, null);
    expect(await sceneBackdrop(t.db, owner, star, chud)).toBeNull();
    // A pair picture of the act, and Star's pinned first-person one: the pin wins.
    await setTag(t.db, owner, "star-pic", "pov", "yes", true);
    await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, partner_id, kind, choices, status) values ('sh-both', $1, $2, $3, 'pair', '{"act": "oral"}'::jsonb, 'ready')`, [owner, lo, hi]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, shoot_id) values ('both', $1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready', 'sh-both')`, [owner, lo, hi, PNG]);
    expect(await sceneBackdrop(t.db, owner, star, chud)).toEqual({ kind: "image", id: "both" });
    await setTag(t.db, owner, "star-pic", "date", "yes", true);
    expect(await sceneBackdrop(t.db, owner, star, chud)).toEqual({ kind: "image", id: "star-pic" });
  });
});

describe("the model's read of the owner's own words", () => {
  it("tags the place and act their words describe, from the lists only, once", async () => {
    const { owner, star } = await pair();
    await soloShoot(owner, star, { pose: "kneeling", level: 3, custom: "Dark modern cinema, sitting promiscuously in a seat next to the viewer" }, "words-pic");
    await ensureTagged(t.db, owner, [star]);
    const asked: string[] = [];
    setAdultModelForTests({
      complete: async (msgs) => {
        asked.push(msgs.map((m) => m.content).join("\n"));
        return '{"place": "movie_theater", "act": "oral", "pov": true}';
      },
    });
    expect(await modelTagPending(t.db, owner, [star])).toBe(1);
    expect(asked[0]).toContain("Dark modern cinema");
    expect(await tagsOf("words-pic")).toEqual(expect.arrayContaining([{ kind: "place", value: "movie_theater", source: "model" }, { kind: "act", value: "oral", source: "model" }, { kind: "pov", value: "yes", source: "model" }]));
    // Read once.
    expect(await modelTagPending(t.db, owner, [star])).toBe(0);
    expect(asked).toHaveLength(1);
  });

  it("keeps nothing a reply makes up: only keys from the lists", async () => {
    const { owner, star } = await pair();
    await soloShoot(owner, star, { level: 2, custom: "on a spaceship" }, "odd-pic");
    await ensureTagged(t.db, owner, [star]);
    setAdultModelForTests({ complete: async () => '{"place": "spaceship", "act": "zero_g", "pov": false}' });
    await modelTagPending(t.db, owner, [star]);
    expect((await tagsOf("odd-pic")).some((x) => x.source === "model")).toBe(false);
  });
});

describe("the tags route", () => {
  it("shows the owner their picture's tags, takes a tag away and adds one; not found for anyone else", async () => {
    const { owner, star } = await pair();
    await soloShoot(owner, star, { filthy: "pov_blowjob", level: 3 }, "star-pic");
    // After Dark on, the owner and a stranger both subscribed and age-checked: what's theirs is theirs.
    await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD" });
    const entitle = (u: string) => t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [u]);
    const strangerId = userIdOf(newUserCookie());
    await entitle(owner);
    await entitle(strangerId);
    const cookie = signedIn(owner);
    const at = (c: string, body?: unknown) =>
      (body ? tagsPost : tagsGet)(
        new Request(`${BASE_URL}/api/admin/after-dark/media/star-pic/tags`, body ? { method: "POST", headers: { cookie: c, "content-type": "application/json" }, body: JSON.stringify(body) } : { headers: { cookie: c } }),
        { params: Promise.resolve({ id: "star-pic" }) },
      );
    const first = await (await at(cookie)).json();
    expect(first.tags).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "act", value: "oral" })]));
    expect(first.options.place).toEqual(expect.arrayContaining([{ value: "movie_theater", label: "Movie theater" }]));
    const pinned = await (await at(cookie, { kind: "date", value: "yes", on: true })).json();
    expect(pinned.tags).toEqual(expect.arrayContaining([{ kind: "date", value: "yes", source: "manual" }]));
    const placed = await (await at(cookie, { kind: "place", value: "movie_theater", on: true })).json();
    expect(placed.tags.some((x: { kind: string; value: string }) => x.kind === "place" && x.value === "movie_theater")).toBe(true);
    expect((await at(cookie, { kind: "place", value: "the moon", on: true })).status).toBe(422);
    const stranger = signedIn(strangerId);
    expect((await at(stranger)).status).toBe(404);
    expect((await at(stranger, { kind: "date", value: "yes", on: true })).status).toBe(404);
  });
});
