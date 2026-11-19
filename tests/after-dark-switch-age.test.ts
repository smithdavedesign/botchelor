import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The age check when a person switches their own character into After Dark (lib/adult/switch-check.ts; David,
// 2026-11-18): flagged too young in the profile or the portrait, they stay out and the person is told why.
const hive = vi.hoisted(() => ({ verdicts: [] as unknown[], urls: [] as string[] }));
vi.mock("@/lib/adult/moderation", async (orig) => ({
  ...((await orig()) as object),
  checkMedia: async (_db: unknown, url: string) => {
    hive.urls.push(url);
    return hive.verdicts.shift() ?? { ok: true };
  },
}));
import { POST as switchPost } from "@/app/api/admin/after-dark/switch/route";
import { claimAdmin } from "@/lib/admins";
import { eligibleIds } from "@/lib/adult/characters";
import { setSwitchCheckModelForTests, SWITCH_CHECK_LIMITS, switchAgeCheck } from "@/lib/adult/switch-check";
import type { ChatMessage, Model } from "@/lib/model";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  hive.verdicts = [];
  hive.urls = [];
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSwitchCheckModelForTests(null);
});

/** A model that answers by the character's name in the sheet ("young" in it reads young), counting its calls. */
function judge(): Model & { calls: number } {
  const m = {
    calls: 0,
    async complete(messages: ChatMessage[]) {
      m.calls++;
      const sheet = JSON.parse(messages[messages.length - 1].content) as { bio: string };
      return JSON.stringify({ adult: !/schoolgirl/.test(sheet.bio), reason: "x" });
    },
  };
  return m as unknown as Model & { calls: number };
}

async function character(owner: string, name: string, o: { bio?: string; portrait?: boolean; house?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values ($1, $2, $3, $4, 24, $5, '["dry"]'::jsonb, 'x', 'x')`,
    [id, owner, o.house === true, name, o.bio ?? "Runs a night bakery."],
  );
  if (o.portrait !== false) {
    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating)
       values ($1, $2, 'portrait', 'generated', 'test-model', 'https://files.example/p.webp', 'approved', 'pg')`,
      [`asset-${id}`, id],
    );
  }
  return id;
}

async function setup() {
  const owner = randomUUID();
  await claimAdmin(t.db, owner);
  const post = (character_id: string, on = true) =>
    switchPost(new Request(`${BASE_URL}/api/admin/after-dark/switch`, { method: "POST", headers: { cookie: signedInCookie(owner), "content-type": "application/json" }, body: JSON.stringify({ character_id, on }) }));
  return { owner, post };
}

describe("switching a character into After Dark", () => {
  it("lets a grown-up in after both checks, and keeps the verdict until the sheet or portrait changes", async () => {
    const { owner, post } = await setup();
    const model = judge();
    setSwitchCheckModelForTests(model);
    const baker = await character(owner, "Noor Halabi");
    expect((await post(baker)).status).toBe(200);
    expect(hive.urls).toEqual([expect.stringMatching(new RegExp(`/api/assets/asset-${baker}$`))]);
    expect((await eligibleIds(t.db, owner)).has(baker)).toBe(true);
    // Off and on again: the kept verdict answers, nothing is asked.
    await post(baker, false);
    expect((await post(baker)).status).toBe(200);
    expect(model.calls).toBe(1);
    expect(hive.urls).toHaveLength(1);
    // An edit to the sheet asks again.
    await t.db.query(`update characters set bio = 'Runs a night bakery and a jazz trio.' where id = $1`, [baker]);
    expect(await switchAgeCheck(t.db, owner, baker)).toEqual({ state: "passed" });
    expect(model.calls).toBe(2);
  });

  it("keeps out one whose profile reads young, says so, and doesn't spend a portrait check on it", async () => {
    const { owner, post } = await setup();
    setSwitchCheckModelForTests(judge());
    const young = await character(owner, "Pip Arden", { bio: "A schoolgirl who loves the arcade." });
    const res = await post(young);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "too_young", message: expect.stringMatching(/^Pip Arden reads too young in their profile\./) });
    expect(hive.urls).toHaveLength(0);
    expect((await eligibleIds(t.db, owner)).has(young)).toBe(false);
  });

  it("keeps out one whose portrait Hive reads as young, and says to change the portrait", async () => {
    const { owner, post } = await setup();
    setSwitchCheckModelForTests(judge());
    const c = await character(owner, "Ivo Lark");
    hive.verdicts = [{ ok: false, reason: "Hive: a possible minor." }];
    const res = await post(c);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/^Ivo Lark looks too young in their portrait\. Give them a portrait/);
    // Asked again without a change: the kept verdict, no new check.
    expect((await post(c)).status).toBe(409);
    expect(hive.urls).toHaveLength(1);
  });

  it("stays pending, keeping nothing, when a check can't run; and judges one with no portrait on the sheet alone", async () => {
    const { owner, post } = await setup();
    setSwitchCheckModelForTests(judge());
    const c = await character(owner, "Rhea Moss");
    hive.verdicts = [{ ok: false, reason: "Hive is paused.", paused: "2026-11-19T00:00:00Z" }];
    const res = await post(c);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pending", message: expect.stringMatching(/Try switching them in again tomorrow/) });
    expect((await t.db.query(`select 1 from adult_switch_checks where character_id = $1`, [c])).rows).toHaveLength(0);
    expect((await post(c)).status).toBe(200);
    const bare = await character(owner, "Tam Ochre", { portrait: false });
    expect((await post(bare)).status).toBe(200);
    expect(hive.urls).toHaveLength(2);
    // A model that can't be read is a retry, never a pass.
    setSwitchCheckModelForTests({ complete: async () => "no idea" } as unknown as Model);
    const other = await character(owner, "Una Vell");
    expect(await switchAgeCheck(t.db, owner, other)).toMatchObject({ state: "pending" });
  });

  it("passes the house cast without a check, and limits how many checks a person starts a day", async () => {
    const { owner, post } = await setup();
    const model = judge();
    setSwitchCheckModelForTests(model);
    const house = await character(randomUUID(), "House Host", { house: true });
    expect(await switchAgeCheck(t.db, owner, house)).toEqual({ state: "passed" });
    expect(model.calls).toBe(0);
    for (let i = 0; i < SWITCH_CHECK_LIMITS.perHour; i++) expect((await post(await character(owner, `Guest ${i}`))).status).toBe(200);
    const late = await post(await character(owner, "One Too Many"));
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("pending");
  });
});
