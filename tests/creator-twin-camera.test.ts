import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as twinPost } from "@/app/api/admin/after-dark/sfw-twin/route";
import { CAMERA_MOVES, cameraWords } from "@/lib/adult/camera-moves";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { shotPrompt, type ReelPerson } from "@/lib/adult/reels";
import { saveAdultSettings } from "@/lib/adult/settings";
import { twinPrompt } from "@/lib/adult/sfw-twin";
import { animatePrompt } from "@/lib/adult/studio-catalog";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { checkAdultText, checkPgPictureText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setPgStudioFetchForTests } from "@/lib/studio/pg";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Camera moves and the SFW twin (the creator suite, 2026-10-26). No live calls: Venice, Hive and the PG check are stubbed.

const cast: [ReelPerson, ReelPerson] = [
  { id: "a", pronouns: "she/her", noun: "woman", tag: "the woman", look: "", voice: "a bright woman's voice", names: [] },
  { id: "b", pronouns: "he/him", noun: "man", tag: "the man", look: "", voice: "a man's voice", names: [] },
];

describe("camera moves", () => {
  it("take the steady camera's place in a clip's prompt, and a first-person shot keeps its own", () => {
    expect(cameraWords(null)).toBe("the camera steady");
    expect(cameraWords("nonsense")).toBe("the camera steady");
    for (const m of CAMERA_MOVES) {
      expect(checkAdultText({ words: m.words }).ok).toBe(true);
      expect(animatePrompt({ noun: "woman" }, 2, "sways", {}, { camera: m.id })).toContain(`One continuous shot, ${m.words}:`);
      expect(shotPrompt(cast, { who: "a", text: "", motion: "They kiss.", camera: m.id }, false)).toContain(`One continuous shot, ${m.words}:`);
    }
    expect(shotPrompt(cast, { who: "a", text: "", motion: "They kiss.", eyes: "a", camera: "orbit_left" }, false)).toContain("the camera moving as the woman's eyes would");
  });

  it("show as tiles, the picked one checked, each previewing its move", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: CameraMoves } = await import("@/app/after-dark/CameraMoves");
    const html = renderToStaticMarkup(createElement(CameraMoves, { value: "push_in", onChange: () => {}, src: "/m/p" }));
    expect(html.match(/role="radio"/g)).toHaveLength(CAMERA_MOVES.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain("move-push_in");
    expect(html).toContain('src="/m/p"');
  });
});

describe("the SFW twin's prompt", () => {
  it("keeps the people, place and light, dresses everyone, and passes the show's own word check", () => {
    for (const tags of [["the woman"], ["the woman", "the man"]]) {
      const p = twinPrompt(tags);
      expect(p).toContain("safe-for-work");
      expect(p).toContain("in the same place and light");
      expect(checkPgPictureText({ words: p }).ok, p).toBe(true);
    }
    expect(twinPrompt(["the woman", "the man"])).toContain("Two people only.");
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
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setCheckSleepForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setPgStudioFetchForTests(null);
  setModerationFetchForTests(null);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.05 }] }] };
function stubs(clothing = "CLOTHED") {
  const drawn: { url: string; body: Record<string, unknown> }[] = [];
  setPgStudioFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    drawn.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
  });
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age: "ADULTS" }) } }] }));
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "ADULTS" }) } }] } : CLEAN_MOD),
  );
  return drawn;
}
const twin = (body: unknown, cookie: string) =>
  twinPost(new Request(`${BASE_URL}/api/admin/after-dark/sfw-twin`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function setup(opts: { admin?: boolean } = {}) {
  const raw = newUserCookie();
  const owner = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 29 }), raw)).json()) as { id: string };
  if (opts.admin) await claimAdmin(t.db, owner);
  else await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [owner]);
  await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", studio: { pg: { open_to: "everyone" } } });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character.id]);
  return { owner, cookie: signedInCookie(owner), character: character.id };
}
const used = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;

describe("the SFW twin", () => {
  it("makes one of their own character alone again in safe mode, PG-checked, into the PG Studio's gallery, for a token", async () => {
    const { owner, cookie, character } = await setup();
    const drawn = stubs();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, level, aspect) values ('pic-1', $1, $2, 'scene', 'p', 'image/png', $3, 'ready', 3, '4:5')`, [owner, character, Buffer.from(PNG)]);
    expect((await twin({ media_id: "pic-1" }, cookie)).status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 3, 'test')`, [crypto.randomUUID(), owner]);
    const res = await twin({ media_id: "pic-1" }, cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ where: "pg", character_id: character, original: "pic-1", picture: { rating: "pg" } });
    expect(drawn).toHaveLength(1);
    expect(drawn[0].body).toMatchObject({ safe_mode: true, aspect_ratio: "4:5" });
    expect(String((drawn[0].body.images as string[])[0])).toContain("/media/pic-1?until=");
    const row = (await t.db.query<{ twin_of: string; content_rating: string; aspect: string }>(`select twin_of, content_rating, aspect from studio_pg_pictures where id = $1`, [out.picture.id])).rows[0];
    expect(row).toEqual({ twin_of: "pic-1", content_rating: "pg", aspect: "4:5" });
    expect(await used(owner)).toBe(1);
    // The PG check turns one down: nothing kept, the token back.
    stubs("NUDITY");
    expect((await twin({ media_id: "pic-1" }, cookie)).status).toBe(422);
    expect(await used(owner)).toBe(1);
    // Not theirs: not found.
    const other = await setup();
    expect((await twin({ media_id: "pic-1" }, other.cookie)).status).toBe(404);
  });

  it("keeps a twin of two in After Dark, through the output check too, rated by the PG check", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    stubs("REVEALING");
    const [a, b] = pairKey(character, HOUSE_CHARACTERS[0].id);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, level) values ('pair-1', $1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready', 3)`, [owner, a, b, Buffer.from(PNG)]);
    const out = await (await twin({ media_id: "pair-1" }, cookie)).json();
    expect(out.where).toBe("after_dark");
    const row = (await t.db.query<{ twin_of: string; content_rating: string; level: number; character_b: string }>(`select twin_of, content_rating, level, character_b from adult_images where id = $1`, [out.picture.id])).rows[0];
    expect(row).toEqual({ twin_of: "pair-1", content_rating: "suggestive", level: 0, character_b: b });
  });
});
