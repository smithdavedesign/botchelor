import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { beatPicturesSettled } from "@/lib/adult/beats";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-25: "when we get stopped and asked in theatre mode if we should take an image of the scene, add the
// context that will be sent, and allow additional context … what they are wearing and whether they are clothed, or trash
// talking or flirting … more confidence the better"; and "a button to regenerate an image for a scene in case it's wrong".
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
  setCheckSleepForTests(async () => {});
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
/** Venice's multi-edit and Hive, stubbed: every picture drawn is kept, its prompt recorded. */
function fakeMedia(fail = false) {
  const edits: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    if (path === "/image/multi-edit") {
      edits.push(String(JSON.parse(String(init?.body ?? "{}")).prompt));
      return fail ? new Response("down", { status: 500 }) : new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    }
    return new Response("?", { status: 500 });
  });
  return edits;
}

/** After Dark on, both baselines in, the pair's scene with these lines (a = Juniper, the pair's lower id), in her bedroom. */
async function ready(cookie: string, ownerId: string, lines: { who: "a" | "b"; text: string; stage: number; doing?: string }[], extra: Record<string, unknown> = {}) {
  await post({ enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie, settingsPost, "/api/admin/after-dark/settings");
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4) on conflict do nothing`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  const stage = lines.at(-1)?.stage ?? 0;
  await t.db.query(`update adult_scenes set stage = $3, place = 'her bedroom', set_place = 'her bedroom', lines = $2::jsonb, roleplay = $4::jsonb where id = $1`, [
    scene.id,
    JSON.stringify(lines),
    stage,
    JSON.stringify(extra.roleplay ?? null),
  ]);
  return scene;
}
const KISSING = [
  { who: "a" as const, text: "*pulls him down onto the bed by his collar* Come here.", stage: 2, doing: "trash talking between kisses" },
  { who: "b" as const, text: "*laughs against her mouth* You talk too much.", stage: 2, doing: "trash talking between kisses" },
  { who: "a" as const, text: "*tugs his shirt loose from his jeans* Prove it.", stage: 2, doing: "trash talking between kisses" },
];
const preview = async (cookie: string, body: Record<string, unknown>) => post({ a: RAFE, b: JUNIPER, picture_preview: body }, cookie);

describe("a scene picture's context, before it's drawn", () => {
  it("shows what it would be drawn from, field by field, and the prompt: nothing drawn", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING, { roleplay: { id: "rivals", swap: false, chapter: 1 } });
    const edits = fakeMedia();
    const res = await preview(cookie, { line: 2 });
    expect(res.status).toBe(200);
    const { preview: p } = await res.json();
    expect(p.fields).toEqual({
      happening: "pulls him down onto the bed by his collar; laughs against her mouth; tugs his shirt loose from his jeans",
      // Neither has an outfit picked: each gets one of the everyday picks, the same every time (everydayOf).
      wearing: "The woman in a tailored blazer over a silk blouse and trousers; the man in an oversized hoodie, cargo trousers and sneakers",
      place: "her bedroom",
      mood: "Rivals · trash talking between kisses",
    });
    expect(p.prompt).toContain("What is happening: pulls him down onto the bed");
    expect(p.prompt).toContain("The mood: Rivals · trash talking between kisses.");
    await beatPicturesSettled();
    expect(edits).toHaveLength(0);
  });

  it("the owner's changes replace the guesses in the prompt, and their extra words lead it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING);
    fakeMedia();
    const edit = { happening: "she has him pinned against the headboard", wearing: "her in his unbuttoned shirt, him in jeans", mood: "flirting, both laughing", extra: "candlelight from the left" };
    const { preview: p } = await (await preview(cookie, { line: 2, edit })).json();
    expect(p.edit).toEqual(edit);
    expect(p.prompt).toContain("Most important, do exactly this: candlelight from the left.");
    expect(p.prompt).toContain("What is happening: she has him pinned against the headboard.");
    expect(p.prompt).not.toContain("pulls him down onto the bed");
    expect(p.prompt).toContain("not their clothes: her in his unbuttoned shirt, him in jeans.");
    expect(p.prompt).not.toContain("shirts and tops on");
    expect(p.prompt).toContain("The mood: flirting, both laughing.");
  });

  it("refuses a change that crosses the lines, with nothing drawn", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING);
    const edits = fakeMedia();
    expect((await preview(cookie, { line: 2, edit: { wearing: "a schoolgirl uniform" } })).status).toBe(422);
    expect((await post({ a: RAFE, b: JUNIPER, picture_now: { line: 2, edit: { happening: "she's barely a teen" } } }, cookie)).status).toBe(422);
    await beatPicturesSettled();
    expect(edits).toHaveLength(0);
  });

  it("Picture this and an offered moment are drawn with the owner's changes", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING);
    const edits = fakeMedia();
    const r = await (await post({ a: RAFE, b: JUNIPER, picture_now: { line: 2, edit: { wearing: "both still dressed, his shirt half open" } } }, cookie)).json();
    expect(r.beat.kind).toBe("chosen");
    await beatPicturesSettled();
    expect(edits.at(-1)).toContain("not their clothes: both still dressed, his shirt half open.");
  });
});

describe("Redraw", () => {
  async function drawnPicture(cookie: string) {
    await post({ a: RAFE, b: JUNIPER, picture_now: { line: 2 } }, cookie);
    await beatPicturesSettled();
    return (await t.db.query<{ picture_id: string }>(`select picture_id from adult_beats where status = 'drawn' order by created_at desc limit 1`)).rows[0].picture_id;
  }

  it("draws the same moment again with the owner's changes; the old picture stays; free for an admin", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING);
    const edits = fakeMedia();
    const first = await drawnPicture(cookie);
    const r = await (await post({ a: RAFE, b: JUNIPER, redraw: { picture_id: first, edit: { wearing: "her in a red dress, him in a white shirt" } } }, cookie)).json();
    expect(r.beat).toMatchObject({ kind: "chosen", line: 2, status: "drawing" });
    await beatPicturesSettled();
    expect(edits).toHaveLength(2);
    expect(edits[1]).toContain("not their clothes: her in a red dress, him in a white shirt.");
    const kept = (await t.db.query<{ n: number }>(`select count(*)::int as n from adult_images where kind = 'scene' and status = 'ready'`)).rows[0].n;
    expect(kept).toBe(2);
  });

  it("isn't for a picture that isn't the viewer's", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING);
    fakeMedia();
    const first = await drawnPicture(cookie);
    const other = await admin();
    await ready(other.cookie, other.id, KISSING);
    expect((await post({ a: RAFE, b: JUNIPER, redraw: { picture_id: first } }, other.cookie)).status).toBe(404);
  });

  it("costs a subscriber a token, given back when the picture doesn't come", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, KISSING);
    fakeMedia();
    const first = await drawnPicture(cookie);
    // The picture moves to a subscriber's own scene of the pair, so it's theirs to redraw.
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 1, 'test')`, [crypto.randomUUID(), sub]);
    await t.db.query(`update adult_settings set cap_pictures = 30, cap_writes = 300`);
    const subScene = await ready(signedIn(sub), sub, KISSING);
    await t.db.query(`update adult_images set owner_id = $1 where id = $2`, [sub, first]);
    await t.db.query(`update adult_beats set owner_id = $1, scene_id = $2 where picture_id = $3`, [sub, subScene.id, first]);
    fakeMedia(true);
    const r = await post({ a: RAFE, b: JUNIPER, redraw: { picture_id: first } }, signedIn(sub));
    expect(r.status).toBe(200);
    expect((await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0].used).toBe(1);
    await beatPicturesSettled();
    expect((await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0].used).toBe(0);
  });
});
