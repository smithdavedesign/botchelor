import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteKey, GET as getKeys, PUT as putKey } from "@/app/api/me/keys/route";
import { registerAccount, signSession } from "@/lib/auth";
import { setDbForTests } from "@/lib/db";
import { assembleCharacter, type Character } from "@/lib/character";
import { fixedEngine, type CharacterSheet, type DateInput } from "@/lib/engine";
import { simulateConversation, type Turn } from "@/lib/conversation";
import type { ChatMessage, Model } from "@/lib/model";
import { buildKeyForSide, listUserKeys, saveUserKey, userTextModel } from "@/lib/keys";
import type { StoredSoul } from "@/lib/souls";
import { BASE_URL, startTestDb } from "./helpers";

const SECRET = ["byok", "test", "secret", "0123456789abcdef"].join("-");
const KEY = ["sk", "live", "ZZZ9zzz9ZZZ9zzz9last4"].join("-"); // built from parts, never a literal secret
const env = { SESSION_SECRET: SECRET };

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
  await t.db.query("delete from accounts");
});

describe("the encrypted key store", () => {
  it("stores a key encrypted and only ever reads back the last four", async () => {
    await registerAccount(t.db, "11111111-1111-4111-8111-111111111111", "mapmaker", "a-good-password");
    await saveUserKey(t.db, "11111111-1111-4111-8111-111111111111", "google", "text", KEY, null, env);
    const row = (await t.db.query<{ ciphertext: string; last4: string }>(`select ciphertext, last4 from user_keys where user_id = $1`, ["11111111-1111-4111-8111-111111111111"])).rows[0];
    expect(row.ciphertext).not.toContain(KEY); // encrypted at rest
    expect(row.last4).toBe(KEY.slice(-4));
    const listed = await listUserKeys(t.db, "11111111-1111-4111-8111-111111111111");
    expect(listed).toEqual([{ provider: "google", kind: "text", last4: KEY.slice(-4), model: null, created_at: expect.any(String) }]);
  });

  it("builds a working model that sends the decrypted key to the provider, and nothing without a key", async () => {
    await registerAccount(t.db, "22222222-2222-4222-8222-222222222222", "dex", "a-good-password");
    await saveUserKey(t.db, "22222222-2222-4222-8222-222222222222", "google", "text", KEY, "gemini-3.5-flash-lite", env);
    const seen: { url: string; auth: string | null } = { url: "", auth: null };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.url = String(url);
      seen.auth = new Headers(init.headers).get("authorization");
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    });
    const model = await userTextModel(t.db, "22222222-2222-4222-8222-222222222222", undefined, env);
    await model!.complete([{ role: "user", content: "hi" }]);
    vi.unstubAllGlobals();
    expect(seen.url).toContain("generativelanguage.googleapis.com");
    expect(seen.auth).toBe(`Bearer ${KEY}`);
    expect(await userTextModel(t.db, "33333333-3333-4333-8333-333333333333", undefined, env)).toBeNull();
  });
});

describe("the per-side routing rule (a key never sees another user's soul)", () => {
  const soul = (marker: string): StoredSoul => ({ values: `honesty ${marker}`, insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("own soul → own key; a soulless partner rides the lone creator's key; a second user's soul stays off it", async () => {
    await registerAccount(t.db, A, "auser", "a-good-password");
    await registerAccount(t.db, B, "buser", "a-good-password");
    await saveUserKey(t.db, A, "google", "text", KEY, null, env);

    // House date: A (real, has key) vs a soulless house side. Both sides may run on A's key.
    const house = await buildKeyForSide(t.db, [A, null], [true, false], undefined, env);
    expect(house("a")).not.toBeNull();
    expect(house("b")).not.toBeNull(); // soulless → rides A's lone key

    // Blind date: A (key) vs B (real, has soul, no key). A's side on A's key; B's side on the platform.
    const blind = await buildKeyForSide(t.db, [A, B], [true, true], undefined, env);
    expect(blind("a")).not.toBeNull();
    expect(blind("b")).toBeNull(); // B's soul must never ride A's key

    // Two real users, neither with a key: platform for both.
    await t.db.query("delete from user_keys");
    const none = await buildKeyForSide(t.db, [A, B], [true, true], undefined, env);
    expect(none("a")).toBeNull();
    expect(none("b")).toBeNull();
  });

  it("in a real conversation, B's lines (and B's soul) only ever reach the platform model", async () => {
    const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm", "bold"], want: "a map reader", dealbreaker: "liars", house: false, pronouns: "she/her" };
    const sheetB: CharacterSheet = { name: "Rafe", age: 34, bio: "a baker", traits: ["dramatic", "kind", "proud"], want: "a taster", dealbreaker: "rudeness", house: false, pronouns: "he/him" };
    const chars: [Character, Character] = [
      assembleCharacter({ id: "a", sheet: sheetA, soul: soul("ALPHASOUL"), memory: null }),
      assembleCharacter({ id: "b", sheet: sheetB, soul: soul("BETASOUL"), memory: null }),
    ];
    const input: DateInput = {
      a: { sheet: sheetA, signals: { warmth: 0.6, openness: 0.5, guardedness: 0.3, humor: 0.6 }, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_funny", note: null, gameBudget: 25 },
      b: { sheet: sheetB, signals: { warmth: 0.6, openness: 0.5, guardedness: 0.3, humor: 0.6 }, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "test_sincerity", note: null, gameBudget: 25 },
    };
    const outcome = fixedEngine({ ending: "friends" }).decide(input, 1);
    // Each line is a single stopword-only token so the free critic (catchphrase, opener, motif, near-duplicate)
    // never sends one back, which would add calls and muddy the counts.
    const neutral = ["Hmm.", "Mm?", "Oh.", "Hah.", "Yes?", "Sure.", "Oh?", "Mm.", "Hmm?", "Yes."];
    const record = (into: ChatMessage[][]): Model => ({
      async complete(m) {
        into.push(m);
        return JSON.stringify({ dialogue: neutral[into.length % neutral.length], action: "", emotion: "warm", interest_signal: 0.5 });
      },
    });
    const aSaw: ChatMessage[][] = [];
    const platformSaw: ChatMessage[][] = [];
    const aModel = record(aSaw);
    const platform = record(platformSaw);
    // A has a key (aModel); B has none → platform. (Mirrors buildKeyForSide for a blind date.)
    const keyForSide = (side: "a" | "b") => (side === "a" ? aModel : null);

    await simulateConversation(platform, input, outcome, chars, "a_dare", "rooftop_bar", "classic", 10, {}, undefined, keyForSide);

    const aText = aSaw.flat().map((m) => m.content).join("\n");
    expect(aText).toContain("ALPHASOUL"); // A's own soul reached A's key — fine
    expect(aText).not.toContain("BETASOUL"); // B's soul NEVER reached A's key
    expect(platformSaw.length).toBe(5); // B's five turns ran on the platform model
    expect(platformSaw.flat().map((m) => m.content).join("\n")).toContain("BETASOUL");
  });
});

describe("the /api/me/keys route", () => {
  const authed = (uid: string) => `bz_sess=${signSession({ uid, authenticated: true }, env)}`;
  const put = (body: unknown, cookie?: string) => putKey(new Request(BASE_URL + "/api/me/keys", { method: "PUT", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

  beforeEach(() => {
    setDbForTests(t.db);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("needs a signed-in account; anonymous can't store a key", async () => {
    expect((await getKeys(new Request(BASE_URL + "/api/me/keys"))).status).toBe(401);
    expect((await put({ provider: "google", key: KEY })).status).toBe(401);
  });

  it("saves, lists (last four only) and deletes a key for a signed-in account", async () => {
    const uid = "44444444-4444-4444-8444-444444444444";
    await registerAccount(t.db, uid, "keyer", "a-good-password");
    const saved = await put({ provider: "google", key: KEY, model: "gemini-3.5-flash-lite" }, authed(uid));
    expect(saved.status).toBe(200);
    expect((await saved.json()).saved).toMatchObject({ provider: "google", last4: KEY.slice(-4), model: "gemini-3.5-flash-lite" });

    const listed = await (await getKeys(new Request(BASE_URL + "/api/me/keys", { headers: { cookie: authed(uid) } }))).json();
    expect(listed.keys[0]).not.toHaveProperty("ciphertext");
    expect(JSON.stringify(listed)).not.toContain(KEY);

    expect((await put({ provider: "nope", key: KEY }, authed(uid))).status).toBe(422); // unknown provider
    const del = await deleteKey(new Request(BASE_URL + "/api/me/keys", { method: "DELETE", headers: { "content-type": "application/json", cookie: authed(uid) }, body: JSON.stringify({ provider: "google" }) }));
    expect((await del.json()).removed).toBe(true);
  });

  it("is unavailable (503), not a 500, when the deployment can't encrypt", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect((await getKeys(new Request(BASE_URL + "/api/me/keys"))).status).toBe(503);
  });
});
