import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { localWeeklyWords, nextWeeklyUtc, utcWeeklyWords } from "@/app/weekly-time";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// 2026-11-22 audit: a first date aired publicly by default (David's call, kept), but the card never said so and nothing
// offered another choice; the step said "… is ready" for month-old characters; its times read in UTC.
const CAST = [
  { id: "house-juniper", name: "Juniper Vale", age: 29, bio: "b", traits: ["warm"], archetype: "The Romantic" },
  { id: "house-nell", name: "Nell Abiodun", age: 33, bio: "b", traits: ["dry"], archetype: "The Skeptic" },
];
const TOKENS = { free_left: 3, free_per_season: 3, pack_left: 0, left: 3 };
const props = {
  character: { id: "c-new", name: "Leopold Sol" },
  partners: CAST,
  openCharacters: [],
  swipeGate: true,
  tokens: TOKENS,
  offer: null,
  autonomy: "balanced" as never,
  busy: null,
  setBusy() {},
  error: null,
  setError() {},
  outOfTokens: false,
  setOutOfTokens() {},
  onSend() {},
  returnTo: null,
  buildNext: null,
  signedIn: false,
};
const flat = (html: string) => html.replace(/&#x27;/g, "'");

describe("the date step says the date airs, and keeps it private with one tick", () => {
  it("the first-date card says it airs and offers Keep it private, above the Start button", async () => {
    const { SendPhase } = await import("@/app/create/CreateWizard");
    const html = flat(renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: true, justMade: true })));
    const card = html.slice(html.indexOf("data-first-date"), html.indexOf("send-blind"));
    expect(card).toContain("📺 It airs on the show: anyone can watch it.");
    expect(card).toMatch(/<input type="checkbox"[^>]*data-track="date-keep-private"/);
    expect(card).not.toMatch(/<input type="checkbox" checked=""[^>]*data-track="date-keep-private"/); // airs unless they tick it
    expect(card.indexOf("Keep it private")).toBeLessThan(card.indexOf("▶ Start the date now"));
    expect(html).toContain("Leopold Sol is ready");
  });

  it("one made earlier and sent from its page isn't 'ready': the step is sending it on a date", async () => {
    const { SendPhase } = await import("@/app/create/CreateWizard");
    const html = flat(renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: false })));
    expect(html).not.toContain("is ready");
    expect(html).toContain('<p class="kicker">Send on a date</p>');
    // The server's paint says the weekly time in UTC; the browser swaps in its own clock (app/weekly-time.ts).
    expect(html).toContain("free dates come back Monday at 00:00 UTC.");
    // No portrait yet: the line says it's being drawn (and the page asks for it until it comes).
    expect(html).toContain("portrait is being drawn, free");
    const drawn = flat(renderToStaticMarkup(createElement(SendPhase, { ...props, character: { ...props.character, portrait: "/api/assets/p1" }, firstCharacter: false })));
    expect(drawn).not.toContain("portrait is being drawn");
  });
});

describe("the show's weekly times in the viewer's own clock (app/weekly-time.ts)", () => {
  const words = (s: string) => s.replace(/\s/g, " ");
  it("finds the next one at or after now", () => {
    const sunday = new Date("2026-11-22T10:00:00Z");
    expect(nextWeeklyUtc(0, 23, 20, sunday).toISOString()).toBe("2026-11-22T23:20:00.000Z");
    expect(nextWeeklyUtc(0, 23, 20, new Date("2026-11-22T23:21:00Z")).toISOString()).toBe("2026-11-29T23:20:00.000Z");
    expect(nextWeeklyUtc(1, 0, 0, sunday).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("says it in UTC for the first paint, then in the viewer's zone, the day moving with it", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    expect(utcWeeklyWords(0, 23, 20)).toBe("Sunday at 23:20 UTC");
    expect(words(localWeeklyWords(0, 23, 20, { now, locale: "en-US", timeZone: "America/Los_Angeles" }))).toBe("Sunday at 3:20 PM");
    expect(words(localWeeklyWords(0, 23, 20, { now, locale: "en-US", timeZone: "Asia/Tokyo" }))).toBe("Monday at 8:20 AM");
    expect(words(localWeeklyWords(1, 0, 0, { now, locale: "en-US", timeZone: "America/Los_Angeles" }))).toBe("Sunday at 4:00 PM");
  });
});
