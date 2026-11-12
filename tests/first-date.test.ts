import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { offerFirstDate, pickFirstPartner } from "@/lib/first-date";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// 2026-11-11 bounce review (David: "yes do 1-4"): of the month's visitors, 7 opened the builder, 3 made a character,
// 2 started a date and nobody watched one end. A first character now gets one button: a house date that plays at once.
const CAST = [
  { id: "house-juniper", name: "Juniper Vale", age: 29, bio: "b", traits: ["warm"], archetype: "The Romantic" },
  { id: "house-nell", name: "Nell Abiodun", age: 33, bio: "b", traits: ["dry"], archetype: "The Skeptic" },
  { id: "house-gold", name: "Goldie Premium", age: 30, bio: "b", traits: ["rich"], premium: true },
];
const TOKENS = { free_left: 3, free_per_season: 3, pack_left: 0, left: 3 };

describe("a newcomer's first date, straight away", () => {
  it("picks one of the season's cast, never a premium one, the same one on a reload", () => {
    const picks = new Set<string>();
    for (const id of Array.from({ length: 24 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)) {
      const p = pickFirstPartner(CAST, id);
      expect(p?.premium).toBeFalsy();
      expect(pickFirstPartner(CAST, id)?.id).toBe(p?.id);
      picks.add(p!.id);
    }
    expect(picks.size).toBe(2); // different newcomers meet different cast members
    expect(pickFirstPartner([CAST[2]], "x")).toBeNull();
    // A post's link names a house character (/create?meet=<id>): that one, but never a premium one or someone off the cast.
    expect(pickFirstPartner(CAST, "anyone", "house-juniper")?.id).toBe("house-juniper");
    expect(pickFirstPartner(CAST, "anyone", "house-nell")?.id).toBe("house-nell");
    expect(pickFirstPartner(CAST, "anyone", "house-gold")?.premium).toBeFalsy();
    expect(pickFirstPartner(CAST, "anyone", "not-on-cast")).toEqual(pickFirstPartner(CAST, "anyone"));
  });

  it("is offered only for a first character that's free to date and has a date left", () => {
    const base = { firstCharacter: true, taken: false, datesLeft: 3, partner: CAST[0] };
    expect(offerFirstDate(base)).toBe(true);
    expect(offerFirstDate({ ...base, firstCharacter: false })).toBe(false);
    expect(offerFirstDate({ ...base, taken: true })).toBe(false);
    expect(offerFirstDate({ ...base, datesLeft: 0 })).toBe(false);
    expect(offerFirstDate({ ...base, partner: null })).toBe(false);
  });

  it("the date step leads with one Start button for a first character, and keeps every other choice below", async () => {
    const { SendPhase } = await import("@/app/create/CreateWizard");
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
    const first = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: true }));
    expect(first).toContain("data-first-date");
    expect(first).toContain("Leopold&#x27;s first date can start right now");
    expect(first).toContain("▶ Start the date now");
    expect(first.indexOf("data-first-date")).toBeLessThan(first.indexOf("send-blind"));
    expect(first).toContain("Send Leopold Sol on a blind date"); // still there, below
    const card = first.slice(first.indexOf("data-first-date"), first.indexOf("send-blind"));
    expect(card).toContain("meets Nell");
    expect(card).not.toContain("Goldie");
    // A creator's second character gets the full menu as before.
    const later = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: false }));
    expect(later).not.toContain("data-first-date");
    // Out of dates: no instant date (it would only fail).
    const broke = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: true, tokens: { ...TOKENS, free_left: 0, left: 0 } }));
    expect(broke).not.toContain("data-first-date");
  });
});
