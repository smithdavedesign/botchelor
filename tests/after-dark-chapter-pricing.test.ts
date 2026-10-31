import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { claimChapterPicture, releaseChapterPicture } from "@/lib/adult/chapter-pictures";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { includedPrice } from "@/lib/adult/pricing";
import { DEFAULT_CHAPTER_TOKENS, DEFAULT_PICTURES_PER_CHAPTER, getAdultSettings, saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-25: "I am fine allowing 1-3 generated images for each chapter as long as each chapter cost 1 token."
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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
  // A subscriber's month of steps (lib/adult/usage.ts), as production has it saved.
  await saveAdultSettings(t.db, { caps: { writes: 300 } });
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
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: CAST_A, b: CAST_B, ...(body as object) }) }));
/** A subscriber (age-checked) with `tokens` bought tokens. */
async function subscriber(tokens: number): Promise<{ id: string; cookie: string }> {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  if (tokens) await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), id, tokens]);
  return { id, cookie: signedIn(id) };
}
const used = async (id: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [id])).rows[0]?.used ?? 0;
let k = 0;
const SYL = [["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"], ["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"], ["a", "e", "i", "o", "u", "y", "ae", "oi", "ua", "ie"], ["p", "t", "k", "s", "m", "n", "l", "r", "v", "z"]];
/** A made-up word no step has used, so the repeat guard never drops a line. */
const word = () => {
  const i = k++;
  return SYL.map((syl, d) => syl[Math.floor(i / 10 ** d) % 10]).join("");
};
function writes(fail = false) {
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(messages[0].content)) return "{}";
      if (fail) throw new Error("the model is down");
      return JSON.stringify({ lines: Array.from({ length: 4 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `${word()} ${word()} ${word()} ${word()}.` })) });
    },
  } as never);
}

describe("a chapter's price", () => {
  it("defaults to 1 token and 3 unasked pictures", async () => {
    expect([DEFAULT_CHAPTER_TOKENS, DEFAULT_PICTURES_PER_CHAPTER]).toEqual([1, 3]);
    expect(await getAdultSettings(t.db)).toMatchObject({ chapter_tokens: 1, pictures_per_chapter: 3 });
  });

  // #1005 (David, 2026-10-30: "a subscription that includes an allowance, tokens for extras ... just break even"): a
  // subscriber's chapters are included, bounded by the month's steps; chapter_tokens is left for a viewer with none.
  it("is included for a subscriber: no token taken at a chapter's start or after it, even with none bought", async () => {
    const sub = await subscriber(2);
    writes();
    expect((await post({}, sub.cookie)).status).toBe(200);
    expect((await post({}, sub.cookie)).status).toBe(200);
    expect(await used(sub.id)).toBe(0);
    const broke = await subscriber(0);
    expect((await post({}, broke.cookie)).status).toBe(200);
    expect(await used(broke.id)).toBe(0);
  });

  it("can't be reached by a signed-in viewer with no subscription, who would otherwise pay chapter_tokens", async () => {
    const id = userIdOf(newUserCookie());
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 3, 'test')`, [crypto.randomUUID(), id]);
    writes();
    expect((await post({}, signedIn(id))).status).not.toBe(200);
    expect(await used(id)).toBe(0);
    expect(await includedPrice(t.db, id, 1)).toEqual({ tokens: 1, included: false });
    const sub = await subscriber(0);
    expect(await includedPrice(t.db, sub.id, 1)).toEqual({ tokens: 0, included: true });
  });

  it("isn't taken from an admin, or at 0", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    writes();
    expect((await post({}, signedIn(id))).status).toBe(200);
    expect(await used(id)).toBe(0);
    expect(await includedPrice(t.db, id, 1)).toEqual({ tokens: 0, included: false });
    await saveAdultSettings(t.db, { chapter_tokens: 0 });
    const sub = await subscriber(0);
    expect((await post({}, sub.cookie)).status).toBe(200);
  });
});

describe("a chapter's unasked pictures", () => {
  it("all kinds count against one budget per chapter, and a picture that didn't come gives its place back", async () => {
    const id = crypto.randomUUID();
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b) values ($1, 'o', $2, $3)`, [id, CAST_A, CAST_B]);
    const claim = (chapter: number, key: string) => claimChapterPicture(t.db, id, chapter, key, 3);
    expect(await claim(1, "1:the pier")).toBe(true); // the chapter's own
    expect(await claim(1, "1:the pier")).toBe(false); // the same one twice
    expect(await claim(1, "1#asked:12")).toBe(true); // one the lines asked for
    expect(await claim(1, "1#beat:b1")).toBe(true); // a moment at the close
    expect(await claim(1, "1#beat:b2")).toBe(false); // the fourth
    expect(await claim(11, "11:the pier")).toBe(true); // chapter 11 isn't chapter 1
    expect(await claim(2, "2:her place")).toBe(true); // a new chapter, a new budget
    await releaseChapterPicture(t.db, id, "1#asked:12");
    expect(await claim(1, "1#beat:b2")).toBe(true);
  });
});
