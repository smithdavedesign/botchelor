import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #1132 (David, 2026-11-01: "keep them playable"): when the season changes, whoever already has nights with a house
// character who left the cast keeps that pair, marked with the month's cast, and plays it as before; new pairs come from
// the current cast only, and a pair someone can't have says why instead of a bare 404.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => "/after-dark",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "@/app/api/admin/after-dark/route";
import { POST as stepPost } from "@/app/api/admin/after-dark/steer/route";
import AfterDarkScenePage from "@/app/after-dark/[a]/[b]/page";
import PairPicker from "@/app/after-dark/PairPicker";
import { keptPairs, pairAbsence, playableIds, setAdultSwitch } from "@/lib/adult/characters";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { eligiblePair, listCastPairs } from "@/lib/adult/scenes";
import { listShorts, teaserShorts } from "@/lib/adult/shorts";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests(OCTOBER);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
});

// October's cast had H2 on it; November's doesn't. Lower ids first, as adult_scenes keeps a pair.
const [H0, H1, H2, H3] = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
const nameOf = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)!.name;
const OCTOBER = [H0, H1, H2];
const NOVEMBER = [H0, H1, H3];
const key = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedInCookie(id) };
}
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const scripted = (reply: string) => setAdultModelForTests({ complete: async () => reply });
const LINES = JSON.stringify({ lines: [{ who: "a", text: "You came back." }, { who: "b", text: "I said I would." }] });

/** October: `who` plays a night of H0 × H2; then the cast changes and H2 is off November's (stored on October's). */
async function rollover(who: { cookie: string }) {
  scripted(LINES);
  expect((await post({ a: H0, b: H2 }, who.cookie)).status).toBe(200);
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ('2026-10-19', $1, 2, 'dealt') on conflict do nothing`, [H2]);
  setSeasonCastForTests(NOVEMBER);
}

/** Signed in as this user, for the pages. */
function as(cookie: string) {
  jar.cookies.clear();
  jar.cookies.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1));
}
const page = async (a: string, b: string) => renderToStaticMarkup(await AfterDarkScenePage({ params: Promise.resolve({ a, b }) }));

describe("#1132: a pair with someone who left the cast", () => {
  it("stays in the list, marked with October's cast, for whoever had nights of it, and only that pair", async () => {
    const me = await admin();
    await rollover(me);
    const pairs = await listCastPairs(t.db, me.id);
    const kept = pairs.find((p) => p.earlier);
    expect(kept).toMatchObject({ path: `/after-dark/${key(H0, H2).join("/")}`, lines: 2, earlier: "From October's cast", chapter: 1 });
    // No new pair with them: H2 shows up once, in the kept pair, and every other pair is November's cast.
    expect(pairs.filter((p) => [p.a.id, p.b.id].includes(H2))).toHaveLength(1);
    expect(pairs.filter((p) => !p.earlier).every((p) => NOVEMBER.includes(p.a.id) && NOVEMBER.includes(p.b.id))).toBe(true);
    expect(await eligiblePair(t.db, me.id, H2, H0)).toEqual(key(H0, H2));
    expect(await eligiblePair(t.db, me.id, H1, H2)).toBeNull();
    expect(await eligiblePair(t.db, me.id, H2, H3)).toBeNull();
    // The face, baselines, presence and steer take them for this person too.
    expect((await playableIds(t.db, me.id)).has(H2)).toBe(true);
  });

  it("plays on as before: the next lines are written, and the steer's Start fresh works for them", async () => {
    const me = await admin();
    await rollover(me);
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Same table as last time." }] }));
    const res = await post({ a: H2, b: H0 }, me.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).scene.lines.map((l: { text: string }) => l.text)).toEqual(["You came back.", "I said I would.", "Same table as last time."]);
    const steer = await stepPost(
      new Request(`${BASE_URL}/api/admin/after-dark/steer`, { method: "POST", headers: { "content-type": "application/json", cookie: me.cookie }, body: JSON.stringify({ character_id: H2, reset: true }) }),
    );
    expect(steer.status).toBe(200);
  });

  it("isn't offered to someone without nights of it, and nobody can start a new one", async () => {
    const me = await admin();
    const other = await admin();
    await rollover(me);
    const theirs = await listCastPairs(t.db, other.id);
    expect(theirs.some((p) => p.earlier || [p.a.id, p.b.id].includes(H2))).toBe(false);
    expect(await eligiblePair(t.db, other.id, H0, H2)).toBeNull();
    expect((await playableIds(t.db, other.id)).has(H2)).toBe(false);
    scripted(LINES);
    expect((await post({ a: H0, b: H2 }, other.cookie)).status).toBe(404);
    // Nor did that try leave them a row that would keep it next time.
    expect(await keptPairs(t.db, other.id)).toEqual([]);
  });

  it("counts a saved night (Start over), not a page opened with no lines", async () => {
    const me = await admin();
    const opened = await admin();
    // `opened` only opened H0 × H2 in October (an empty scene row); `me` had a night and started over (it's saved).
    for (const who of [me, opened]) {
      await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b) values ($1, $2, $3, $4)`, [crypto.randomUUID(), who.id, ...key(H0, H2)]);
    }
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines) values ('n1', $1, $2, $3, $4::jsonb)`, [
      me.id,
      ...key(H0, H2),
      JSON.stringify([{ who: "a", text: "Hi." }]),
    ]);
    setSeasonCastForTests(NOVEMBER);
    expect((await listCastPairs(t.db, me.id)).find((p) => p.earlier)).toMatchObject({ lines: 0, earlier: "From a past season's cast" });
    expect(await eligiblePair(t.db, opened.id, H0, H2)).toBeNull();
  });

  it("doesn't keep one of their own they switched out", async () => {
    const me = await admin();
    const mine = `own-${crypto.randomUUID().slice(0, 8)}`;
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns) values ($1, $2, false, 'Lexi', 26, 'Bakes.', '["warm"]'::jsonb, 'x', 'x', 'she/her')`,
      [mine, me.id],
    );
    await setAdultSwitch(t.db, me.id, mine, true);
    scripted(LINES);
    expect((await post({ a: H0, b: mine }, me.cookie)).status).toBe(200);
    await setAdultSwitch(t.db, me.id, mine, false);
    expect(await eligiblePair(t.db, me.id, H0, mine)).toBeNull();
    expect(await pairAbsence(t.db, me.id, H0, mine)).toMatchObject({ left: [], off: [{ id: mine }] });
    // Someone else's character is never named.
    const other = await admin();
    expect(await pairAbsence(t.db, other.id, H0, mine)).toBeNull();
  });

  it("the hub lists it under Continue with its mark, and not as a face for a new pair", async () => {
    const me = await admin();
    await rollover(me);
    const html = renderToStaticMarkup(createElement(PairPicker, { pairs: await listCastPairs(t.db, me.id) }));
    expect(html).toMatch(/Continue/);
    expect(html).toMatch(/data-earlier-cast="true"[^>]*>🗓 From October&#x27;s cast/);
    expect(html).not.toContain(`title="${nameOf(H2)}"`);
    expect(html).toContain(`title="${nameOf(H3)}"`);
  });
});

describe("#1132: the scene page", () => {
  it("says who left with October's season, with a link to this season's cast, instead of a bare 404", async () => {
    const me = await admin();
    const other = await admin();
    await rollover(me);
    as(other.cookie);
    const html = await page(H0, H2);
    expect(html).toContain('data-pair-absent="true"');
    expect(html).toContain(`${nameOf(H2)} left the cast with October&#x27;s season.`);
    expect(html).toMatch(/href="\/after-dark"[^>]*>Pick from this season&#x27;s cast/);
    // A character that doesn't exist is still not found.
    await expect(page(H0, "house-nobody")).rejects.toThrow();
  });

  it("opens the kept pair as usual for whoever had it, marked", async () => {
    const me = await admin();
    await rollover(me);
    as(me.cookie);
    const html = await page(H2, H0);
    expect(html).not.toContain("data-pair-absent");
    expect(html).toMatch(/data-earlier-cast="true"[^>]*>🗓 From October&#x27;s cast/);
  });
});

describe("#1132: Shorts", () => {
  it("marks a published Short whose pair has someone who left the cast since", async () => {
    const me = await admin();
    await rollover(me);
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines) values ('n-short', $1, $2, $3, '[]'::jsonb)`, [me.id, ...key(H0, H2)]);
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines) values ('n-now', $1, $2, $3, '[]'::jsonb)`, [me.id, ...key(H0, H1)]);
    await t.db.query(
      `insert into adult_shorts (id, owner_id, character_a, character_b, night_id, night_ids, title, published_at)
       values ('s-old', $1, $2, $3, 'n-short', '["n-short"]', 'The night before', now() - interval '1 hour'), ('s-now', $1, $4, $5, 'n-now', '["n-now"]', 'Tonight', now())`,
      [me.id, ...key(H0, H2), ...key(H0, H1)],
    );
    const shorts = await listShorts(t.db);
    expect(shorts.find((s) => s.id === "s-old")?.earlier).toBe("From October's cast");
    expect(shorts.find((s) => s.id === "s-now")?.earlier).toBeUndefined();
    expect((await teaserShorts(t.db)).find((s) => s.id === "s-old")?.earlier).toBe("From October's cast");
  });
});
