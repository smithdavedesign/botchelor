import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAsset } from "@/app/api/assets/[id]/route";
import { POST as generateRoute } from "@/app/api/characters/[id]/portrait/route";
import { setDbForTests } from "@/lib/db";
import { generatePortrait, imageModelFor, portraitPrompt } from "@/lib/image";
import { recordAsset, reviewAsset } from "@/lib/assets";
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

  it("any other refusal says OpenAI's own reason (with anything key-shaped scrubbed)", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: `Your organization must be verified to use this model. Key ${["sk", "proj", "abcdefghijkl"].join("-")} lacks access.` } }), { status: 403 })) as typeof fetch;
    const err = await generatePortrait(KEY, { name: "X", age: 20, bio: "", traits: ["a", "b", "c"] }, undefined, fetchImpl).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/OpenAI couldn't make the portrait \(HTTP 403\): Your organization must be verified/);
    expect(String((err as Error).message)).not.toMatch(/sk-proj-abcdefghijkl/);
  });

  it("defaults to gpt-image-2, and a key saved with a retiring model uses it too (gpt-image-1 shuts down 2026-10-23)", async () => {
    let model = "";
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      model = JSON.parse(String(init.body)).model;
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
    }) as typeof fetch;
    await generatePortrait(KEY, { name: "X", age: 20, bio: "", traits: ["a", "b", "c"] }, undefined, fetchImpl);
    expect(model).toBe("gpt-image-2");
    expect(imageModelFor("gpt-image-1")).toBe("gpt-image-2");
    expect(imageModelFor("dall-e-3")).toBe("gpt-image-2");
    expect(imageModelFor(null)).toBe("gpt-image-2");
    expect(imageModelFor("gpt-image-1.5")).toBe("gpt-image-1.5"); // a chosen current model is respected
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

