import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { DELETE as deleteProfileRoute, GET as exportProfileRoute } from "@/app/api/admin/after-dark/profile/route";
import { deleteAccount } from "@/lib/account";
import { runAdultTool } from "@/lib/adult/mcp";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { hasProfileConsent, PROFILE_CONSENT_TEXT, setTurnOns } from "@/lib/adult/profile";
import { deleteAdultProfile, exportAdultProfile } from "@/lib/adult/profile-data";
import { saveLimits } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// GDPR Art. 9 (docs/after-dark-legal-review.md "Other laws": turn-ons and hard nos are "sex life" data): nothing of the
// After Dark profile is stored before the person ticks the consent, and they can download and delete it.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

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
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const get = async (cookie: string, extra: string) => (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}${extra}`, { headers: { cookie } }))).json();
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const profileRow = async (id: string) =>
  (await t.db.query<{ turn_ons: string[]; consented_at: Date | null; consented_by: string | null }>(`select turn_ons, consented_at, consented_by from adult_profiles where character_id = $1`, [id])).rows[0];
const sceneRow = async () =>
  (await t.db.query<{ intensity: string | null; hard_nos: { chips: string[]; own: string[] }; hard_nos_consented_at: Date | null }>(`select intensity, hard_nos, hard_nos_consented_at from adult_scenes`)).rows[0];
function scripted() {
  const prompts: ChatMessage[][] = [];
  let k = 0;
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They talked until late." });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify({ a: [], b: [] });
      if (/what a private night left behind/.test(messages[0].content)) return JSON.stringify({ a: "You talked.", b: "You talked." });
      prompts.push(messages);
      const w = () => `zor${k++}vex`;
      return JSON.stringify({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `${w()} ${w()} ${w()} ${w()}.` })) });
    },
  } as never);
  return prompts;
}

describe("the consent before turn-ons are stored", () => {
  it("refuses a save without it and stores nothing; with it, the row says when and by whom", async () => {
    const { id, cookie } = await admin();
    const refused = await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_A, ids: ["praise"] } }, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "consent_required", consent_text: PROFILE_CONSENT_TEXT });
    expect(await profileRow(CAST_A)).toBeUndefined();
    expect((await get(cookie, "&profile=1")).consent).toEqual({ given: false, text: PROFILE_CONSENT_TEXT });

    const ok = await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_A, ids: ["praise"] }, consent: true }, cookie);
    expect(ok.status).toBe(200);
    expect((await ok.json()).consent.given).toBe(true);
    const row = await profileRow(CAST_A);
    expect(row).toMatchObject({ turn_ons: ["praise"], consented_by: id });
    expect(row.consented_at).not.toBeNull();
    // Given once, it covers the next save.
    expect((await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_B, ids: ["massage"] } }, cookie)).status).toBe(200);
    expect((await get(cookie, "&consent=1")).consent.given).toBe(true);
  });

  it("clearing them needs no consent (it stores nothing)", async () => {
    const { id } = await admin();
    await setTurnOns(t.db, id, CAST_A, ["praise"], { consent: true });
    await deleteAdultProfile(t.db, id);
    expect(await hasProfileConsent(t.db, id)).toBe(false);
    expect(await setTurnOns(t.db, id, CAST_A, [])).toEqual({ ok: true, turn_ons: [] });
    expect(await setTurnOns(t.db, id, CAST_A, ["praise"])).toMatchObject({ ok: false, status: 403, consent_required: true });
  });

  it("ticking the box brings what was saved before consent was asked for under it", async () => {
    const { id, cookie } = await admin();
    await t.db.query(`insert into adult_profiles (character_id, turn_ons, updated_by) values ($1, '["praise"]'::jsonb, $2)`, [CAST_A, id]);
    expect(await hasProfileConsent(t.db, id)).toBe(false);
    expect((await (await post({ a: CAST_A, b: CAST_B, profile_consent: true }, cookie)).json()).consent.given).toBe(true);
    expect((await profileRow(CAST_A)).consented_by).toBe(id);
    expect(await hasProfileConsent(t.db, id)).toBe(true);
  });
});

describe("the consent before hard nos are stored", () => {
  it("refuses a save of hard nos without it, the intensity included: nothing is stored", async () => {
    const { id, cookie } = await admin();
    await get(cookie, "");
    const refused = await post({ a: CAST_A, b: CAST_B, limits: { intensity: "slow_burn", hard_nos: { chips: ["choking"], own: ["tickling"] } } }, cookie);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe("consent_required");
    expect(await sceneRow()).toMatchObject({ intensity: null, hard_nos_consented_at: null });
    expect((await sceneRow()).hard_nos.chips ?? []).toEqual([]);
    // The intensity alone isn't the profile: saved without it.
    expect((await post({ a: CAST_A, b: CAST_B, limits: { intensity: "flirty" } }, cookie)).status).toBe(200);
    // With it.
    const ok = await saveLimits(t.db, id, CAST_A, CAST_B, { hard_nos: { chips: ["choking"] } }, { consent: true });
    expect(ok.ok).toBe(true);
    const row = await sceneRow();
    expect(row.hard_nos).toEqual({ chips: ["choking"], own: [] });
    expect(row.hard_nos_consented_at).not.toBeNull();
    // Cleared: nothing to consent to any more.
    await saveLimits(t.db, id, CAST_A, CAST_B, { hard_nos: { chips: [], own: [] } });
    expect((await sceneRow()).hard_nos_consented_at).toBeNull();
  });

  it("over MCP: after_dark_scene needs consent: true to store them; after_dark_write holds them for the step only", async () => {
    await admin();
    const scene = await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B, hard_nos: { chips: ["biting"] } });
    expect(scene).toMatchObject({ error: expect.stringMatching(/consent: true/) });
    const prompts = scripted();
    const write = (await runAdultTool(t.db, "after_dark_write", { a: CAST_A, b: CAST_B, hard_nos: { chips: ["biting"], own: ["tickling"] } })) as Any;
    expect(write.data).toMatchObject({ hard_nos_saved: false });
    expect(write.data.consent_needed).toContain(PROFILE_CONSENT_TEXT);
    // Held for the step: in the prompt as never-cross rules ...
    expect(prompts[0][0].content).toMatch(/tickling/i);
    // ... and never stored.
    const row = await sceneRow();
    expect(row.hard_nos.own ?? []).toEqual([]);
    expect(row.hard_nos_consented_at).toBeNull();
    const saved = (await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B, hard_nos: { chips: ["biting"] }, consent: true })) as Any;
    expect(saved.data.scene.hard_nos).toEqual({ chips: ["biting"], own: [] });
  });
});

describe("download and delete", () => {
  async function person() {
    const creator = newUserCookie();
    const userId = userIdOf(creator);
    const mine = await (await api.createCharacter(validCharacter({ name: "Petra Quill" }), creator)).json();
    expect((await setTurnOns(t.db, userId, mine.id, ["praise", "candlelight"], { consent: true })).ok).toBe(true);
    await t.db.query(
      `insert into adult_scenes (id, owner_id, character_a, character_b, intensity, hard_nos, hard_nos_consented_at) values ($1, $2, $3, $4, 'spicy', $5::jsonb, now())`,
      [crypto.randomUUID(), userId, CAST_A, CAST_B, JSON.stringify({ chips: ["choking"], own: ["tickling"] })],
    );
    return { userId, character: mine, cookie: signedIn(userId) };
  }

  it("downloads everything of it as JSON, for the signed-in person only", async () => {
    const { userId, character, cookie } = await person();
    const res = await exportProfileRoute(new Request(`${BASE_URL}/api/admin/after-dark/profile`, { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="botchelor-after-dark-profile-/);
    const data = await res.json();
    expect(data.consent_text).toBe(PROFILE_CONSENT_TEXT);
    expect(data.turn_ons).toEqual([expect.objectContaining({ character_id: character.id, turn_ons: ["Praise", "Candlelight"], house: false })]);
    expect(data.turn_ons[0].consented_at).toEqual(expect.any(String));
    expect(data.limits).toEqual([expect.objectContaining({ pair: [CAST_A, CAST_B], intensity: "spicy", hard_nos: { chips: ["choking"], own: ["tickling"] } })]);
    expect(await exportAdultProfile(t.db, "someone-else")).toMatchObject({ turn_ons: [], limits: [] });
    // Anonymous: not found.
    expect((await exportProfileRoute(new Request(`${BASE_URL}/api/admin/after-dark/profile`, { headers: { cookie: newUserCookie() } }))).status).toBe(404);
    expect(userId).toBeTruthy();
  });

  it("deletes it, and the consent with it", async () => {
    const { userId, character, cookie } = await person();
    const res = await deleteProfileRoute(new Request(`${BASE_URL}/api/admin/after-dark/profile`, { method: "DELETE", headers: { cookie } }));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toEqual({ turn_ons: 1, limits: 1 });
    expect(await profileRow(character.id)).toBeUndefined();
    expect(await sceneRow()).toMatchObject({ intensity: null, hard_nos: {}, hard_nos_consented_at: null });
    expect(await hasProfileConsent(t.db, userId)).toBe(false);
    expect(await exportAdultProfile(t.db, userId)).toMatchObject({ turn_ons: [], limits: [] });
  });

  it("goes with the account too", async () => {
    const { userId, character } = await person();
    await deleteAccount(t.db, userId);
    expect(await profileRow(character.id)).toBeUndefined();
    // The whole scene goes with the account (lib/account.ts deleteAfterDarkData), hard nos and all.
    expect(await sceneRow()).toBeUndefined();
  });
});
