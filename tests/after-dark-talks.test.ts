import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { GET as talkGet, POST as talkPost } from "@/app/api/admin/after-dark/talk/route";
import { GET as talkFileGet } from "@/app/api/admin/after-dark/talk/[id]/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { TALK_PROMPT } from "@/lib/adult/talks";
import { setVoiceFetchForTests } from "@/lib/adult/voice-lines";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Talking moments (lib/adult/talks.ts; docs/PRDs/theater-immersion.md #4): no live calls here.
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
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setReplicateFetchForTests(null);
  setCheckFetchForTests(null);
  setVoiceFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

// Rafe (he) and Juniper (she); the pair is stored lower id first, so "a" is Juniper.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie?: string) =>
  talkPost(new Request(`${BASE_URL}/api/admin/after-dark/talk`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const list = async (cookie: string) => (await (await talkGet(new Request(`${BASE_URL}/api/admin/after-dark/talk?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()) as { talks: { id: string; status: string; who: string; text: string; error: string | null }[]; price: number };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.1 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
const LINES = [
  { who: "a", text: "*smiles* You kept me waiting by the railing." },
  { who: "b", text: "*leans in*" },
];
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
}
/** Venice: voices, a queued clip, and a retrieve that's `state()`. Records what was asked. */
function fakeVenice(state: () => "making" | "ready" | "failed" = () => "making") {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  setVoiceFetchForTests(async () => new Response(MP3, { headers: { "content-type": "audio/mpeg" } }));
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: "talk-q1" });
    if (path === "/video/retrieve") {
      if (body.delete_media_on_completion) return Response.json({ success: true });
      const now = state();
      if (now === "failed") return new Response("nope", { status: 500 });
      return now === "ready" ? new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "content-type": "video/mp4" } }) : Response.json({ status: "PROCESSING" });
    }
    return new Response("?", { status: 500 });
  });
  return seen;
}
/** After Dark on, the pair's night with LINES, and (unless `portrait` is false) a portrait for Juniper. */
async function ready(cookie: string, owner: string, portrait = true) {
  await settingsPost(
    new Request(`${BASE_URL}/api/admin/after-dark/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }),
    }),
  );
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(LINES)]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [`face-${owner}`, owner, JUNIPER, Buffer.from(PNG)]);
  if (portrait) {
    await t.db.query(`insert into adult_presence (id, owner_id, character_id, face_id, part, status, mime, data) values ($1, $2, $3, $4, 'portrait', 'ready', 'image/png', $5)`, [
      `portrait-${owner}`,
      owner,
      JUNIPER,
      `face-${owner}`,
      Buffer.from(PNG),
    ]);
  }
}

describe("a talking moment", () => {
  it("is the speaker's portrait saying the line in its own voice, queued once, kept when it's checked, and played again for free", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    const cookie = signedIn(id);
    await ready(cookie, id);
    fakeHive();
    let state: "making" | "ready" = "making";
    const seen = fakeVenice(() => state);
    const res = await post({ a: RAFE, b: JUNIPER, i: 0, text: LINES[0].text }, cookie);
    expect(res.status).toBe(202);
    const { talk, price } = (await res.json()) as { talk: { id: string; status: string; who: string }; price: number };
    expect(talk).toMatchObject({ status: "making", who: "a" });
    expect(price).toBe(0);
    const queued = seen.find((s) => s.path === "/video/queue")!;
    expect(queued.body).toMatchObject({ model: "wan-2.6-flash-image-to-video", duration: "5s", prompt: TALK_PROMPT });
    expect(String(queued.body.image_url)).toContain(`/presence/portrait-${id}?`);
    expect(String(queued.body.audio_url)).toMatch(/^data:audio\/mpeg;base64,/);
    expect(queued.body.audio).toBeUndefined();
    // The same line again: the one being made, nothing queued again.
    expect(((await (await post({ a: RAFE, b: JUNIPER, i: 0, text: LINES[0].text }, cookie)).json()) as { talk: { id: string } }).talk.id).toBe(talk.id);
    expect(seen.filter((s) => s.path === "/video/queue")).toHaveLength(1);
    // Done at Venice: checked, kept, counted, served to its owner only.
    state = "ready";
    const listed = await list(cookie);
    expect(listed.talks).toEqual([expect.objectContaining({ id: talk.id, status: "ready", who: "a", text: LINES[0].text })]);
    expect((await t.db.query<{ clips: number }>(`select clips from adult_usage where owner_id = $1`, [id])).rows[0].clips).toBe(1);
    const file = await talkFileGet(new Request(`${BASE_URL}/api/admin/after-dark/talk/${talk.id}`, { headers: { cookie } }), { params: Promise.resolve({ id: talk.id }) });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("video/mp4");
    const other = userIdOf(newUserCookie());
    await claimAdmin(t.db, other);
    expect((await talkFileGet(new Request(`${BASE_URL}/api/admin/after-dark/talk/${talk.id}`, { headers: { cookie: signedIn(other) } }), { params: Promise.resolve({ id: talk.id }) })).status).toBe(404);
  });

  it("needs their portrait and words to say, and is After Dark's viewers' only", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    const cookie = signedIn(id);
    await ready(cookie, id, false);
    fakeHive();
    fakeVenice();
    expect((await post({ a: RAFE, b: JUNIPER, i: 0, text: LINES[0].text })).status).toBe(404);
    const noPortrait = await post({ a: RAFE, b: JUNIPER, i: 0, text: LINES[0].text }, cookie);
    expect(noPortrait.status).toBe(409);
    expect((await noPortrait.json()).error).toBe("no_portrait");
    expect((await (await post({ a: RAFE, b: JUNIPER, i: 1, text: LINES[1].text }, cookie)).json()).error).toBe("silent");
    expect((await (await post({ a: RAFE, b: JUNIPER, i: 0, text: "something else" }, cookie)).json()).error).toBe("stale");
  });

  it("costs a subscriber a clip's tokens, and gives them back when it can't be made", async () => {
    const { id: adminId } = await (async () => {
      const id = userIdOf(newUserCookie());
      await claimAdmin(t.db, id);
      return { id };
    })();
    await ready(signedIn(adminId), adminId, false);
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const cookie = signedIn(sub);
    await ready(cookie, sub);
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0]?.used ?? 0;
    fakeHive();
    let state: "making" | "failed" = "making";
    fakeVenice(() => state);
    expect((await list(cookie)).price).toBe(3);
    expect((await post({ a: RAFE, b: JUNIPER, i: 0, text: LINES[0].text }, cookie)).status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 20, 'test')`, [crypto.randomUUID(), sub]);
    expect((await post({ a: RAFE, b: JUNIPER, i: 0, text: LINES[0].text }, cookie)).status).toBe(202);
    expect(await used()).toBe(3);
    state = "failed";
    const failed = (await list(cookie)).talks[0];
    expect(failed).toMatchObject({ status: "failed" });
    expect(await used()).toBe(0);
  });
});
