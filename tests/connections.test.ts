import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAccount } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import {
  assignJob,
  chatBaseUrl,
  checkKey,
  classifyRefusal,
  hasJobKey,
  jobKey,
  listConnections,
  openConnection,
  recordError,
  recordUse,
  removeConnection,
  saveConnection,
  stubOrigin,
  unassignJob,
} from "@/lib/connections";
import {
  ago,
  curatedModels,
  defaultModelFor,
  ERROR_KINDS,
  jobCards,
  keyMeta,
  maskKey,
  plainError,
  PROVIDER_INFO,
  providersFor,
  USER_PROVIDERS,
} from "@/lib/connections-shared";
import { sealKey, sealVersion } from "@/lib/key-crypto";
import { deleteUserKey, listUserKeys, saveUserKey, userImageKey, userTextModel, userVideoKey } from "@/lib/keys";
import { ModelError } from "@/lib/model";
import { startTestDb } from "./helpers";

// Connections (lib/connections.ts, docs/PRDs/connections.md): the store, the free live check against each provider (all
// stubbed: no test reaches a network), errors in plain words, the move from M16's user_keys, and the names the rest of
// the app still calls (lib/keys.ts). Keys and secrets are built from parts and are obviously fake.

const SESSION = ["connections", "test", "session", "words"].join("-");
const KEY_SECRET = ["connections", "test", "key", "encryption", "words"].join("-");
const legacyEnv = { SESSION_SECRET: SESSION };
const v2Env = { SESSION_SECRET: SESSION, KEY_ENCRYPTION_SECRET: KEY_SECRET };
const fakeKey = (tag: string) => ["test", "key", "not", "real", tag, "4321"].join("-");

const A = "aaaa1111-0000-4000-8000-000000000001";
const B = "bbbb2222-0000-4000-8000-000000000002";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from user_keys");
  await t.db.query("delete from accounts");
  await registerAccount(t.db, A, "connector", ["a", "good", "password"].join("-"));
  await registerAccount(t.db, B, "other", ["a", "good", "password"].join("-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Seen = { url: string; headers: Headers }[];
/** A provider stand-in: answers by URL, records each request, and refuses anything it doesn't know (no real network). */
function providers(answer: (url: string, headers: Headers) => Response | Promise<Response>, seen: Seen = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, headers });
    return answer(url, headers);
  }) as typeof fetch;
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the live check (free: each provider's key or model list, never a model call)", () => {
  it("OpenRouter: its key endpoint, with what the key has used and its limit", async () => {
    const seen: Seen = [];
    const key = fakeKey("openrouter");
    const r = await checkKey("openrouter", key, { fetchImpl: providers(() => jsonRes({ data: { usage: 1.2, limit: 10, is_free_tier: false, label: "mine" } }), seen) });
    expect(r).toMatchObject({ ok: true, provider: "openrouter", models: null, account: { usage_usd: 1.2, limit_usd: 10, free_tier: false }, can: ["text"] });
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/key");
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${key}`);
  });

  it("OpenAI: its model list, which says whether the key can make portraits", async () => {
    const key = fakeKey("openai");
    const seen: Seen = [];
    const withImages = await checkKey("openai", key, { fetchImpl: providers(() => jsonRes({ data: [{ id: "gpt-4.1-mini" }, { id: "gpt-image-2" }] }), seen) });
    expect(withImages).toMatchObject({ ok: true, models: ["gpt-4.1-mini", "gpt-image-2"], can: ["text", "image"] });
    expect(seen[0].url).toBe("https://api.openai.com/v1/models");
    const textOnly = await checkKey("openai", key, { fetchImpl: providers(() => jsonRes({ data: [{ id: "gpt-4.1-mini" }] })) });
    expect(textOnly).toMatchObject({ ok: true, can: ["text"] });
  });

  it("Google: the native model list, the key in a header (never the URL), Gemini for dates and Veo for clips", async () => {
    const key = fakeKey("google");
    const seen: Seen = [];
    const r = await checkKey("google", key, {
      fetchImpl: providers(() => jsonRes({ models: [{ name: "models/gemini-3.5-flash-lite" }, { name: "models/veo-3.1-lite-generate-preview" }] }), seen),
    });
    expect(r).toMatchObject({ ok: true, models: ["gemini-3.5-flash-lite", "veo-3.1-lite-generate-preview"], can: ["text", "video"] });
    expect(seen[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(seen[0].url).not.toContain(key);
    expect(seen[0].headers.get("x-goog-api-key")).toBe(key);
  });

  it("Anthropic, DeepSeek and Groq: their model lists, each with its own way of sending the key", async () => {
    const seen: Seen = [];
    const list = providers(() => jsonRes({ data: [{ id: "a-model" }] }), seen);
    expect((await checkKey("anthropic", fakeKey("anthropic"), { fetchImpl: list })).ok).toBe(true);
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(seen[0].headers.get("x-api-key")).toBe(fakeKey("anthropic"));
    expect(seen[0].headers.get("anthropic-version")).toBe("2023-06-01");
    expect((await checkKey("deepseek", fakeKey("deepseek"), { fetchImpl: list })).ok).toBe(true);
    expect(seen[1].url).toBe("https://api.deepseek.com/models");
    expect((await checkKey("groq", fakeKey("groq"), { fetchImpl: list })).ok).toBe(true);
    expect(seen[2].url).toBe("https://api.groq.com/openai/v1/models");
    for (const s of seen.slice(1)) expect(s.headers.get("authorization")).toMatch(/^Bearer test-key-not-real-/);
  });

  it("says each refusal in plain words with its fix, and never echoes the provider's text (or the key in it)", async () => {
    const key = fakeKey("refused");
    const cases: [string, number, unknown, string, RegExp, string | null][] = [
      ["openrouter", 401, { error: { message: `No auth credentials found for ${key}` } }, "invalid_key", /^OpenRouter didn't accept this key\.$/, PROVIDER_INFO.openrouter.keysUrl],
      ["openrouter", 402, { error: { message: "Insufficient credits" } }, "no_credit", /^OpenRouter: out of credit\.$/, PROVIDER_INFO.openrouter.billingUrl],
      ["openai", 429, { error: { code: "insufficient_quota", message: `You exceeded your quota, key ${key}` } }, "no_credit", /^OpenAI: out of credit\.$/, PROVIDER_INFO.openai.billingUrl],
      ["openai", 429, { error: { message: "Rate limit reached" } }, "rate_limited", /^OpenAI is limiting this key/, PROVIDER_INFO.openai.billingUrl],
      ["anthropic", 400, { error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, "no_credit", /^Anthropic: out of credit\.$/, PROVIDER_INFO.anthropic.billingUrl],
      ["google", 400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }, "invalid_key", /^Google didn't accept/, PROVIDER_INFO.google.keysUrl],
      ["google", 429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }, "rate_limited", /^Google is limiting this key/, PROVIDER_INFO.google.billingUrl],
      ["deepseek", 402, { error: { message: "Insufficient Balance" } }, "no_credit", /^DeepSeek: out of credit\.$/, PROVIDER_INFO.deepseek.billingUrl],
      ["groq", 503, { error: { message: "Service Unavailable" } }, "provider_down", /^Groq is having trouble right now\.$/, null],
    ];
    for (const [provider, status, body, kind, message, href] of cases) {
      const r = await checkKey(provider, key, { fetchImpl: providers(() => jsonRes(body, status)) });
      expect(r.ok, `${provider} ${status}`).toBe(false);
      if (r.ok) continue;
      expect(r.error.kind, `${provider} ${status}`).toBe(kind);
      expect(r.error.message).toMatch(message);
      expect(r.error.fix?.href ?? null).toBe(href);
      expect(JSON.stringify(r)).not.toContain(key);
      // The provider's own words stay out.
      expect(JSON.stringify(r)).not.toMatch(/No auth credentials|exceeded your quota|Rate limit reached|credit balance is too low|INVALID_ARGUMENT|Quota exceeded|Insufficient|Service Unavailable/);
    }
  });

  it("no answer: a network error is 'couldn't reach', a timeout is the provider having trouble", async () => {
    const key = fakeKey("silent");
    const network = await checkKey("openai", key, { fetchImpl: (async () => Promise.reject(new TypeError(`fetch failed for ${key}`))) as typeof fetch });
    expect(network).toMatchObject({ ok: false, error: { kind: "unreachable", message: "Couldn't reach OpenAI." } });
    const timedOut = await checkKey("openai", key, {
      fetchImpl: (async () => Promise.reject(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }))) as typeof fetch,
    });
    expect(timedOut).toMatchObject({ ok: false, error: { kind: "provider_down" } });
    expect(JSON.stringify([network, timedOut])).not.toContain(key);
  });

  it("refuses a provider it doesn't know without sending the key anywhere", async () => {
    const seen: Seen = [];
    const r = await checkKey("evil-endpoint", fakeKey("evil"), { fetchImpl: providers(() => jsonRes({}), seen) });
    expect(r.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("points at a loopback stub only for screenshot runs: http on 127.0.0.1 or localhost, and never on Vercel", async () => {
    expect(stubOrigin({ BYOK_STUB_ORIGIN: "http://127.0.0.1:4567" })).toBe("http://127.0.0.1:4567");
    expect(stubOrigin({ BYOK_STUB_ORIGIN: "http://localhost:4567/x" })).toBe("http://localhost:4567");
    expect(stubOrigin({ BYOK_STUB_ORIGIN: "https://attacker.example" })).toBeNull();
    expect(stubOrigin({ BYOK_STUB_ORIGIN: "http://10.0.0.5:80" })).toBeNull();
    expect(stubOrigin({ BYOK_STUB_ORIGIN: "http://127.0.0.1:4567", VERCEL: "1" })).toBeNull();
    expect(chatBaseUrl("openrouter", { BYOK_STUB_ORIGIN: "http://127.0.0.1:4567" })).toBe("http://127.0.0.1:4567/openrouter/api/v1");
    expect(chatBaseUrl("openrouter", {})).toBe("https://openrouter.ai/api/v1");
    const seen: Seen = [];
    await checkKey("openai", fakeKey("stub"), { env: { BYOK_STUB_ORIGIN: "http://127.0.0.1:4567" }, fetchImpl: providers(() => jsonRes({ data: [] }), seen) });
    expect(seen[0].url).toBe("http://127.0.0.1:4567/openai/v1/models");
  });
});

describe("sorting refusals (classifyRefusal)", () => {
  it("reads the status first, then the body's words where a status doesn't tell them apart", () => {
    expect(classifyRefusal(401, "")).toBe("invalid_key");
    expect(classifyRefusal(403, "")).toBe("invalid_key");
    expect(classifyRefusal(403, '{"error":"billing hard limit reached"}')).toBe("no_credit");
    expect(classifyRefusal(402, "")).toBe("no_credit");
    expect(classifyRefusal(429, "")).toBe("rate_limited");
    expect(classifyRefusal(429, '{"error":{"code":"insufficient_quota"}}')).toBe("no_credit");
    expect(classifyRefusal(400, "Invalid x-api-key")).toBe("invalid_key");
    expect(classifyRefusal(400, "model `nope` does not exist")).toBe("model_unavailable");
    expect(classifyRefusal(404, "The model gpt-x was not found")).toBe("model_unavailable");
    expect(classifyRefusal(404, "")).toBe("unknown");
    expect(classifyRefusal(500, "")).toBe("provider_down");
    expect(classifyRefusal(529, "overloaded")).toBe("provider_down");
    expect(classifyRefusal(418, "")).toBe("unknown");
  });
});

describe("errors in plain words (plainError)", () => {
  it("has a message and a fix for every kind, naming the provider, with its own site's link where there is one", () => {
    for (const kind of ERROR_KINDS) {
      const e = plainError("openrouter", kind, { model: "some/model" });
      expect(e.kind).toBe(kind);
      expect(e.message.length).toBeGreaterThan(10);
      expect(e.fix?.label.length ?? 0).toBeGreaterThan(3);
    }
    expect(plainError("openrouter", "no_credit")).toEqual({ kind: "no_credit", message: "OpenRouter: out of credit.", fix: { label: "Top up", href: "https://openrouter.ai/settings/credits" } });
    expect(plainError("openai", "model_unavailable", { model: "gpt-x" }).message).toBe("OpenAI doesn't offer gpt-x on this key.");
    expect(plainError("hive", "invalid_key").fix?.href).toBeNull(); // not a provider a person connects: no link to guess
    expect(plainError("venice", "invalid_key").fix?.href).toBe("https://venice.ai/settings/api"); // the Studio's own-key job
  });
});

describe("the shared pieces the page uses", () => {
  it("masks a key to its last four, and says how long ago things were", () => {
    expect(maskKey("abcd")).toBe("•••• abcd");
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(ago("2026-10-23T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-23T11:58:00Z", now)).toBe("2 min ago");
    expect(ago("2026-10-23T09:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-10-22T09:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-10-12T09:00:00Z", now)).toBe("Oct 12");
    expect(keyMeta({ last4: "wxyz", verified_at: "2026-10-23T11:58:00Z", last_used_at: null, last_error: null }, now)).toEqual(["•••• wxyz", "checked 2 min ago", "not used yet"]);
    // Something went wrong after its last good check: the line says when it failed, not when it was checked.
    const failed = { last4: "wxyz", verified_at: "2026-10-23T09:00:00Z", last_used_at: "2026-10-23T10:00:00Z", last_error: plainError("openrouter", "no_credit"), last_error_at: "2026-10-23T11:00:00Z" };
    expect(keyMeta(failed, now)).toEqual(["•••• wxyz", "failed 1 hour ago", "last used 2 hours ago"]);
    expect(keyMeta({ ...failed, verified_at: "2026-10-23T11:30:00Z" }, now)[1]).toBe("checked 30 min ago"); // checked fine since
  });

  it("offers each job only the providers that can do it, with a recommended model", () => {
    expect(providersFor("text")).toEqual(USER_PROVIDERS.filter((p) => p !== "venice" && p !== "replicate"));
    expect(providersFor("after_dark")).toEqual(["venice", "replicate"]);
    expect(defaultModelFor("venice", "after_dark")).toBe("qwen-edit-uncensored");
    expect(providersFor("image")).toEqual(["openai"]);
    expect(providersFor("video")).toEqual(["google"]);
    expect(defaultModelFor("openrouter", "text")).toBe("openai/gpt-4.1-mini");
    expect(defaultModelFor("openai", "image")).toBe("gpt-image-2");
    expect(defaultModelFor("google", "video")).toBe("veo-3.1-lite-generate-preview");
    expect(defaultModelFor("anthropic", "image")).toBeNull();
    expect(curatedModels("openai", "text").filter((m) => m.recommended)).toHaveLength(1);
  });

  it("builds each job's card: the free model, a working key, a key that needs attention", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const none = jobCards({ connections: [], jobs: [] }, now);
    expect(none.map((c) => [c.job, c.state, c.pill, c.status])).toEqual([
      ["text", "unset", "Free model", "Using: Botchelor's free model"],
      ["image", "unset", "Not set up", "Not set up: portraits need your own OpenAI key."],
      ["video", "unset", "Not set up", "Not set up: clips need your own Google key, with billing on."],
      ["after_dark", "unset", "For tokens", "Using: Botchelor's models, for tokens"],
    ]);
    const conn = { provider: "openrouter", last4: "abcd", verified_at: "2026-10-23T11:58:00Z", last_used_at: "2026-10-23T11:00:00Z", last_error: null, created_at: "2026-10-20T00:00:00Z", jobs: ["text" as const] };
    const ok = jobCards({ connections: [conn], jobs: [{ job: "text", provider: "openrouter", model: "deepseek/deepseek-chat-v3.1" }] }, now)[0];
    expect(ok).toMatchObject({
      state: "connected",
      pill: "✓ Connected",
      status: "Your OpenRouter key ✓ · deepseek/deepseek-chat-v3.1 · Lively",
      meta: ["•••• abcd", "checked 2 min ago", "last used 1 hour ago", "$0 this month"],
    });
    // A failed key on Dates & texts: Botchelor's free model stands in (M3's default), and the card says so.
    const broken = jobCards({ connections: [{ ...conn, last_error: plainError("openrouter", "no_credit") }], jobs: [{ job: "text", provider: "openrouter", model: null }] }, now)[0];
    expect(broken).toMatchObject({
      state: "fallback",
      pill: "On the free model",
      status: "Your OpenRouter key failed, so Botchelor's free model stands in · openai/gpt-4.1-mini · Lively",
      error: { message: "OpenRouter: out of credit." },
    });
    // One whose owner chose to pause instead needs attention.
    const paused = jobCards({ connections: [{ ...conn, last_error: plainError("openrouter", "no_credit") }], jobs: [{ job: "text", provider: "openrouter", model: null, on_cap: "pause" }] }, now)[0];
    expect(paused).toMatchObject({ state: "error", pill: "Needs attention", status: "Your OpenRouter key · openai/gpt-4.1-mini · Lively" });
    // An OpenAI key for dates is offered to Portraits, which has no key yet.
    const openai = { ...conn, provider: "openai" };
    expect(jobCards({ connections: [openai], jobs: [{ job: "text", provider: "openai", model: null }] }, now)[1].reusable).toEqual([{ provider: "openai", label: "OpenAI", last4: "abcd" }]);
  });
});

describe("the store", () => {
  it("seals a key, and lists only its last four and its status (never the key, never the ciphertext)", async () => {
    vi.stubEnv("SESSION_SECRET", SESSION);
    const key = fakeKey("stored");
    await saveConnection(t.db, A, "openrouter", key, { verifiedAt: "2026-10-23T11:58:00.000Z", env: legacyEnv });
    await assignJob(t.db, A, "text", "openrouter", "deepseek/deepseek-chat-v3.1");
    const row = (await t.db.query<{ ciphertext: string; nonce: string; last4: string }>(`select ciphertext, nonce, last4 from user_connections where user_id = $1`, [A])).rows[0];
    expect(row.ciphertext).not.toContain(key);
    expect(row.nonce).not.toContain(key);
    expect(row.last4).toBe("4321");
    const listed = await listConnections(t.db, A);
    expect(JSON.stringify(listed)).not.toContain(key);
    expect(JSON.stringify(listed)).not.toContain(row.ciphertext);
    expect(listed.connections[0]).toMatchObject({ provider: "openrouter", last4: "4321", sealed: "legacy", verified_at: "2026-10-23T11:58:00.000Z", jobs: ["text"] });
    expect(listed.jobs).toEqual([
      {
        job: "text",
        provider: "openrouter",
        model: "deepseek/deepseek-chat-v3.1",
        updated_at: expect.any(String),
        preset: null,
        temperature: null,
        frequency_penalty: null,
        presence_penalty: null,
        cap_usd: null,
        on_cap: null,
      },
    ]);
    expect(await jobKey(t.db, A, "text", legacyEnv)).toEqual({
      provider: "openrouter",
      apiKey: key,
      model: "deepseek/deepseek-chat-v3.1",
      feel: { preset: null, temperature: null, frequency_penalty: null, presence_penalty: null },
      cap: { cap_usd: null, on_cap: "fallback" }, // no cap; the free model stands in by default (M3)
    });
    expect(await hasJobKey(t.db, A, "text")).toBe(true);
    expect(await hasJobKey(t.db, A, "image")).toBe(false);
    expect(await hasJobKey(t.db, null, "text")).toBe(false);
  });

  it("one key, several jobs: unassigning one keeps the others; removing the key ends them all", async () => {
    await saveConnection(t.db, A, "google", fakeKey("google"), { env: legacyEnv });
    await assignJob(t.db, A, "text", "google", null);
    await assignJob(t.db, A, "video", "google", null);
    expect(await unassignJob(t.db, A, "text")).toBe(true);
    expect(await jobKey(t.db, A, "video", legacyEnv)).toMatchObject({ provider: "google", model: "veo-3.1-lite-generate-preview" });
    expect(await removeConnection(t.db, A, "google")).toBe(true);
    expect((await listConnections(t.db, A)).jobs).toEqual([]);
    expect(await jobKey(t.db, A, "video", legacyEnv)).toBeNull();
  });

  it("a job can't point at a key that isn't stored", async () => {
    await expect(assignJob(t.db, A, "text", "openai", null)).rejects.toThrow();
  });

  it("replacing a key starts it on a clean slate, and each person's keys are their own", async () => {
    await saveConnection(t.db, A, "openai", fakeKey("first"), { env: legacyEnv });
    await recordError(t.db, A, "openai", "invalid_key");
    await saveConnection(t.db, A, "openai", ["test", "key", "not", "real", "second", "8765"].join("-"), { env: legacyEnv });
    const c = (await listConnections(t.db, A)).connections[0];
    expect(c).toMatchObject({ last4: "8765", last_error: null, last_used_at: null });
    expect((await listConnections(t.db, B)).connections).toEqual([]);
    expect(await openConnection(t.db, B, "openai", legacyEnv)).toBeNull();
  });

  it("records use (clearing an old error) and errors in plain words for the card", async () => {
    await saveConnection(t.db, A, "openrouter", fakeKey("status"), { env: legacyEnv });
    await recordError(t.db, A, "openrouter", "no_credit");
    expect((await listConnections(t.db, A)).connections[0].last_error).toEqual(plainError("openrouter", "no_credit"));
    await recordUse(t.db, A, "openrouter");
    const c = (await listConnections(t.db, A)).connections[0];
    expect(c.last_error).toBeNull();
    expect(c.last_used_at).not.toBeNull();
  });

  it("seals new keys under KEY_ENCRYPTION_SECRET once it's set, and moves a legacy one to v2 when it's read", async () => {
    const key = fakeKey("moving");
    await saveConnection(t.db, A, "openrouter", key, { env: legacyEnv });
    await assignJob(t.db, A, "text", "openrouter", null);
    expect((await listConnections(t.db, A)).connections[0].sealed).toBe("legacy");
    // The secret is added: the next read opens it the legacy way and seals it again as v2, in place.
    expect((await jobKey(t.db, A, "text", v2Env))?.apiKey).toBe(key);
    const row = (await t.db.query<{ ciphertext: string }>(`select ciphertext from user_connections where user_id = $1`, [A])).rows[0];
    expect(sealVersion(row)).toBe("v2");
    expect(row.ciphertext).not.toContain(key);
    // From then on SESSION_SECRET can be rotated without losing it.
    expect((await jobKey(t.db, A, "text", { SESSION_SECRET: ["rotated", "session", "words"].join("-"), KEY_ENCRYPTION_SECRET: KEY_SECRET }))?.apiKey).toBe(key);
    // And a key saved now is v2 from the start.
    await saveConnection(t.db, B, "openai", fakeKey("fresh"), { env: v2Env });
    expect((await listConnections(t.db, B)).connections[0].sealed).toBe("v2");
  });

  it("a key that can't be opened any more (the secret changed) shows on its card as needing to be pasted again", async () => {
    await saveConnection(t.db, A, "openrouter", fakeKey("lost"), { env: legacyEnv });
    await assignJob(t.db, A, "text", "openrouter", null);
    expect(await jobKey(t.db, A, "text", { SESSION_SECRET: ["a", "different", "session", "words"].join("-") })).toBeNull();
    const card = jobCards(await listConnections(t.db, A))[0];
    expect(card.state).toBe("fallback"); // the free model stands in for dates meanwhile (M3)
    expect(card.error?.kind).toBe("unreadable");
    expect(card.error?.fix?.label).toBe("Paste it again");
  });
});

describe("moving M16's user_keys in (lib/db.ts, once)", () => {
  /** A user_keys row exactly as M16 wrote it: sealed from SESSION_SECRET, no prefix, no associated data. */
  async function legacyRow(userId: string, provider: string, kind: "text" | "image", key: string, model: string | null = null) {
    const s = sealKey(key, "", legacyEnv);
    await t.db.query(`insert into user_keys (user_id, provider, kind, ciphertext, nonce, last4, model) values ($1, $2, $3, $4, $5, $6, $7)`, [
      userId,
      provider,
      kind,
      s.ciphertext,
      s.nonce,
      key.slice(-4),
      model,
    ]);
  }

  it("moves each key to a connection with the jobs it did, pins an unchosen model, and empties user_keys", async () => {
    const dates = fakeKey("dates");
    const clips = fakeKey("dates"); // the same key in both of Google's slots, as production had
    const portraits = fakeKey("portraits");
    await legacyRow(A, "google", "text", dates);
    await legacyRow(A, "google", "image", clips);
    await legacyRow(A, "openai", "image", portraits);
    await legacyRow(B, "openrouter", "text", fakeKey("chosen"), "anthropic/claude-haiku-5-5");
    await legacyRow(B, "fal", "image", fakeKey("fal"));
    await ensureSchema(t.db);

    expect((await t.db.query(`select 1 from user_keys`)).rows).toHaveLength(0);
    const a = await listConnections(t.db, A);
    expect(a.connections.map((c) => c.provider).sort()).toEqual(["google", "openai"]);
    expect(a.jobs.map((j) => [j.job, j.provider, j.model]).sort()).toEqual([
      ["image", "openai", null],
      ["text", "google", "gemini-3.5-flash-lite"], // pinned to the default it ran on
      ["video", "google", null],
    ]);
    const b = await listConnections(t.db, B);
    expect(b.jobs.map((j) => [j.job, j.provider, j.model])).toEqual([["text", "openrouter", "anthropic/claude-haiku-5-5"]]);
    expect(b.connections.find((c) => c.provider === "fal")?.jobs).toEqual([]); // stored, not wired to anything
    // Each moved key still opens, as the same key.
    expect((await jobKey(t.db, A, "text", legacyEnv))?.apiKey).toBe(dates);
    expect((await jobKey(t.db, A, "video", legacyEnv))?.apiKey).toBe(dates);
    expect((await jobKey(t.db, A, "image", legacyEnv))?.apiKey).toBe(portraits);
  });

  it("never brings back a key removed after the move, on a later schema change", async () => {
    await legacyRow(A, "openai", "text", fakeKey("gone"));
    await ensureSchema(t.db);
    expect(await removeConnection(t.db, A, "openai")).toBe(true);
    await ensureSchema(t.db);
    expect((await listConnections(t.db, A)).connections).toEqual([]);
  });
});

describe("the names the app still calls (lib/keys.ts) on the new store", () => {
  it("saveUserKey points the slot's job at the key; a Google dates key covers clips too", async () => {
    await saveUserKey(t.db, A, "google", "text", fakeKey("g"), null, legacyEnv);
    expect((await listConnections(t.db, A)).jobs.map((j) => j.job).sort()).toEqual(["text", "video"]);
    expect(await userVideoKey(t.db, A, legacyEnv)).toBe(fakeKey("g"));
    await saveUserKey(t.db, A, "openai", "image", fakeKey("img"), null, legacyEnv);
    expect(await userImageKey(t.db, A, legacyEnv)).toEqual({ provider: "openai", apiKey: fakeKey("img"), model: "gpt-image-2" }); // the job's default
  });

  it("deleteUserKey takes the key out of a slot, and deletes it once nothing uses it", async () => {
    await saveUserKey(t.db, A, "openai", "text", fakeKey("o"), null, legacyEnv);
    await assignJob(t.db, A, "image", "openai", null);
    expect(await deleteUserKey(t.db, A, "openai", "image")).toBe(true);
    expect((await listConnections(t.db, A)).connections).toHaveLength(1); // still runs dates
    expect(await deleteUserKey(t.db, A, "openai", "text")).toBe(true);
    expect((await listConnections(t.db, A)).connections).toHaveLength(0);
    expect(await deleteUserKey(t.db, A, "openai", "text")).toBe(false);
    expect(await listUserKeys(t.db, A)).toEqual([]);
  });

  it("a person's text model records when it worked, and what went wrong in plain words, never echoing the key", async () => {
    const key = fakeKey("model");
    await saveUserKey(t.db, A, "openrouter", "text", key, "openai/gpt-4.1-mini", legacyEnv);
    vi.stubGlobal(
      "fetch",
      providers((url, headers) => {
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(headers.get("authorization")).toBe(`Bearer ${key}`);
        return jsonRes({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
      }),
    );
    const model = (await userTextModel(t.db, A, undefined, legacyEnv))!;
    await model.complete([{ role: "user", content: "hi" }]);
    expect((await listConnections(t.db, A)).connections[0].last_used_at).not.toBeNull();

    // The provider turns it down, quoting the key back: the card says why in plain words, and the error carries no key.
    vi.stubGlobal("fetch", providers(() => jsonRes({ error: { message: `Invalid key ${key}` } }, 401)));
    const again = (await userTextModel(t.db, A, undefined, legacyEnv))!;
    const err = await again.complete([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).status).toBe(401);
    expect((err as Error).message).not.toContain(key);
    expect((await listConnections(t.db, A)).connections[0].last_error).toEqual(plainError("openrouter", "invalid_key"));
  });
});
