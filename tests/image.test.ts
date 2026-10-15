import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAsset } from "@/app/api/assets/[id]/route";
import * as videoRoute from "@/app/api/assets/[id]/video/route";
import * as clipRoute from "@/app/api/characters/[id]/clip/route";
import { POST as generateRoute } from "@/app/api/characters/[id]/portrait/route";
import { setDbForTests } from "@/lib/db";
import { generatePortrait, portraitPrompt } from "@/lib/image";
import { saveUserKey } from "@/lib/keys";
import { registerAccount } from "@/lib/auth";
import { BASE_URL, api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

const SECRET = ["img", "test", "secret", "0123456789abcdef"].join("-");
const KEY = ["sk", "img", "ZZZ9zzz9ZZZ9zzz9Face"].join("-"); // built from parts, never a literal secret
// A 1x1 transparent PNG as base64 (the smallest valid image the provider could return).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  setDbForTests(t.db);
  vi.stubEnv("SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const generate = (id: string, cookie: string) =>
  generateRoute(new Request(`${BASE_URL}/api/characters/${id}/portrait`, { method: "POST", headers: { cookie } }), params(id));

describe("the portrait prompt (built only from filtered sheet text)", () => {
  it("names the character, says fictional adult, and keeps it all-audiences", () => {
    const p = portraitPrompt({ name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm", "bold"], appearance: "ink-stained cuffs", pronouns: "she/her" });
    expect(p).toContain("Mira");
    expect(p).toContain("curious, warm, bold");
    expect(p).toContain("ink-stained cuffs");
    expect(p).toMatch(/fictional adult/i);
    expect(p).toMatch(/all audiences/i);
    // An underage age is floored to 18 in the prompt (characters are 18+, but belt and braces).
    expect(portraitPrompt({ name: "X", age: 12, bio: "", traits: ["a", "b", "c"] })).toContain("around 18");
  });
});

describe("generatePortrait (OpenAI image API, injected fetch)", () => {
  it("sends the key to OpenAI and returns a data URL", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> } = { url: "", auth: null, body: {} };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.url = String(url);
      seen.auth = new Headers(init.headers).get("authorization");
      seen.body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
    }) as typeof fetch;
    const out = await generatePortrait(KEY, { name: "Mira", age: 27, bio: "", traits: ["a", "b", "c"] }, "gpt-image-1", fetchImpl);
    expect(seen.url).toContain("api.openai.com/v1/images/generations");
    expect(seen.auth).toBe(`Bearer ${KEY}`);
    expect(seen.body.model).toBe("gpt-image-1");
    expect(out.dataUrl).toBe(`data:image/png;base64,${PNG_B64}`);
  });

  it("surfaces a provider refusal (its own moderation) as an error", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "content_policy_violation" } }), { status: 400 })) as typeof fetch;
    await expect(generatePortrait(KEY, { name: "X", age: 20, bio: "", traits: ["a", "b", "c"] }, "gpt-image-1", fetchImpl)).rejects.toThrow(/blocked this image/);
  });
});

describe("POST /api/characters/[id]/portrait", () => {
  it("is owner-only and needs an image key", async () => {
    const owner = newUserCookie();
    const stranger = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), owner)).json();
    expect((await generate(character.id, stranger)).status).toBe(404); // not the owner
    const noKey = await generate(character.id, owner); // owner, but no image key
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toMatchObject({ error: "no_image_key" });
  });

  it("generates on the owner's key, approves the asset, and serves it", async () => {
    const owner = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), owner)).json();
    // A key belongs to an account (user_keys references accounts); the owner id is the adopted one.
    await registerAccount(t.db, userIdOf(owner), "portraitowner", ["a", "good", "password"].join("-"));
    await saveUserKey(t.db, userIdOf(owner), "openai", "image", KEY, null, { SESSION_SECRET: SECRET });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 }));

    const res = await generate(character.id, owner);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.portrait_path).toBe(`/api/assets/${body.asset_id}`);
    vi.unstubAllGlobals();

    // The asset is recorded as a generated, approved portrait with the provider on it.
    const asset = (await t.db.query<{ source_type: string; review_status: string; source_model: string }>(
      `select source_type, review_status, source_model from character_assets where id = $1`,
      [body.asset_id],
    )).rows[0];
    expect(asset).toMatchObject({ source_type: "generated", review_status: "approved" });
    expect(asset.source_model).toContain("openai");

    // It renders on the public card (getPublicCharacter), and the serving route returns the bytes cached.
    const { getPublicCharacter } = await import("@/lib/game");
    expect((await getPublicCharacter(t.db, character.id))?.portrait_asset_id).toBe(body.asset_id);
    const served = await getAsset(new Request(`${BASE_URL}/api/assets/${body.asset_id}`), params(body.asset_id));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
  });

  it("the serving route never returns a pending (unapproved) asset", async () => {
    const { recordAsset } = await import("@/lib/assets");
    const owner = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), owner)).json();
    const pendingId = await recordAsset(t.db, { character_id: character.id, kind: "portrait", source_type: "generated", source_model: "openai:gpt-image-1", url: `data:image/png;base64,${PNG_B64}` });
    expect((await getAsset(new Request(`${BASE_URL}/api/assets/${pendingId}`), params(pendingId))).status).toBe(404);
  });
});

describe("BYOK video clip (OpenAI Sora on the user's key)", () => {
  const MP4 = Buffer.from("fake-mp4-bytes");
  /** A global fetch stub that answers OpenAI's video endpoints (create / poll / content). */
  function stubVideo(status = "completed") {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/videos") && init?.method === "POST") return new Response(JSON.stringify({ id: "vid_1", status: "queued" }), { status: 200 });
      if (/\/v1\/videos\/vid_1\/content\?variant=thumbnail/.test(u)) return new Response(Buffer.from(PNG_B64, "base64"), { status: 200, headers: { "content-type": "image/png" } });
      if (/\/v1\/videos\/vid_1\/content\?variant=video/.test(u)) return new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } });
      if (/\/v1\/videos\/vid_1/.test(u)) return new Response(JSON.stringify({ status, progress: 100 }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
  }
  const ownerWithKey = async () => {
    const cookie = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), cookie)).json();
    await registerAccount(t.db, userIdOf(cookie), `clipowner${Date.now() % 100000}`, ["a", "good", "password"].join("-"));
    await saveUserKey(t.db, userIdOf(cookie), "openai", "image", KEY, null, { SESSION_SECRET: SECRET });
    return { cookie, character };
  };
  const clipPost = (id: string, cookie: string) =>
    clipRoute.POST(new Request(`${BASE_URL}/api/characters/${id}/clip`, { method: "POST", headers: { cookie } }), params(id));
  const clipGet = (id: string, cookie: string) =>
    clipRoute.GET(new Request(`${BASE_URL}/api/characters/${id}/clip`, { headers: { cookie } }), params(id));

  it("needs an image key and starts a job, then finishes and serves the clip", async () => {
    const { cookie, character } = await ownerWithKey();
    stubVideo("completed");
    const started = await clipPost(character.id, cookie);
    expect(started.status).toBe(202);
    const { asset_id } = await started.json();

    const ready = await (await clipGet(character.id, cookie)).json(); // polls → completed → thumbnail → approved
    expect(ready).toMatchObject({ status: "ready", video_path: `/api/assets/${asset_id}/video` });

    // The poster is durable (served by the image route); the MP4 proxies on the owner's key.
    const poster = await getAsset(new Request(`${BASE_URL}/api/assets/${asset_id}`), params(asset_id));
    expect(poster.headers.get("content-type")).toBe("image/png");
    const video = await videoRoute.GET(new Request(`${BASE_URL}/api/assets/${asset_id}/video`), params(asset_id));
    expect(video.status).toBe(200);
    expect(video.headers.get("content-type")).toBe("video/mp4");
    vi.unstubAllGlobals();
  });

  it("rejects a clip the provider fails, and is owner-only / needs a key", async () => {
    const stranger = newUserCookie();
    const { cookie, character } = await ownerWithKey();
    expect((await clipPost(character.id, stranger)).status).toBe(404); // not the owner
    const noKey = newUserCookie();
    const ownNoKey = await (await api.createCharacter(validCharacter(), noKey)).json();
    expect((await clipPost(ownNoKey.id, noKey)).status).toBe(400); // owner, no key

    stubVideo("failed");
    await clipPost(character.id, cookie);
    const failed = await (await clipGet(character.id, cookie)).json();
    expect(failed.status).toBe("failed");
    vi.unstubAllGlobals();
  });
});
