import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as videoRoute from "@/app/api/assets/[id]/video/route";
import * as claimRoute from "@/app/api/admin/claim/route";
import * as clipRoute from "@/app/api/characters/[id]/clip/route";
import { isAdmin } from "@/lib/admins";
import { CLIP_TOKEN_COST, episodeAllowance } from "@/lib/allowance";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { registerAccount } from "@/lib/auth";
import { setDbForTests } from "@/lib/db";
import { saveUserKey } from "@/lib/keys";
import { downloadVeoClip, pollVeoClip, startVeoClip, veoClipPrompt, VEO_MODEL } from "@/lib/video";
import { BASE_URL, api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: OwnerControls } = await import("@/app/characters/[id]/OwnerControls");

const SECRET = ["clip", "test", "secret", "0123456789abcdef"].join("-");
const GOOGLE_KEY = ["AIza", "TestKeyNotReal0123456789"].join("");
const ADMIN_PASSWORD = ["admin", "pass", "test"].join("-");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MP4 = Buffer.from("fake-mp4-bytes-0123456789");
const OP = `models/${VEO_MODEL}/operations/op123`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from user_keys");
  await t.db.query("delete from character_assets");
  await t.db.query("delete from admins");
  await t.db.query("delete from pack_episode_usage");
  setDbForTests(t.db);
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", ADMIN_PASSWORD);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A global fetch stub for Google's Veo endpoints: start, poll (done or a status), and the MP4 download. */
function stubVeo(poll: "done" | "rendering" | "filtered" = "done", seen: { start?: Any } = {}) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith(`/models/${VEO_MODEL}:predictLongRunning`)) {
      seen.start = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ name: OP }), { status: 200 });
    }
    if (u.endsWith(`/${OP}`)) {
      if (poll === "rendering") return new Response(JSON.stringify({ name: OP, done: false }), { status: 200 });
      if (poll === "filtered") return new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["policy"] } } }), { status: 200 });
      return new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media" } }] } } }), { status: 200 });
    }
    if (u.startsWith("https://generativelanguage.googleapis.com/v1beta/files/abc")) return new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } });
    return new Response("not found", { status: 404 });
  });
}

/** A signed-in owner with a character and, optionally, a Google key and bought tokens. */
async function owner(opts: { key?: boolean; bought?: number } = {}) {
  const cookie = newUserCookie();
  const userId = userIdOf(cookie);
  const character = await (await api.createCharacter(validCharacter(), cookie)).json();
  await registerAccount(t.db, userId, `clipper${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  if (opts.key !== false) await saveUserKey(t.db, userId, "google", "text", GOOGLE_KEY, null, { SESSION_SECRET: SECRET });
  if (opts.bought) {
    await t.db.query(
      `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, episodes) values ($1, $2, 'pack_5', 'episode_pack', 400, 'usd', 'paid', $3)`,
      [crypto.randomUUID(), userId, opts.bought],
    );
  }
  return { cookie, userId, character };
}
const post = (id: string, cookie: string) => clipRoute.POST(new Request(`${BASE_URL}/api/characters/${id}/clip`, { method: "POST", headers: { cookie } }), params(id));
const poll = (id: string, cookie: string) => clipRoute.GET(new Request(`${BASE_URL}/api/characters/${id}/clip`, { headers: { cookie } }), params(id));

describe("Veo on the player's Google key (lib/video.ts)", () => {
  it("animates the portrait when there is one, from filtered sheet text, 4 seconds, vertical, 720p", async () => {
    const seen: { start?: Any } = {};
    stubVeo("done", seen);
    const job = await startVeoClip(GOOGLE_KEY, { name: "Ira Fenn", age: 26, bio: "", traits: ["bookish", "warm", "stubborn"], pronouns: "they/them" }, PNG);
    expect(job.operation).toBe(OP);
    // The live API refuses the docs' inlineData shape ("`inlineData` isn't supported by this model").
    expect(seen.start.instances[0].image).toEqual({ bytesBase64Encoded: PNG.split(",")[1], mimeType: "image/png" });
    expect(seen.start.instances[0].prompt).toMatch(/Bring this illustrated portrait to life/);
    expect(seen.start.parameters).toEqual({ aspectRatio: "9:16", durationSeconds: 4, resolution: "720p" });
    expect(veoClipPrompt({ name: "X", age: 17, bio: "", traits: ["a"] }, false)).toMatch(/an adult around 18/);
  });

  it("sends no image without a portrait, and shows Google's own reason for a refusal", async () => {
    const bodies: Any[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: { message: "`bogusField` isn't supported by this model." } }), { status: 400 });
    }) as typeof fetch;
    await expect(startVeoClip(GOOGLE_KEY, { name: "X", age: 30, bio: "", traits: ["a"] }, null, f)).rejects.toThrow(/HTTP 400\): `bogusField` isn't supported/);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].instances[0].image).toBeUndefined();
  });

  it("polls only Google's own operation names, reports filtered clips, and downloads only from Google", async () => {
    stubVeo("filtered");
    expect(await pollVeoClip(GOOGLE_KEY, OP)).toMatchObject({ status: "failed", reason: expect.stringMatching(/safety filters/) });
    expect(await pollVeoClip(GOOGLE_KEY, "../../evil")).toMatchObject({ status: "failed" });
    await expect(downloadVeoClip(GOOGLE_KEY, "https://evil.example/x.mp4")).rejects.toThrow(/Unexpected video host/);
  });
});

describe("the clip paywall: bought tokens, refunded if the clip fails; none for an admin", () => {
  it("needs a Google key", async () => {
    const { cookie, character } = await owner({ key: false, bought: 5 });
    const res = await post(character.id, cookie);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_video_key");
  });

  it("without bought tokens it's a 402 pointing at the shop; the weekly free tokens don't count; nothing starts", async () => {
    const { cookie, character, userId } = await owner();
    expect((await episodeAllowance(t.db, userId)).free_left).toBeGreaterThan(0);
    stubVeo();
    const res = await post(character.id, cookie);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "needs_tokens", shop: "/shop", bought_tokens: 0 });
    expect(await t.count("character_assets")).toBe(0);
  });

  it("spends a bought token, renders, stores the MP4 with us and plays it (with byte ranges for Safari)", async () => {
    const { cookie, character, userId } = await owner({ bought: 5 });
    stubVeo("done");
    const started = await post(character.id, cookie);
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ tokens_spent: CLIP_TOKEN_COST, admin: false });
    expect((await episodeAllowance(t.db, userId)).pack_left).toBe(5 - CLIP_TOKEN_COST);

    const ready = await (await poll(character.id, cookie)).json();
    expect(ready.status).toBe("ready");
    const id = ready.video_path.split("/")[3];
    const full = await videoRoute.GET(new Request(`${BASE_URL}${ready.video_path}`), params(id));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await full.arrayBuffer()).equals(MP4)).toBe(true);
    const part = await videoRoute.GET(new Request(`${BASE_URL}${ready.video_path}`, { headers: { range: "bytes=0-3" } }), params(id));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-3/${MP4.length}`);
    expect(Buffer.from(await part.arrayBuffer()).toString()).toBe("fake");
  });

  it("a clip Google blocks is rejected and its token refunded, exactly once", async () => {
    const { cookie, character, userId } = await owner({ bought: 2 });
    stubVeo("filtered");
    await post(character.id, cookie);
    expect((await episodeAllowance(t.db, userId)).pack_left).toBe(1);
    const failed = await (await poll(character.id, cookie)).json();
    expect(failed).toMatchObject({ status: "failed", refunded: true });
    await poll(character.id, cookie);
    expect((await episodeAllowance(t.db, userId)).pack_left).toBe(2);
  });

  it("an admin pays no tokens (but still uses their own Google key)", async () => {
    const { cookie, character, userId } = await owner();
    const bad = await claimRoute.POST(new Request(`${BASE_URL}/api/admin/claim`, { method: "POST", headers: { cookie, "x-frontier-key": "wrong" } }));
    expect(bad.status).toBe(403);
    const ok = await claimRoute.POST(new Request(`${BASE_URL}/api/admin/claim`, { method: "POST", headers: { cookie, "x-frontier-key": ADMIN_PASSWORD } }));
    expect(ok.status).toBe(200);
    expect(await isAdmin(t.db, userId)).toBe(true);
    stubVeo("done");
    const started = await post(character.id, cookie);
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ tokens_spent: 0, admin: true });
    expect((await episodeAllowance(t.db, userId)).pack_left).toBe(0);
    await claimRoute.DELETE(new Request(`${BASE_URL}/api/admin/claim`, { method: "DELETE", headers: { cookie } }));
    expect(await isAdmin(t.db, userId)).toBe(false);
  });

  it("is owner-only, and a clip left from the Sora era is closed out", async () => {
    const { cookie, character } = await owner({ bought: 1 });
    expect((await post(character.id, newUserCookie())).status).toBe(404);
    await recordAsset(t.db, { character_id: character.id, kind: "clip", source_type: "generated", source_model: "openai:sora-2", source_url: "vid_old" });
    expect((await (await poll(character.id, cookie)).json()).status).toBe("failed");
    // An approved Sora-era clip stored only a still: the video route has nothing to play.
    const old = await recordAsset(t.db, { character_id: character.id, kind: "clip", source_type: "generated", source_model: "openai:sora-2", url: PNG, source_url: "vid_done" });
    await reviewAsset(t.db, old, "approved", "test");
    expect((await videoRoute.GET(new Request(`${BASE_URL}/api/assets/${old}/video`), params(old))).status).toBe(404);
  });
});

describe("the clip button on the card", () => {
  it("shows the token price, or the admin note, and points to adding a Google key", () => {
    const html = (clip: { admin: boolean; boughtTokens: number; hasKey: boolean; cost: number }) =>
      renderToStaticMarkup(createElement(OwnerControls, { id: "c1", name: "Ira Fenn", openToDates: false, clip }));
    const player = html({ admin: false, boughtTokens: 3, hasKey: false, cost: 1 });
    expect(player).toMatch(/<button[^>]*>Generate a 4-second clip<\/button>/);
    expect(player).toContain("1 bought token + ~$0.20 on your Google key; you have 3");
    expect(player).toContain('href="/account"');
    expect(html({ admin: true, boughtTokens: 0, hasKey: true, cost: 1 })).toContain("admin: no tokens");
  });
});
