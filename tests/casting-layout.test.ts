// The casting page as the design system draws it (all-screens board, 2026-11-11): the auditions, and beside them how a
// character gets in, in the numbers lib/season-cast.ts actually uses.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import CastingPage from "@/app/casting/page";
import { AUDITION_MIN_DATES } from "@/lib/auditions";
import { HOUSE_MIN, SURVIVORS, seasonCastSize } from "@/lib/season-cast";
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

describe("/casting", () => {
  it("is a wide page: the auditions, and a rail with the rules and the call to put one up", async () => {
    const html = renderToStaticMarkup(await CastingPage());
    expect(html).toContain('<article class="casting-page page-wide">');
    const main = html.indexOf('<div class="casting-main">');
    const rail = html.indexOf('<aside class="casting-rail"');
    expect(main).toBeGreaterThan(-1);
    expect(rail).toBeGreaterThan(main);
    expect(html.slice(main, rail)).toContain("No auditions yet");
    expect(html.slice(rail)).toContain("How a character gets in");
    expect(html.slice(rail)).toContain("Got a character?");
  });

  it("states the rules in the numbers the cast is picked by", async () => {
    const html = renderToStaticMarkup(await CastingPage());
    const rules = html.slice(html.indexOf("How a character gets in"));
    expect(rules).toContain(`<strong>${seasonCastSize()} places</strong>`);
    expect(rules).toContain(`<strong>${SURVIVORS} most loved</strong>`);
    expect(rules).toContain(`up to ${Math.max(0, seasonCastSize() - HOUSE_MIN)} of the open places`);
    expect(rules).toContain(`${AUDITION_MIN_DATES} public dates first`);
  });
});
