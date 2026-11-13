// The season pages as the design lift draws them (2026-11-13): /seasons leads with the running season's title card (its
// cast's faces, the month clock, the Reunion and tonight) and lists each finale as a card with its golden couple and three
// numbers; a finale (/seasons/october-2026) is a wide page led by a title card, the golden couple large over the place of
// their best date, with the six numbers in one row and every section still there.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { daysLeft, daysLeftLabel, heroVenue, venueIdForPlace } from "@/app/seasons/season-visuals";
import { venueBackdrop } from "@/lib/portraits";
import { placeOf, type RecapEpisode } from "@/lib/season-recap";
import { DATE_VENUES, EXTRA_VENUES } from "@/lib/venues";
import { api, setupEpisode, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const OCTOBER = "2026-10-19";
/** Puts an aired date at a moment of the season (its revealed_at) and at a place, so the finale counts it there. */
const airedAt = (id: string, iso: string, venue: string) =>
  t.db.query(`update episodes set revealed_at = $2, setup = coalesce(setup, '{}'::jsonb) || $3::jsonb where id = $1`, [id, iso, JSON.stringify({ venue })]);

/** The page rendered to the end, as the server streams it (its async parts suspend). */
async function render(el: ReactNode): Promise<string> {
  const { prelude } = await prerender(el);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}
const section = (html: string, open: string, close: string) => {
  const at = html.indexOf(open);
  expect(at, `${open} is on the page`).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf(close, at));
};

describe("season visuals (app/seasons/season-visuals.ts)", () => {
  const who = (id: string) => ({ id, name: id, house: false, hue: null, portrait: null });
  const ep = (id: string, a: string, b: string, place: string | null): RecapEpisode => ({ id, a: who(a), b: who(b), place, ending: "second_date", day: 1, calls: 0, best_line: null });

  it("finds the venue a finale's stored place names, and none for a place of their own", () => {
    expect(venueIdForPlace(placeOf("jazz_bar"))).toBe("jazz_bar");
    expect(venueIdForPlace(placeOf("goat_yoga"))).toBe("goat_yoga");
    expect(venueIdForPlace(placeOf("home"))).toBe("home");
    expect(venueIdForPlace(placeOf("home@Chud's place"))).toBeNull();
    expect(venueIdForPlace("A basement jazz bar, one table left")).toBe("jazz_bar");
    expect(venueIdForPlace("late_bookshop")).toBe("late_bookshop");
    expect(venueIdForPlace(null)).toBeNull();
    expect(venueIdForPlace("")).toBeNull();
  });

  it("maps every venue's own phrase back to that venue (no two venues share a phrase)", () => {
    for (const v of [...DATE_VENUES, ...EXTRA_VENUES]) expect(venueIdForPlace(placeOf(v.id)), v.id).toBe(v.id);
  });

  it("puts the golden couple's own date behind the hero, else the most-called date, else nothing", () => {
    const golden = { a: who("x"), b: who("y"), dates: 2, second_dates: 2, last_ending: "second_date" as const, line: "", stage: null };
    const rewatch = [ep("1", "p", "q", placeOf("goat_yoga")), ep("2", "y", "x", placeOf("home@Chud's place")), ep("3", "x", "y", placeOf("jazz_bar"))];
    expect(heroVenue({ golden, rewatch })).toBe("jazz_bar");
    expect(heroVenue({ golden: null, rewatch })).toBe("goat_yoga");
    expect(heroVenue({ golden, rewatch: [ep("2", "x", "y", placeOf("home@Chud's place"))] })).toBeNull();
    expect(heroVenue({ golden: null, rewatch: [] })).toBeNull();
  });

  it("counts the nights left in the month", () => {
    expect(daysLeft(new Date("2026-11-13T12:00:00Z"))).toBe(18);
    expect(daysLeft(new Date("2026-11-30T23:00:00Z"))).toBe(1);
    expect(daysLeftLabel(new Date("2026-11-30T12:00:00Z"))).toBe("Last night of the season");
    expect(daysLeftLabel(new Date("2026-11-01T00:00:00Z"))).toBe("30 nights left in the month");
  });
});

describe("the season pages", () => {
  let html = "";
  let golden: { a: string; b: string } = { a: "", b: "" };
  beforeAll(async () => {
    await t.reset();
    // October: one couple's date that both wanted more of (the golden couple) at the jazz bar, and a disaster at a place of
    // their own, which has no set and so no photo.
    const one = await setupEpisode("second_date");
    await api.reveal(one.episode.id, one.creator);
    await airedAt(one.episode.id, "2026-10-21T20:00:00Z", "jazz_bar");
    const two = await setupEpisode("disaster");
    await api.reveal(two.episode.id, two.creator);
    await airedAt(two.episode.id, "2026-10-25T20:00:00Z", "home@Chud's place");
    const [a, b] = one.episode.characters.map((c: { id: string }) => c.id);
    golden = a < b ? { a, b } : { a: b, b: a };
    // The house cast: two of October's, one of whom stays on for November.
    const stays = one.episode.characters[1].id;
    const leaves = (await t.db.query<{ id: string }>(`select id from characters where is_house and id <> $1 order by id limit 1`, [stays])).rows[0].id;
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'dealt'), ($1, $3, 1, 'dealt'), ('2026-11-01', $2, 0, 'survivor')`, [OCTOBER, stays, leaves]);
    const { default: SeasonPage } = await import("@/app/seasons/[slug]/page");
    html = await render(await SeasonPage({ params: Promise.resolve({ slug: "october-2026" }) }));
  }, 60_000);

  it("the finale is a wide page led by a title card: the golden couple large over the venue of their date", () => {
    expect(html).toContain('<article class="season-page page-wide">');
    const hero = section(html, '<header class="season-hero"', "</header>");
    expect(hero).toContain('class="venue-photo season-hero-photo"');
    expect(hero).toContain(`src="${venueBackdrop("jazz_bar")}"`);
    expect(hero).toContain("Season 1 · the finale");
    expect(hero).toContain("<h1>October 2026</h1>");
    expect(hero).toContain('class="pair-faces season-hero-faces"');
    expect(hero.match(/width="96"/g)).toHaveLength(2);
    expect(hero).toContain("🏆 Golden couple");
    expect(hero).toContain(`href="/couples/${golden.a}/${golden.b}"`);
    expect(hero).toMatch(/class="season-hero-line">Met on day 3 at .*jazz/i);
  });

  it("keeps the cold open as a reading column and the six numbers in one row", () => {
    const previously = section(html, '<section class="card season-previously"', "</section>");
    expect(previously).toContain('class="season-previously-column"');
    expect(previously).toContain("Previously on Botchelor");
    const numbers = section(html, '<dl class="season-numbers">', "</dl>");
    expect(numbers.match(/<dd>/g)).toHaveLength(6);
    expect(numbers).toContain("<dt>dates aired</dt><dd>2</dd>");
    expect(numbers).toContain("<dt>pairings</dt><dd>2</dd>");
    expect(numbers).toContain("<dt>wanted a second date</dt><dd>1</dd>");
    expect(numbers).toContain("<dt>disasters</dt><dd>1</dd>");
  });

  it("keeps every section: couples as rows, rewatch rows with the place's photo, awards, who stayed, the pool's place, the next season", () => {
    for (const id of ["previously", "numbers", "couples", "rewatch", "awards", "cast", "next"]) expect(html, id).toContain(`id="${id}"`);
    const couples = section(html, '<ul class="list season-couples">', "</ul>");
    expect(couples.match(/class="card season-couple/g)).toHaveLength(2);
    expect(couples).toContain(`href="/couples/${golden.a}/${golden.b}"`);
    expect(couples).toContain("🏆 Golden couple");
    const rewatch = section(html, '<ol class="list season-rewatch">', "</ol>");
    expect(rewatch.match(/class="card tap-card season-episode"/g)).toHaveLength(2);
    // The jazz bar has a set; Chud's place doesn't, so that row's pair stands alone.
    expect(rewatch.match(/class="venue-photo season-episode-photo"/g)).toHaveLength(1);
    expect(rewatch).toContain(`src="${venueBackdrop("jazz_bar")}"`);
    expect(rewatch.match(/class="pair-faces"/g)).toHaveLength(2);
    expect(html).toContain('class="boards season-awards"');
    expect(html).toContain("Who stayed, who left");
    expect(html).toContain("Said goodbye");
    expect(html).toContain("Stays for Season 2");
    expect(html).toContain('href="/reunion"');
  });

  it("the index leads with the running season's title card and lists October's finale as a card with its golden couple and three numbers", async () => {
    const { default: SeasonsPage } = await import("@/app/seasons/page");
    const index = await render(await SeasonsPage());
    expect(index).toContain('<article class="page-wide seasons-page">');
    const now = section(index, '<section class="card season-now"', "</section>");
    expect(now).toMatch(/Season \d+ · on now/);
    expect(now).toMatch(/nights left in the month|Last night of the season/);
    const faces = section(now, '<ul class="season-faces season-now-faces"', "</ul>");
    const shown = faces.match(/<li>/g)?.length ?? 0;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(10);
    expect(faces).toContain('href="/characters/');
    expect(now).toContain('class="button" href="/reunion"');
    expect(now).toContain('class="button-ghost" href="/watch"');
    const list = section(index, '<ol class="season-index"', "</ol>");
    const card = section(list, '<li class="card tap-card season-index-card"><p class="kicker">Season 1</p>', "</li>");
    expect(card).toContain('class="stretch" href="/seasons/october-2026">October 2026</a>');
    expect(card).toContain('class="pair-faces"');
    expect(card.match(/width="44"/g)).toHaveLength(2);
    expect(card).toContain("🏆 Golden couple");
    expect(card).toContain("<dt>dates aired</dt><dd>2</dd>");
    expect(card).toContain("<dt>pairings</dt><dd>2</dd>");
    expect(card).toContain("<dt>second dates</dt><dd>1</dd>");
    expect(card).toContain("The finale →");
  });
});
