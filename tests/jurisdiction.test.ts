import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as picturesPost } from "@/app/api/admin/after-dark/pictures/route";
import { GET as carryGet } from "@/app/api/auth/carry/route";
import { deleteAfterDarkData } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { accessHere, forgetRememberedPlacesForTests, mediaAllowedFor } from "@/lib/adult/place";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { afterDarkAccess, placeCookieFresh, PLACE_COOKIE, US_AGE_CHECK_STATES } from "@/lib/jurisdiction";
import { requestPlace, setPlaceForTests, signPlace, verifyPlace } from "@/lib/place";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark's regional rules (lib/jurisdiction.ts, docs/after-dark-legal-review.md, David's OK 2026-10-24).
const SECRET = "a-test-session-secret-that-is-long-enough-0123456789";
const env = { SESSION_SECRET: SECRET };

describe("where After Dark is offered", () => {
  it("blocks the US age-check states, the age-check countries and where it's illegal; text only in the UK; open elsewhere", () => {
    expect(Object.keys(US_AGE_CHECK_STATES)).toHaveLength(27);
    for (const region of ["TX", "FL", "UT", "VA", "LA"]) expect(afterDarkAccess({ country: "US", region }).mode, region).toBe("blocked");
    for (const region of ["CA", "NY", "WA", "IL", "CO"]) expect(afterDarkAccess({ country: "US", region }).mode, region).toBe("open");
    for (const country of ["FR", "IT", "DE", "AU", "BR", "IN", "SA", "CN", "TR"]) expect(afterDarkAccess({ country, region: null }).mode, country).toBe("blocked");
    expect(afterDarkAccess({ country: "GB", region: null })).toMatchObject({ mode: "text_only", reason: expect.stringMatching(/Online Safety Act/) });
    expect(afterDarkAccess({ country: "JP", region: null }).mode).toBe("text_only");
    for (const country of ["NL", "CA", "MX", "SE", "NZ", "ES"]) expect(afterDarkAccess({ country, region: null }).mode, country).toBe("open");
    expect(afterDarkAccess({ country: "TX", region: null }).mode).toBe("open"); // "TX" isn't a country code anyone has
    expect(afterDarkAccess({ country: "us", region: "tx" })).toMatchObject({ mode: "blocked", reason: expect.stringMatching(/^Texas requires/) });
  });

  it("blocks a place it can't read: no country, or a US visitor with no state", () => {
    expect(afterDarkAccess({ country: null, region: null })).toMatchObject({ mode: "blocked", reason: expect.stringMatching(/couldn't tell where/) });
    expect(afterDarkAccess({ country: "US", region: null })).toMatchObject({ mode: "blocked", reason: expect.stringMatching(/which US state/) });
    expect(afterDarkAccess({ country: "garbage", region: null }).mode).toBe("blocked");
  });
});

describe("the signed place", () => {
  it("round-trips, refuses a changed, expired or other browser's token, and the middleware reads only its expiry", () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const token = signPlace({ country: "us", region: "ca" }, env, now)!;
    expect(verifyPlace(token, env, now)).toEqual({ country: "US", region: "CA" });
    expect(verifyPlace(token.replace(".CA.", ".TX."), env, now)).toBeNull();
    expect(verifyPlace(token, env, now + 2 * 60 * 60 * 1000)).toBeNull();
    expect(verifyPlace(token, { SESSION_SECRET: "another-secret-entirely-0123456789-abcdef" }, now)).toBeNull();
    const bound = signPlace({ country: "NL", region: null }, env, now, "nonce-a")!;
    expect(verifyPlace(bound, env, now, "nonce-a")).toEqual({ country: "NL", region: null });
    expect(verifyPlace(bound, env, now, "nonce-b")).toBeNull();
    expect(verifyPlace(bound, env, now)).toBeNull();
    expect(placeCookieFresh(token, now)).toBe(true);
    expect(placeCookieFresh(token, now + 2 * 60 * 60 * 1000)).toBe(false);
    expect(signPlace({ country: "US", region: "CA" }, {}, now)).toBeNull();
  });

  it("trusts Vercel's headers only on Vercel; elsewhere only the signed cookie", () => {
    setPlaceForTests(null);
    try {
      const forged = new Headers({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "CA" });
      expect(requestPlace(forged, { ...env, VERCEL: "1" })).toEqual({ country: "US", region: "CA" });
      expect(requestPlace(forged, env)).toEqual({ country: null, region: null });
      const cookie = `${PLACE_COOKIE}=${signPlace({ country: "SE", region: null }, env)}`;
      expect(requestPlace(new Headers({ cookie }), env)).toEqual({ country: "SE", region: null });
    } finally {
      setPlaceForTests({ country: "US", region: "CA" });
    }
  });
});

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
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setPlaceForTests({ country: "US", region: "CA" });
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
async function subscriber() {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signedIn(id) };
}
const scene = (cookie: string) => GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }));
const picture = (cookie: string) =>
  picturesPost(new Request(`${BASE_URL}/api/admin/after-dark/pictures`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: RAFE, b: JUNIPER }) }));

describe("the rules applied to a subscriber", () => {
  it("open: the scene opens and media may be made; the place is remembered as a country and a state", async () => {
    const sub = await subscriber();
    expect((await scene(sub.cookie)).status).toBe(200);
    expect(await mediaAllowedFor(t.db, sub.id)).toBe(true);
    expect((await t.db.query(`select mode, country, region from adult_viewer_places where user_id = $1`, [sub.id])).rows[0]).toEqual({ mode: "open", country: "US", region: "CA" });
  });

  it("blocked: the same not-found as a stranger, and nothing on the surfaces that link to it", async () => {
    const sub = await subscriber();
    setPlaceForTests({ country: "US", region: "TX" });
    expect((await scene(sub.cookie)).status).toBe(404);
    expect(await mediaAllowedFor(t.db, sub.id)).toBe(false);
    const here = await accessHere(t.db, { userId: sub.id, authenticated: true }, new Headers());
    expect(here).toMatchObject({ mode: "blocked", entitled: { ok: true } });
  });

  it("text only (the UK): the scene opens, but pictures are refused with a 451 and never drawn in the background", async () => {
    const sub = await subscriber();
    setPlaceForTests({ country: "GB", region: null });
    expect((await scene(sub.cookie)).status).toBe(200);
    const refused = await picture(sub.cookie);
    expect(refused.status).toBe(451);
    expect((await refused.json()).error).toBe("media_not_available_here");
    expect(await mediaAllowedFor(t.db, sub.id)).toBe(false);
  });

  it("admins, the operator, are open wherever they are", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    setPlaceForTests({ country: "US", region: "TX" });
    expect(await accessHere(t.db, { userId: id, authenticated: true }, new Headers())).toMatchObject({ mode: "open", admin: true });
    expect((await scene(signedIn(id))).status).toBe(200);
    expect(await mediaAllowedFor(t.db, id)).toBe(true);
  });

  it("deleting an account takes its After Dark records with it", async () => {
    const sub = await subscriber();
    expect((await scene(sub.cookie)).status).toBe(200);
    await deleteAfterDarkData(t.db, sub.id);
    expect((await t.db.query(`select 1 from adult_entitlements where user_id = $1`, [sub.id])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_viewer_places where user_id = $1`, [sub.id])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_scenes where owner_id = $1`, [sub.id])).rows).toHaveLength(0);
  });
});

describe("the hop carries the place to After Dark's own host", () => {
  it("sets a signed place cookie only for the browser whose nonce it was minted for", async () => {
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://ad.example.test");
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    const nonce = "AAAAAAAAAAAAAAAAAAAAAA";
    const pl = signPlace({ country: "NL", region: null }, { SESSION_SECRET: SECRET }, Date.now(), nonce)!;
    const hop = (cookie: string) => carryGet(new Request(`https://ad.example.test/api/auth/carry?${new URLSearchParams({ pl, to: "/after-dark" })}`, { headers: { cookie } }));
    const mine = await hop(`bz_carry=${nonce}`);
    expect(mine.status).toBe(302);
    const set = mine.headers.getSetCookie().join("\n");
    expect(set).toMatch(new RegExp(`${PLACE_COOKIE}=place\\.v1\\.NL\\.-\\.`));
    expect(set).toMatch(/bz_place_tried=1/);
    const theirs = (await hop(`bz_carry=BBBBBBBBBBBBBBBBBBBBBB`)).headers.getSetCookie().join("\n");
    expect(theirs).not.toMatch(new RegExp(`${PLACE_COOKIE}=place`));
  });
});
