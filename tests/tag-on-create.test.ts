import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { POST as pgPost } from "@/app/api/characters/[id]/studio/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { tagNow } from "@/lib/adult/media-tags";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pgTagsOf } from "@/lib/studio/pg-catalog";
import { setPgStudioFetchForTests, setPgStudioPausesForTests } from "@/lib/studio/pg";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Tagged as it's made (David, 2026-10-29: "always tag assets on creation to help with filtering and showing in theater").
// No live calls: Venice, Hive and the PG check are stubbed.

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
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setStudioPausesForTests(false);
  setPgStudioPausesForTests(false);
  setCheckSleepForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setPgStudioFetchForTests(null);
  setModerationFetchForTests(null);
  setReelPausesForTests(true);
  setStudioPausesForTests(true);
  setPgStudioPausesForTests(true);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.9 }] }] };
const tagsOf = async (id: string) => (await t.db.query<{ kind: string; value: string }>(`select kind, value from adult_media_tags where media_id = $1 and not removed order by kind, value`, [id])).rows;
const taggedAt = async (id: string) => (await t.db.query<{ tagged_at: Date | null }>(`select tagged_at from adult_images where id = $1`, [id])).rows[0]?.tagged_at ?? null;

describe("tagged as it's made", () => {
  it("a Studio shoot's pictures, from its choices, before anyone opens a gallery", async () => {
    const raw = newUserCookie();
    const owner = userIdOf(raw);
    const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her" }), raw)).json()).id as string;
    await claimAdmin(t.db, owner);
    await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false });
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character, Buffer.from(PNG)]);
    setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "ADULTS" }) } }] } : CLEAN_MOD));
    setReelFetchForTests(async () => new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } }));
    const res = await studioPost(
      new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie: signedInCookie(owner) }, body: JSON.stringify({ action: "shoot", character_id: character, choices: { wardrobe: "lingerie", place: "hotel" } }) }),
    );
    const pid = (await res.json()).pictures[0].id as string;
    expect(await taggedAt(pid)).not.toBeNull();
    const tags = await tagsOf(pid);
    expect(tags).toEqual(expect.arrayContaining([{ kind: "stage", value: "1" }, { kind: "outfit", value: "lingerie" }, { kind: "who", value: "solo" }]));
    expect(tags.some((x) => x.kind === "place")).toBe(true);
  });

  it("anything ready and untagged, once; never something that isn't ready or is already tagged", async () => {
    const raw = newUserCookie();
    const owner = userIdOf(raw);
    const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('a', $1, $2, 'scene', 'kissing at the bar', 'image/png', $3, 'ready'), ('b', $1, $2, 'video', 'p', 'video/mp4', $3, 'pending')`, [owner, character, Buffer.from(PNG)]);
    expect(await tagNow(t.db, ["a", "b", null, "missing"])).toBe(1);
    expect(await taggedAt("a")).not.toBeNull();
    expect(await taggedAt("b")).toBeNull();
    expect(await tagNow(t.db, ["a"])).toBe(0);
  });

  it("a PG Studio picture, with the shoot's picks by group and never their own words", async () => {
    const picks = pgTagsOf({ shot: "candid", place: "park", accessories: ["glasses", "watch"], custom: "my own words" }, "shoot");
    expect(picks[0]).toEqual({ kind: "made", value: "shoot" });
    expect(picks).toEqual(expect.arrayContaining([{ kind: "shot", value: "candid" }, { kind: "place", value: "park" }, { kind: "accessories", value: "glasses" }, { kind: "accessories", value: "watch" }]));
    expect(JSON.stringify(picks)).not.toContain("my own words");
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice", studio: { pg: { open_to: "everyone" } } });
    const uid = crypto.randomUUID();
    const cookie = signedInCookie(uid);
    const id = (await (await api.createCharacter(validCharacter({ name: `Pia ${uid.slice(0, 6)}` }), cookie)).json()).id as string;
    setPgStudioFetchForTests(async () => new Response(Buffer.from([...PNG, 1, 2, 3]), { headers: { "content-type": "image/png" } }));
    setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: "CLOTHED", age: "ADULTS" }) } }] }));
    const r = await (await pgPost(new Request(`${BASE_URL}/api/characters/${id}/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ action: "shoot", choices: { shot: "candid", place: "park" } }) }), { params: Promise.resolve({ id }) })).json();
    const tags = (await t.db.query<{ tags: { kind: string; value: string }[] }>(`select tags from studio_pg_pictures where id = $1`, [r.pictures[0].id])).rows[0].tags;
    expect(tags).toEqual(expect.arrayContaining([{ kind: "made", value: "shoot" }, { kind: "shot", value: "candid" }, { kind: "place", value: "park" }]));
  });
});
