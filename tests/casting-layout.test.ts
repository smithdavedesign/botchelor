// The casting page as the design system draws it (all-screens board, 2026-11-11): the auditions, and beside them how a
// character gets in, in the numbers lib/season-cast.ts actually uses. With no auditions yet (the thin pages' lift,
// 2026-11-13) the main column shows the places as slots: this month's cast in the taken ones, the open places dashed,
// and one button: make a character, or your own characters when you have one.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import CastingPage from "@/app/casting/page";
import { AUDITION_MIN_DATES } from "@/lib/auditions";
import { HOUSE_MIN, SURVIVORS, seasonCastCards, seasonCastSize } from "@/lib/season-cast";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

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
});
afterEach(() => vi.restoreAllMocks());

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The main column's markup, and the rail's. */
const columns = (html: string) => {
  const main = html.indexOf('<div class="casting-main">');
  const rail = html.indexOf('<aside class="casting-rail"');
  expect(main).toBeGreaterThan(-1);
  expect(rail).toBeGreaterThan(main);
  return { main: html.slice(main, rail), rail: html.slice(rail) };
};

describe("/casting", () => {
  it("is a wide page: the auditions, and a rail with the rules and the call to put one up", async () => {
    const html = renderToStaticMarkup(await CastingPage());
    expect(html).toContain('<article class="casting-page page-wide">');
    const { main, rail } = columns(html);
    expect(main).toContain("No auditions yet");
    expect(rail).toContain("How a character gets in");
    expect(rail).toContain("Got a character?");
    // The rail's own button stays as it was, for everyone.
    expect(rail).toContain('class="button secondary small" href="/account">Your characters');
  });

  it("states the rules in the numbers the cast is picked by", async () => {
    const html = renderToStaticMarkup(await CastingPage());
    const rules = html.slice(html.indexOf("How a character gets in"));
    expect(rules).toContain(`<strong>${seasonCastSize()} places</strong>`);
    expect(rules).toContain(`<strong>${SURVIVORS} most loved</strong>`);
    expect(rules).toContain(`up to ${Math.max(0, seasonCastSize() - HOUSE_MIN)} of the open places`);
    expect(rules).toContain(`${AUDITION_MIN_DATES} public dates first`);
  });

  it("with no auditions, the main column is the places as slots: this month's cast, the open places, one button to make a character", async () => {
    const size = seasonCastSize();
    const open = Math.max(0, size - HOUSE_MIN);
    const cast = await seasonCastCards(t.db);
    expect(cast.length).toBeGreaterThan(0);
    const { main } = columns(renderToStaticMarkup(await CastingPage()));
    expect(main).toContain('class="casting-slots"');
    expect(count(main, 'class="casting-slot is-taken tap-card"')).toBe(Math.min(cast.length, size));
    expect(count(main, 'class="casting-slot is-open"')).toBe(open);
    for (const c of cast.slice(0, size)) {
      expect(main).toContain(`class="stretch" href="/characters/${c.id}"`);
      expect(main).toContain(`<strong>${c.name}</strong>`);
    }
    expect(main).toContain("avatar");
    expect(main).toContain("<strong>Open</strong>");
    expect(main).toContain("your character?");
    // The one step for a visitor with no characters: make one. The words that were there before stay too.
    expect(main).toContain('data-track="casting-empty-create" href="/create"');
    expect(main).toContain("Make a character to audition");
    expect(main).not.toContain('data-track="casting-empty-yours"');
    expect(main).toContain("No auditions yet for");
    expect(main).toContain("<em>Audition</em>");
  });

  it("a viewer who has a character is sent to their own characters instead", async () => {
    const cookie = newUserCookie();
    expect((await api.createCharacter(validCharacter(), cookie)).status).toBe(201);
    const [name, value] = cookie.split("=");
    jar.cookies.set(name, value);
    const { main, rail } = columns(renderToStaticMarkup(await CastingPage()));
    expect(main).toContain('data-track="casting-empty-yours" href="/account"');
    expect(main).toContain(">Your characters</a>");
    expect(main).not.toContain('data-track="casting-empty-create"');
    expect(count(main, 'class="casting-slot is-open"')).toBe(Math.max(0, seasonCastSize() - HOUSE_MIN));
    expect(rail).toContain('class="button secondary small" href="/account">Your characters');
  });
});
