import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startTasteRoute } from "@/app/api/after-dark/taste/route";
import { canAfterDark } from "@/lib/adult/entitlement";
import { mediaAllowedFor, mediaRefusal, rememberAccess, forgetRememberedPlacesForTests } from "@/lib/adult/place";
import { hasSubscription, clipPrice } from "@/lib/adult/pricing";
import { isTasting, startTaste, TASTE_PER_DAY, TASTE_WRITES, tasteRefusal } from "@/lib/adult/taste";
import { countUse, overCap, TASTE_DONE } from "@/lib/adult/usage";
import { afterDarkAccess } from "@/lib/jurisdiction";
import { setPlaceForTests } from "@/lib/place";
import { jsonRequest, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// Competitor review 2026-11-08 (David's "1-5"): a self-started free taste of After Dark, scenes only, once per person.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetRememberedPlacesForTests();
  await t.db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setPlaceForTests({ country: "CA", region: "ON" });
});
afterEach(() => {
  setPlaceForTests(null);
  vi.unstubAllEnvs();
});

function person() {
  const cookie = newUserCookie();
  const id = userIdOf(cookie);
  return { id, cookie: signedInCookie(id) };
}
const start = (cookie: string | undefined, body: Record<string, unknown> = { adult: true }) =>
  startTasteRoute(jsonRequest("/api/after-dark/taste", body, { cookie }));

describe("starting a free taste", () => {
  it("opens After Dark as a taste for 48 hours, once", async () => {
    const p = person();
    const res = await start(p.cookie);
    expect(res.status).toBe(200);
    const e = await canAfterDark(t.db, { userId: p.id, authenticated: true });
    expect(e).toEqual({ ok: true, why: "taste" });
    expect(await isTasting(t.db, p.id)).toBe(true);
    const row = (await t.db.query<{ age_method: string; period_end: Date }>(`select age_method, period_end from adult_entitlements where user_id = $1`, [p.id])).rows[0];
    expect(row.age_method).toBe("self_declared");
    const hours = (new Date(row.period_end).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);

    // A second try is refused (already in), and after it ends it can't be started again.
    expect((await start(p.cookie)).status).toBe(409);
    await t.db.query(`update adult_entitlements set period_end = now() - interval '1 minute' where user_id = $1`, [p.id]);
    expect((await canAfterDark(t.db, { userId: p.id, authenticated: true })).ok).toBe(false);
    const again = await start(p.cookie);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("already_had");
  });

  it("needs a signed-in person, the 18+ box, and a fully open place", async () => {
    expect((await start(undefined)).status).toBe(401);
    const p = person();
    expect((await start(p.cookie, {})).status).toBe(422);
    setPlaceForTests({ country: "GB", region: null });
    expect(afterDarkAccess({ country: "GB", region: null }).mode).toBe("text_only");
    expect((await start(p.cookie)).status).toBe(451);
    setPlaceForTests({ country: "US", region: "TX" });
    expect((await start(p.cookie)).status).toBe(451);
    expect(await isTasting(t.db, p.id)).toBe(false);
  });

  it("isn't for anyone who has or had After Dark, but is for someone who only asked for an invite", async () => {
    const had = person();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, period_end, provider) values ($1, 'cancelled', now() - interval '1 day', 'segpay')`, [had.id]);
    expect(await tasteRefusal(t.db, had.id)).toBe("has_after_dark");
    const asked = person();
    await t.db.query(`insert into adult_entitlements (user_id, age_verified_at, age_method) values ($1, now(), 'self_declared')`, [asked.id]);
    expect(await tasteRefusal(t.db, asked.id)).toBeNull();
    expect((await start(asked.cookie)).status).toBe(200);
  });

  it("stops at the day's limit across the site", async () => {
    for (let i = 0; i < TASTE_PER_DAY; i++) await t.db.query(`insert into adult_tastes (user_id) values ($1)`, [`u-${i}`]);
    const p = person();
    const res = await startTaste(t.db, p.id, "CA");
    expect(res).toEqual({ ok: false, why: "sold_out_today" });
  });
});

describe("what a taste includes", () => {
  it("is the scenes at no tokens, with no pictures, video or voice", async () => {
    const p = person();
    await startTaste(t.db, p.id, "CA");
    // Last seen in an open place, so only the taste stops the media.
    await rememberAccess(t.db, p.id, afterDarkAccess({ country: "CA", region: "ON" }));
    expect(await hasSubscription(t.db, p.id)).toBe(true);
    expect(await mediaAllowedFor(t.db, p.id)).toBe(false);
    const refusal = await mediaRefusal(t.db, p.id);
    expect(refusal?.status).toBe(402);
    expect((await refusal!.json()).error).toBe("media_needs_subscription");
    // No included clips on a taste.
    expect((await clipPrice(t.db, p.id)).included).toBe(false);
  });

  it("caps its scene steps at its own allowance", async () => {
    const p = person();
    await startTaste(t.db, p.id, "CA");
    expect(await overCap(t.db, p.id, "writes")).toBeNull();
    await countUse(t.db, p.id, "writes", new Date(), TASTE_WRITES - 1);
    expect(await overCap(t.db, p.id, "writes")).toBeNull();
    await countUse(t.db, p.id, "writes");
    expect(await overCap(t.db, p.id, "writes")).toBe(TASTE_DONE);
  });

  it("is replaced by a subscription, which gets media and the month's cap", async () => {
    const p = person();
    await startTaste(t.db, p.id, "CA");
    await countUse(t.db, p.id, "writes", new Date(), TASTE_WRITES);
    await t.db.query(`update adult_entitlements set provider = 'segpay', period_end = now() + interval '30 days' where user_id = $1`, [p.id]);
    await rememberAccess(t.db, p.id, afterDarkAccess({ country: "CA", region: "ON" }));
    expect((await canAfterDark(t.db, { userId: p.id, authenticated: true })).why).toBe("subscribed");
    expect(await mediaAllowedFor(t.db, p.id)).toBe(true);
    expect(await overCap(t.db, p.id, "writes")).toBeNull();
  });
});
