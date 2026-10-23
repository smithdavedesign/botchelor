import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteConnection, GET as getConnections, PUT as putConnection } from "@/app/api/me/connections/route";
import { POST as postCheck } from "@/app/api/me/connections/check/route";
import { GET as getKeyStore, POST as postReseal } from "@/app/api/admin/keys/route";
import { registerAccount } from "@/lib/auth";
import { claimAdmin } from "@/lib/admins";
import { houseProviderStatus } from "@/lib/adult/provider-status";
import { adultKeys, saveAdultSettings } from "@/lib/adult/settings";
import { listConnections, saveConnection, assignJob } from "@/lib/connections";
import { sealVersion } from "@/lib/key-crypto";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// The Connections routes (app/api/me/connections, docs/PRDs/connections.md "API"): signed-in accounts only, the key
// write-only (checked live, sealed, never returned), every error in plain words that never echo it; the admin's stored-keys
// route; and After Dark's providers at a glance. Providers are stubbed: nothing here reaches a network.

const KEY_SECRET = ["routes", "test", "key", "encryption", "secret", "gggg7777"].join("-");
const fakeKey = (tag: string) => ["test", "key", "not", "real", tag, "5678"].join("-");
const ADMIN_PASSWORD = ["routes", "admin", "password", "hhhh8888"].join("-");
const U = "cccc3333-0000-4000-8000-000000000003";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
let cookie = "";
const logs: string[] = [];
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from accounts");
  await t.db.query("delete from admins");
  resetRateLimitsForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", ADMIN_PASSWORD);
  await registerAccount(t.db, U, "keyholder", ["a", "good", "password"].join("-"));
  cookie = signedInCookie(U);
  logs.length = 0;
  for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Every provider answers by `answer`; the requests are recorded. Anything else would be a real network call: refused. */
function stubProviders(answer: (url: string, headers: Headers) => Response) {
  const seen: { url: string; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, headers });
    return answer(url, headers);
  });
  return seen;
}
const ok = () => stubProviders((url) => (url.includes("openrouter.ai") ? jsonRes({ data: { usage: 0.5, limit: 10 } }) : url.includes("googleapis") ? jsonRes({ models: [{ name: "models/gemini-3.5-flash-lite" }, { name: "models/veo-3.1-lite-generate-preview" }] }) : jsonRes({ data: [{ id: "gpt-4.1-mini" }, { id: "gpt-image-2" }] })));

const req = (method: string, path: string, body?: unknown, c: string | null = cookie) =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const put = (body: unknown, c?: string | null) => putConnection(req("PUT", "/api/me/connections", body, c));
const del = (body: unknown, c?: string | null) => deleteConnection(req("DELETE", "/api/me/connections", body, c));
const check = (body: unknown, c?: string | null) => postCheck(req("POST", "/api/me/connections/check", body, c));
const get = (c?: string | null) => getConnections(new Request(BASE_URL + "/api/me/connections", { headers: c ? { cookie: c } : {} }));

describe("who may use the Connections routes", () => {
  it("a signed-in account only: signed out, or an anonymous cookie, gets 401", async () => {
    ok();
    for (const c of [null, newUserCookie(), `bz_uid=${U}`]) {
      expect((await get(c)).status).toBe(401);
      expect((await put({ job: "text", provider: "openrouter", key: fakeKey("anon") }, c)).status).toBe(401);
      expect((await check({ provider: "openrouter", key: fakeKey("anon") }, c)).status).toBe(401);
      expect((await del({ provider: "openrouter" }, c)).status).toBe(401);
    }
    expect(await t.count("user_connections" as never)).toBe(0);
  });

  it("is unavailable (503), not a crash, on a deployment that can't seal keys", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect((await get(cookie)).status).toBe(503);
    expect((await put({ job: "text", provider: "openrouter", key: fakeKey("x") })).status).toBe(503);
  });
});

describe("connecting a key (PUT)", () => {
  it("checks it live, stores it sealed, points the job at it, and never sends it back", async () => {
    const seen = ok();
    const key = fakeKey("connect");
    const res = await put({ job: "text", provider: "openrouter", key, model: "deepseek/deepseek-chat-v3.1" });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(key);
    const body = JSON.parse(text);
    expect(body.cards[0]).toMatchObject({ job: "text", state: "connected", status: "Your OpenRouter key ✓ · deepseek/deepseek-chat-v3.1", meta: ["•••• 5678", "checked just now", "not used yet"] });
    expect(body.connections).toEqual([expect.objectContaining({ provider: "openrouter", last4: "5678", jobs: ["text"] })]);
    expect(body.connections[0]).not.toHaveProperty("ciphertext");
    expect(seen.map((s) => s.url)).toEqual(["https://openrouter.ai/api/v1/key"]); // one free check, no model call
    const row = (await t.db.query<{ ciphertext: string; verified_at: Date | null }>(`select ciphertext, verified_at from user_connections where user_id = $1`, [U])).rows[0];
    expect(row.ciphertext).not.toContain(key);
    expect(row.verified_at).not.toBeNull();
    expect(JSON.stringify(await (await get(cookie)).json())).not.toContain(key);
    expect(logs.join("\n")).not.toContain(key);
  });

  it("stores nothing when the check fails, and says why in plain words with the fix, without the key", async () => {
    const key = fakeKey("broke");
    stubProviders(() => jsonRes({ error: { message: `Insufficient credits on ${key}` } }, 402));
    const res = await put({ job: "text", provider: "openrouter", key });
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(JSON.parse(text)).toEqual({ error: "key_check_failed", message: "OpenRouter: out of credit.", kind: "no_credit", fix: { label: "Top up", href: "https://openrouter.ai/settings/credits" } });
    expect(text).not.toContain(key);
    expect((await listConnections(t.db, U)).connections).toEqual([]);
    expect(logs.join("\n")).not.toContain(key);
  });

  it("validates without echoing: an unknown provider, one that can't do the job, a bad paste, a bad model id", async () => {
    ok();
    const key = fakeKey("valid");
    const cases: [unknown, string][] = [
      [{ job: "text", provider: "evil-endpoint", key }, "unknown_provider"],
      [{ job: "image", provider: "anthropic", key }, "wrong_provider"],
      [{ job: "video", provider: "openai", key }, "wrong_provider"],
      [{ job: "text", provider: "openai", key: `${key} ${key}` }, "invalid_connection"],
      [{ job: "text", provider: "openai", key: "short" }, "invalid_connection"],
      [{ job: "text", provider: "openai", key, model: "../../etc/passwd; drop" }, "invalid_connection"],
      [{ job: "dancing", provider: "openai", key }, "invalid_connection"],
    ];
    for (const [body, error] of cases) {
      const res = await put(body);
      const text = await res.text();
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
      expect(JSON.parse(text).error).toBe(error);
      expect(text).not.toContain(key);
    }
    expect(await t.count("user_connections" as never)).toBe(0);
  });

  it("reuses a key already stored for another job, and needs one when there isn't", async () => {
    ok();
    expect((await put({ job: "image", provider: "openai" })).status).toBe(422);
    expect((await put({ job: "text", provider: "openai", key: fakeKey("shared") })).status).toBe(200);
    const res = await put({ job: "image", provider: "openai" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards.map((c: { job: string; state: string }) => [c.job, c.state])).toEqual([
      ["text", "connected"],
      ["image", "connected"],
      ["video", "unset"],
    ]);
  });

  it("does other jobs too when asked (a Google key for dates and clips), and replaces a key in place", async () => {
    ok();
    expect((await put({ job: "text", provider: "google", key: fakeKey("both"), also: ["video"] })).status).toBe(200);
    expect((await listConnections(t.db, U)).jobs.map((j) => j.job).sort()).toEqual(["text", "video"]);
    const res = await put({ provider: "google", key: ["test", "key", "not", "real", "newer", "0042"].join("-") });
    expect(res.status).toBe(200);
    const listing = await listConnections(t.db, U);
    expect(listing.connections[0].last4).toBe("0042");
    expect(listing.jobs.map((j) => j.job).sort()).toEqual(["text", "video"]); // what it does is kept
    expect((await put({ provider: "google" })).status).toBe(422); // a replace needs the new key
  });
});

describe("checking a key (POST /check)", () => {
  it("tries a pasted key without storing it, and checks a stored one again, updating its card", async () => {
    ok();
    const key = fakeKey("trial");
    const tried = await check({ provider: "openai", key });
    const text = await tried.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, models_count: 2, can: ["text", "image"] });
    expect(text).not.toContain(key);
    expect(await t.count("user_connections" as never)).toBe(0);

    await put({ job: "text", provider: "openai", key });
    await t.db.query(`update user_connections set verified_at = now() - interval '3 days' where user_id = $1`, [U]);
    expect((await (await check({ provider: "openai" })).json()).ok).toBe(true);
    expect((await listConnections(t.db, U)).connections[0].verified_at! > new Date(Date.now() - 60_000).toISOString()).toBe(true);
  });

  it("a stored key that fails its check shows on its card in plain words; no stored key is a 404", async () => {
    ok();
    const key = fakeKey("revoked");
    await put({ job: "text", provider: "openai", key });
    stubProviders(() => jsonRes({ error: { message: `Incorrect API key provided: ${key}` } }, 401));
    const res = await check({ provider: "openai" });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: { kind: "invalid_key", message: "OpenAI didn't accept this key.", fix: { label: "Check you copied all of it, or make a new key", href: "https://platform.openai.com/api-keys" } } });
    expect(text).not.toContain(key);
    expect((await listConnections(t.db, U)).connections[0].last_error?.kind).toBe("invalid_key");
    expect((await check({ provider: "groq" })).status).toBe(404);
  });

  it("is limited, so the show can't be used to test keys that aren't yours", async () => {
    ok();
    let last = 0;
    for (let i = 0; i < 13; i++) last = (await check({ provider: "openai", key: fakeKey(`n${i}`) })).status;
    expect(last).toBe(429);
  });
});

describe("removing (DELETE)", () => {
  it("stops one job using its key, or removes the key and every job using it", async () => {
    ok();
    await put({ job: "text", provider: "google", key: fakeKey("rm"), also: ["video"] });
    const stop = await del({ job: "text" });
    expect((await stop.json()).removed).toBe(true);
    expect((await listConnections(t.db, U)).jobs.map((j) => j.job)).toEqual(["video"]);
    const gone = await del({ provider: "google" });
    expect((await gone.json()).removed).toBe(true);
    expect(await listConnections(t.db, U)).toEqual({ connections: [], jobs: [] });
    expect((await del({ nothing: true })).status).toBe(422);
  });
});

describe("the admin's stored keys (GET/POST /api/admin/keys)", () => {
  const admin = (method: string) => new Request(BASE_URL + "/api/admin/keys", { method, headers: { "x-frontier-key": ADMIN_PASSWORD } });

  it("needs the admin password or a signed-in admin, and shows counts, never a key", async () => {
    expect((await getKeyStore(new Request(BASE_URL + "/api/admin/keys", { headers: { cookie } }))).status).toBe(403);
    await claimAdmin(t.db, U);
    expect((await getKeyStore(new Request(BASE_URL + "/api/admin/keys", { headers: { cookie } }))).status).toBe(200);
    const key = fakeKey("counted");
    await saveConnection(t.db, U, "openrouter", key);
    const text = await (await getKeyStore(admin("GET"))).text();
    expect(JSON.parse(text)).toEqual({ secret: "off", writes: "legacy", people: { v2: 0, legacy: 1 }, house: { v2: 0, legacy: 0 } });
    expect(text).not.toContain(key);
  });

  it("refuses to reseal before KEY_ENCRYPTION_SECRET is set, then moves every legacy key, people's and the house's", async () => {
    const mine = fakeKey("mine");
    const house = fakeKey("house");
    await saveConnection(t.db, U, "openrouter", mine);
    await assignJob(t.db, U, "text", "openrouter", null);
    await saveAdultSettings(t.db, { openrouter_key: house, hive_key: fakeKey("hive") });
    expect((await postReseal(admin("POST"))).status).toBe(409);

    vi.stubEnv("KEY_ENCRYPTION_SECRET", KEY_SECRET);
    const res = await postReseal(admin("POST"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ moved: { people: 1, house: 2, unreadable: 0 }, status: { secret: "on", writes: "v2", people: { v2: 1, legacy: 0 }, house: { v2: 2, legacy: 0 } } });
    expect(text).not.toContain(mine);
    expect(text).not.toContain(house);
    // Both still open, now without SESSION_SECRET's help.
    vi.stubEnv("SESSION_SECRET", ["a", "rotated", "session", "secret", "iiii9999"].join("-"));
    expect((await adultKeys(t.db)).openrouter).toBe(house);
    const row = (await t.db.query<{ ciphertext: string }>(`select ciphertext from user_connections where user_id = $1`, [U])).rows[0];
    expect(sealVersion(row)).toBe("v2");
  });
});

describe("After Dark's providers at a glance (lib/adult/provider-status.ts)", () => {
  it("one card per house provider: its key's last four, what it does, and its live status from the cooldowns", async () => {
    await saveAdultSettings(t.db, { openrouter_key: fakeKey("or"), venice_key: fakeKey("ve"), hive_key: fakeKey("hv"), media_provider: "venice", image_provider: "venice" });
    const now = Date.parse("2026-10-23T15:00:00Z");
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status, reason) values ('hive', $1, 429, 'the check: 429'), ('venice', $2, 402, 'out of credit')`, [
      "2026-10-23T17:00:00Z",
      "2026-10-23T15:30:00Z",
    ]);
    const cards = await houseProviderStatus(t.db, now);
    const by = Object.fromEntries(cards.map((c) => [c.provider, c]));
    expect(cards.map((c) => c.provider)).toEqual(["openrouter", "venice", "replicate", "fal", "hive"]);
    expect(by.hive).toMatchObject({ state: "paused", pill: "Paused", status: "Daily limit reached: back around 17:00 UTC", until: "2026-10-23T17:00:00.000Z", last4: "5678" });
    // Replicate has no key here, so nobody covers for Venice: the card doesn't pretend otherwise.
    expect(by.venice).toMatchObject({ state: "paused", pill: "Cooling down", status: "Out of credit: skipped until 15:30 UTC; nothing else can make its jobs meanwhile" });
    expect(by.openrouter).toMatchObject({ state: "ready", pill: "✓ Ready", status: "Writing every scene", model: "deepseek/deepseek-chat-v3.1" });
    expect(by.fal).toMatchObject({ state: "no_key", pill: "No key" });
    expect(by.replicate.state).toBe("no_key");
    // Once the pause has run out, Hive's card says the next picture asks it first.
    const later = await houseProviderStatus(t.db, Date.parse("2026-10-23T18:00:00Z"));
    expect(later.find((c) => c.provider === "hive")).toMatchObject({ state: "ready", status: "The daily-limit pause ended at 17:00 UTC; the next picture asks Hive first" });
    expect(later.find((c) => c.provider === "venice")?.state).toBe("ready");
    expect(JSON.stringify(cards)).not.toContain(fakeKey("or"));
    // With Replicate's key saved too, it covers for Venice while Venice cools down, and stands by otherwise.
    await saveAdultSettings(t.db, { replicate_key: fakeKey("rp") });
    const covered = Object.fromEntries((await houseProviderStatus(t.db, now)).map((c) => [c.provider, c]));
    expect(covered.venice.status).toBe("Out of credit: skipped until 15:30 UTC; Replicate makes its jobs meanwhile");
    expect(covered.replicate).toMatchObject({ state: "standby", status: "Ready as the fallback" });
    const calm = Object.fromEntries((await houseProviderStatus(t.db, Date.parse("2026-10-23T18:00:00Z"))).map((c) => [c.provider, c]));
    expect(calm.venice.status).toBe("In use, with Replicate as the fallback");
  });
});
