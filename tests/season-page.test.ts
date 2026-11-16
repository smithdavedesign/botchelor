// A lead season's own page (app/seasons/[slug]/SeasonLive.tsx, lib/season-page.ts, docs/season-page.md): December 2026
// runs The Botchelor, so /seasons/december-2026 is a watch-first page from the month before (preseason) until it closes,
// then the finale's recap as every season's. Its three starters are the lead's aired public dates the story check hasn't
// failed, one a partner; an admin's pins pass the same checks. SEASON_PAGE_LIVE=0 puts the page back as it was.
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { HOUSE_CHARACTERS } from "@/lib/house";
import { pilotSundayFor } from "@/lib/premiere-clock";
import { setLeadOverride } from "@/lib/season-cast";
import { seasonFormat } from "@/lib/season-format";
import { setSeasonFormat } from "@/lib/season-format-store";
import {
  episodeIdFrom,
  liveSeasonFormat,
  liveSeasonPaths,
  loadSeasonLive,
  pickStarters,
  seasonPageLiveOn,
  seasonPagePhase,
  seasonPins,
  seasonSchedule,
  setSeasonPins,
  starterPool,
} from "@/lib/season-page";
import { SHOW_WORD_REDIRECTS } from "@/lib/site-redirects";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const SEASON = "2026-12-01";
const LEAD = HOUSE_CHARACTERS[0].id;
const NOV = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
const DEC = (day: number, hour = 12) => new Date(Date.UTC(2026, 11, day, hour));
const ON = {} as Record<string, string | undefined>;

/** December picked as The Botchelor with the house lead picked for it, as the admin does on /admin/season. */
async function botchelorDecember() {
  await setSeasonFormat(t.db, SEASON, "botchelor");
  await setLeadOverride(t.db, SEASON, LEAD);
}

/** A person's character (public unless said). */
async function person(id: string, name: string, visibility = "public") {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, false, $3, 30, 'A suitor with a story.', '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', $4, true)`,
    [id, `owner-${id}`, name, visibility],
  );
}

type DateOpts = { ending?: string; visibility?: string; aired?: Date | null; afterDark?: boolean; status?: string };
/** A date of the lead's with `partner`, aired at `aired` (null: not aired yet). */
async function dated(id: string, partner: string, o: DateOpts = {}) {
  const aired = o.aired === undefined ? NOV(10) : o.aired;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript, sides, setup)
     values ($1, 'u-show', $2, $3, $4, '[]'::jsonb, '[]'::jsonb, 'a twist', 'THE ENDING NOBODY SHOULD SEE', $5, 1, $6, $7, $8, '[]'::jsonb, '[]'::jsonb, $9::jsonb)`,
    [id, LEAD, partner, `Setting of ${id}`, o.ending ?? "friends", o.status ?? "ready", o.visibility ?? "public", aired?.toISOString() ?? null, JSON.stringify({ venue: "jazz_bar", ...(o.afterDark ? { after_dark: true } : {}) })],
  );
}
const checked = (id: string, verdict: string, repaired = false) =>
  t.db.query(`insert into story_checks (episode_id, verdict, reason, repaired) values ($1, $2, '', $3)`, [id, verdict, repaired]);

/** The lead's record: what qualifies and what never may. */
async function record() {
  for (const [id, name, vis] of [
    ["p-ana", "Ana Vale"],
    ["p-bo", "Bo Reyes"],
    ["p-cy", "Cy Moss"],
    ["p-di", "Di Park"],
    ["p-hid", "Hid Den", "private"],
  ] as const)
    await person(id, name, vis);
  await dated("e-ana-1", "p-ana", { ending: "second_date" });
  await dated("e-ana-2", "p-ana", { ending: "disaster" }); // the same partner again: one date a partner
  await dated("e-bo", "p-bo", { ending: "disaster" });
  await dated("e-cy", "p-cy", { ending: "friends" });
  await checked("e-cy", "consistent"); // passed: ranks first
  await dated("e-di-contra", "p-di", { ending: "second_date" });
  await checked("e-di-contra", "contradicts");
  await dated("e-di-repaired", "p-di", { ending: "friends" });
  await checked("e-di-repaired", "consistent", true);
  await dated("e-di-private", "p-di", { visibility: "private" });
  await dated("e-di-unaired", "p-di", { aired: null });
  await dated("e-di-ad", "p-di", { afterDark: true });
  await dated("e-hid", "p-hid", { ending: "second_date" });
}

/** The page rendered to the end, as the server streams it. */
async function render(el: ReactNode): Promise<string> {
  const { prelude } = await prerender(el);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}
/** The page at `now` (Date faked), or what it threw: Next's notFound/redirect carry a digest. */
async function page(slug: string, now: Date, query: Record<string, string> = {}): Promise<{ html: string } | { digest: string }> {
  vi.useFakeTimers({ now, toFake: ["Date"] });
  const { default: SeasonPage } = await import("@/app/seasons/[slug]/page");
  try {
    return { html: await render(await SeasonPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(query) })) };
  } catch (err) {
    const digest = (err as { digest?: string }).digest;
    if (!digest) throw err;
    return { digest };
  }
}
const htmlOf = (r: { html: string } | { digest: string }) => {
  if (!("html" in r)) throw new Error(`expected a page, got ${r.digest}`);
  return r.html;
};

describe("the phase and the switch", () => {
  it("is the next season's page the month before (preseason), this season's while it runs, and none once it closes or further ahead", () => {
    expect(seasonPagePhase(SEASON, NOV(20))).toBe("preseason");
    expect(seasonPagePhase(SEASON, DEC(1, 0))).toBe("season");
    expect(seasonPagePhase(SEASON, DEC(31, 23))).toBe("season");
    expect(seasonPagePhase(SEASON, new Date(Date.UTC(2027, 0, 1, 0)))).toBeNull();
    expect(seasonPagePhase(SEASON, new Date(Date.UTC(2026, 9, 20)))).toBeNull();
  });

  it("SEASON_PAGE_LIVE is on unless 0", () => {
    expect(seasonPageLiveOn({})).toBe(true);
    expect(seasonPageLiveOn({ SEASON_PAGE_LIVE: "1" })).toBe(true);
    expect(seasonPageLiveOn({ SEASON_PAGE_LIVE: " 0 " })).toBe(false);
  });

  it("runs live only for a lead format: a classic month has no live page, and the sitemap lists only the lead season's", async () => {
    expect(await liveSeasonFormat(t.db, SEASON, NOV(20))).toBeNull();
    expect(await liveSeasonPaths(t.db, NOV(20), ON)).toEqual([]);
    await botchelorDecember();
    expect(await liveSeasonFormat(t.db, SEASON, NOV(20))).toMatchObject({ phase: "preseason", def: { slug: "botchelor" } });
    expect((await liveSeasonPaths(t.db, NOV(20), ON)).map((s) => s.path)).toEqual(["/seasons/december-2026"]);
    expect((await liveSeasonPaths(t.db, DEC(10), ON)).map((s) => s.path)).toEqual(["/seasons/december-2026"]);
    expect(await liveSeasonPaths(t.db, NOV(20), { SEASON_PAGE_LIVE: "0" })).toEqual([]);
    expect(await liveSeasonPaths(t.db, new Date(Date.UTC(2027, 0, 3)), ON)).toEqual([]);
  });
});

describe("the starters", () => {
  it("are the lead's aired public dates with a public partner: never contradicting, repaired, private, unaired, After Dark, or with a private partner", async () => {
    await botchelorDecember();
    await record();
    const pool = await starterPool(t.db, SEASON);
    expect(pool.map((s) => s.id).sort()).toEqual(["e-ana-1", "e-ana-2", "e-bo", "e-cy"]);
    expect(pool[0].id).toBe("e-cy"); // the one the story check passed comes first
    for (const s of pool) expect(JSON.stringify(s)).not.toContain("NOBODY SHOULD SEE");
  });

  it("picks three, one a partner, a mix of endings", async () => {
    await botchelorDecember();
    await record();
    const three = pickStarters(await starterPool(t.db, SEASON));
    expect(three).toHaveLength(3);
    expect(new Set(three.map((s) => s.partner)).size).toBe(3);
    expect(three.filter((s) => s.partner === "p-ana")).toHaveLength(1);
    expect(new Set(three.map((s) => s.ending)).size).toBe(3);
  });

  it("puts the pins first, as pinned, then fills one a partner", () => {
    const c = (id: string, partner: string, ending: string, pinned = false) => ({ id, partner, ending: ending as "friends", pinned });
    const pool = [c("pin-1", "x", "friends", true), c("a", "x", "disaster"), c("b", "y", "friends"), c("d", "y", "disaster"), c("e", "z", "second_date")];
    expect(pickStarters(pool).map((s) => s.id)).toEqual(["pin-1", "d", "e"]); // y's disaster over its friends: the pin is friends already
    expect(pickStarters([], 3)).toEqual([]);
  });

  it("takes an admin's pins only when they pass the same checks, and Clear empties them", async () => {
    await botchelorDecember();
    await record();
    vi.useFakeTimers({ now: NOV(20), toFake: ["Date"] });
    for (const bad of ["e-di-contra", "e-di-repaired", "e-di-private", "e-di-unaired", "e-di-ad", "e-hid"]) {
      const r = await setSeasonPins(t.db, SEASON, [bad], NOV(20));
      expect(r, bad).toMatchObject({ ok: false, error: "not_a_starter", failing: [bad] });
    }
    expect(await setSeasonPins(t.db, SEASON, ["a", "b", "c", "d"], NOV(20))).toMatchObject({ ok: false, error: "too_many" });
    expect(await setSeasonPins(t.db, SEASON, ["e-ana-2", "https://botchelor.com/episodes/e-bo?play=1"], NOV(20))).toEqual({ ok: true, pins: ["e-ana-2", "e-bo"] });
    expect(await seasonPins(t.db, SEASON)).toEqual(["e-ana-2", "e-bo"]);
    const picked = pickStarters(await starterPool(t.db, SEASON));
    expect(picked.map((s) => s.id)).toEqual(["e-ana-2", "e-bo", "e-cy"]); // Ana's other date never joins: one a partner
    // A pinned date that goes private later drops out on its own.
    await t.db.query(`update episodes set visibility = 'private' where id = 'e-bo'`);
    expect(pickStarters(await starterPool(t.db, SEASON)).map((s) => s.id)).toEqual(["e-ana-2", "e-cy"]);
    expect(await setSeasonPins(t.db, SEASON, [], NOV(20))).toEqual({ ok: true, pins: [] });
    expect(await seasonPins(t.db, SEASON)).toEqual([]);
    expect(await setSeasonPins(t.db, "2027-01-01", ["e-cy"], NOV(20))).toMatchObject({ ok: false, error: "not_a_lead_season" });
  });

  it("reads an id or a link", () => {
    expect(episodeIdFrom(" abc-123 ")).toBe("abc-123");
    expect(episodeIdFrom("https://botchelor.com/episodes/abc-123?play=1")).toBe("abc-123");
    expect(episodeIdFrom("/episodes/abc-123")).toBe("abc-123");
    expect(episodeIdFrom("")).toBeNull();
  });
});

describe("when things happen (from the code's own clocks)", () => {
  const def = seasonFormat("botchelor");
  it("in season: every day's dates, Thursday's vote, the Sunday premiere at its hour, the ceremony after it, the finale on the last Sunday", () => {
    const lines = seasonSchedule(def, SEASON, "season", "Nell", DEC(8), ON);
    expect(lines.map((l) => l.key)).toEqual(["dates", "vote", "premiere", "ceremony", "finale"]);
    const at = (k: string) => (lines.find((l) => l.key === k)!.when as { iso: string }).iso;
    expect(at("vote")).toBe("2026-12-10T00:00:00.000Z");
    expect(at("premiere")).toBe("2026-12-13T23:00:00.000Z");
    expect(at("ceremony")).toBe("2026-12-13T23:20:00.000Z");
    expect(at("finale")).toBe("2026-12-27T23:20:00.000Z");
  });

  it("follows the switches: no premiere line and the ceremony back at 20:20 with SUNDAY_PREMIERE=0; another premiere hour moves both", () => {
    const off = seasonSchedule(def, SEASON, "season", "Nell", DEC(8), { SUNDAY_PREMIERE: "0" });
    expect(off.map((l) => l.key)).not.toContain("premiere");
    expect((off.find((l) => l.key === "ceremony")!.when as { iso: string }).iso).toBe("2026-12-13T20:20:00.000Z");
    const hour21 = seasonSchedule(def, SEASON, "season", "Nell", DEC(8), { PREMIERE_HOUR_UTC: "21" });
    expect((hour21.find((l) => l.key === "premiere")!.when as { iso: string }).iso).toBe("2026-12-13T21:00:00.000Z");
  });

  it("on the finale's week: no vote (the finale has none), the premiere before the final rose; after it, only the finale's line", () => {
    expect(seasonSchedule(def, SEASON, "season", "Nell", DEC(22), ON).map((l) => l.key)).toEqual(["dates", "premiere", "finale"]);
    const after = seasonSchedule(def, SEASON, "season", "Nell", DEC(29), ON);
    expect(after.map((l) => l.key)).toEqual(["finale"]);
    expect(after[0].what).toContain("gave the final rose");
  });

  it("preseason: the pilot on Sunday 29 November when it is this season's next premiere, then the start", () => {
    expect(pilotSundayFor(SEASON)).toBe("2026-11-29");
    const pilot = { kind: "pilot", season_id: SEASON, at: "2026-11-29T23:00:00.000Z" } as Parameters<typeof seasonSchedule>[6];
    const lines = seasonSchedule(def, SEASON, "preseason", "Nell", NOV(20), ON, pilot);
    expect(lines.map((l) => l.key)).toEqual(["pilot", "start", "dates", "vote", "premiere", "ceremony", "finale"]);
    expect(lines[0]).toMatchObject({ when: { iso: "2026-11-29T23:00:00.000Z", style: "day-time" } });
    expect(lines[0].what).toContain("Meet the lead");
    expect(seasonSchedule(def, SEASON, "preseason", "Nell", NOV(20), ON, null).map((l) => l.key)[0]).toBe("start");
  });

  it("a classic format has no schedule", () => {
    expect(seasonSchedule(seasonFormat("classic"), SEASON, "season", null, DEC(8), ON)).toEqual([]);
  });
});

describe("the page (app/seasons/[slug])", () => {
  it("preseason: the hero, three dates that play, the lead, casting, the pilot and the contrast, never an ending", async () => {
    await botchelorDecember();
    await record();
    const html = htmlOf(await page("december-2026", NOV(20)));
    expect(html).toContain("Season 3 · December · The Botchelor");
    expect(html).toContain("Your characters. Their dates. Nobody knows how it ends.");
    expect(html).toContain("Start here: three dates");
    expect(html.match(/href="\/episodes\/[^"?]+\?play=1"/g)).toHaveLength(3);
    expect(html).toContain('href="/episodes/e-cy?play=1"');
    expect(html).not.toContain("e-di-contra");
    expect(html).not.toContain("NOBODY SHOULD SEE");
    expect(html).toContain(HOUSE_CHARACTERS[0].name);
    expect(html).toContain("/casting");
    expect(html).toContain("When things happen");
    expect(html).toContain("The pilot, Meet the lead");
    expect(html).toContain("The Sunday premiere");
  });

  it("hides the starters' box when nothing qualifies", async () => {
    await botchelorDecember();
    const html = htmlOf(await page("december-2026", NOV(20)));
    expect(html).toContain("Season 3 · December · The Botchelor");
    expect(html).not.toContain("Start here");
  });

  it("in season: the night and days to the finale, the suitors as they stand, this season's dates first", async () => {
    await botchelorDecember();
    await record();
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [SEASON, LEAD]);
    for (const [i, id] of ["p-ana", "p-bo", "p-cy", "p-di"].entries())
      await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, 'suitor')`, [SEASON, id, i + 1]);
    await dated("e-dec-di", "p-di", { ending: "second_date", aired: DEC(3) });
    const data = await loadSeasonLive(t.db, SEASON, "season", seasonFormat("botchelor"), DEC(10), ON);
    expect(data.starters[0].id).toBe("e-dec-di");
    expect(data.suitors?.map((s) => s.state)).toEqual(["in", "in", "in", "in"]);
    const html = htmlOf(await page("december-2026", DEC(10)));
    expect(html).toContain("Night 10 of 31");
    expect(html).toContain("to the finale");
    expect(html).toContain("Bo Reyes");
    expect(html).not.toContain("The pilot, Meet the lead");
  });

  it("a closed lead season is the finale's recap again", async () => {
    await setSeasonFormat(t.db, "2026-11-01", "botchelor");
    const html = htmlOf(await page("november-2026", DEC(10)));
    expect(html).not.toContain("season-live");
    expect(html).toContain("the finale");
  });

  it("a classic month keeps its old ways: one not closed yet sends to the Reunion, a slug that's no season is not found", async () => {
    expect(await page("december-2026", DEC(10))).toEqual({ digest: expect.stringContaining("/reunion") });
    expect(await page("january-2027", DEC(10))).toEqual({ digest: expect.stringContaining("/reunion") });
    expect(await page("smarch-2026", DEC(10))).toEqual({ digest: expect.stringContaining("404") });
  });

  it("SEASON_PAGE_LIVE=0: preseason sends to /casting with the query, in season to the Reunion", async () => {
    await botchelorDecember();
    vi.stubEnv("SEASON_PAGE_LIVE", "0");
    expect(await page("december-2026", NOV(20), { utm_source: "clip", utm_campaign: "december" })).toEqual({
      digest: expect.stringContaining("/casting?utm_source=clip&utm_campaign=december"),
    });
    expect(await page("december-2026", DEC(10))).toEqual({ digest: expect.stringContaining("/reunion") });
  });

  it("is indexed while live, with its own title; a classic month not closed yet (this one, or further ahead) isn't", async () => {
    await botchelorDecember();
    vi.useFakeTimers({ now: NOV(20), toFake: ["Date"] });
    const { generateMetadata } = await import("@/app/seasons/[slug]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "december-2026" }) });
    expect(meta.title).toBe("Season 3, December 2026: The Botchelor · Botchelor");
    expect(meta.robots).toBeUndefined();
    expect(String(meta.description)).toContain("casting is open now");
    for (const slug of ["november-2026", "january-2027", "march-2027"]) {
      const classic = await generateMetadata({ params: Promise.resolve({ slug }) });
      expect(classic.robots, slug).toMatchObject({ index: false });
    }
    expect((await generateMetadata({ params: Promise.resolve({ slug: "october-2026" }) })).title).toContain("the finale");
  });
});

describe("ways in", () => {
  it("/december lands on December's season page with the clips' tags", () => {
    expect(SHOW_WORD_REDIRECTS.find((r) => r.source === "/december")?.destination).toBe("/seasons/december-2026?utm_source=clip&utm_medium=clip&utm_campaign=december");
  });
});
