/**
 * /create's example card as three of the house cast taking turns (lib/house-deck.ts, app/create/HouseDeck.tsx; the
 * visual pop audit's leftovers): real people from the show with their portraits instead of an "MV" in a circle, a strip
 * of their faces on a phone's first step, and the turn only where motion is welcome. Pure renders and source reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DeckPreview from "@/app/create/DeckPreview";
import HouseDeck, { firstNames, HouseStrip } from "@/app/create/HouseDeck";
import { HOUSE_DECK_IDS, houseDeckCards } from "@/lib/house-deck";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const cards = houseDeckCards();
const base = { seed: "preview", name: "", age: "", hue: 0, portrait: null, bio: "", want: "", extras: {} };

describe("houseDeckCards", () => {
  it("is Juniper, Dex and Sable from the house, each with a committed portrait", () => {
    expect(cards.map((c) => c.id)).toEqual([...HOUSE_DECK_IDS]);
    expect(cards.map((c) => c.name)).toEqual(["Juniper Vale", "Dex Okafor", "Sable Quist"]);
    for (const c of cards) {
      expect(c.portrait, c.id).toMatch(/^\/cast\/house-[a-z]+-v\d+\.webp$/);
      expect(existsSync(join(root, "public", c.portrait ?? "")), c.id).toBe(true);
      expect(c.traits).toHaveLength(3);
    }
  });
});

describe("the house deck beside an empty form", () => {
  const html = renderToStaticMarkup(createElement(DeckPreview, { ...base, examples: cards }));

  it("shows the three as the deck shows a card, tagged as the house's, Juniper in front", () => {
    // In a visitor's words (2026-11-22 audit): "the deck" and "the house" are ours.
    expect(html).toContain('<aside class="wizard-deck" aria-label="How others will see them">');
    expect(html).toContain('<p class="kicker">How others will see them</p>');
    expect(html.match(/On the show/g)).toHaveLength(3);
    expect(html).not.toMatch(/How the deck sees them|From the house|house cast/);
    expect(html).toMatch(/<div class="swipe-card wizard-deck-card house-deck-card is-front">.*?Juniper Vale/s);
    expect(html).toContain('house-deck-card is-next" aria-hidden="true"');
    expect(html).toContain('house-deck-card is-back" aria-hidden="true"');
    expect(html).toContain('src="/cast/house-juniper-');
    expect(html).toContain("Three characters already on the show. Yours appears here as you type.");
    // Not the made-up example any more.
    expect(html).not.toContain("Marisol Vane");
  });

  it("gives way to their own card as soon as something is typed into the sheet", () => {
    const own = renderToStaticMarkup(createElement(DeckPreview, { ...base, examples: cards, name: "Wren" }));
    expect(own).not.toContain("house-deck");
    expect(own).toContain("Wren");
  });

  it("reads out only the card in front", () => {
    const deck = renderToStaticMarkup(createElement(HouseDeck, { cards }));
    expect(deck.match(/aria-hidden="true"><span class="badge/g)).toHaveLength(2);
  });
});

describe("the phone's strip", () => {
  it("names the three and shows their faces, hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(HouseStrip, { cards }));
    expect(html).toContain('<span class="house-strip-faces" aria-hidden="true">');
    expect(html).toContain("Juniper, Dex and Sable are on the show. Yours is a sentence away.");
    expect(renderToStaticMarkup(createElement(HouseStrip, { cards: [] }))).toBe("");
  });

  it("joins first names as a sentence does", () => {
    expect(firstNames([{ name: "Juniper Vale" }])).toBe("Juniper");
    expect(firstNames([{ name: "Juniper Vale" }, { name: "Dex Okafor" }])).toBe("Juniper and Dex");
  });
});

describe("the wiring", () => {
  it("builds the cards on the server, so the client never carries the whole cast", () => {
    expect(read("app", "create", "page.tsx")).toContain("houseDeck={houseDeckCards()}");
    for (const f of ["HouseDeck.tsx", "DeckPreview.tsx", "CreateWizard.tsx"]) {
      const src = read("app", "create", f);
      expect(src, f).not.toMatch(/from "@\/lib\/house"/);
      expect(src, f).not.toMatch(/import \{[^}]*\} from "@\/lib\/house-deck"/);
    }
  });

  it("stops the turn while they type their sentence, and never shows the house cards while editing", () => {
    const wizard = read("app", "create", "CreateWizard.tsx");
    expect(wizard).toContain("examples={edit ? [] : houseDeck}");
    expect(wizard).toContain("typing={expressOpen && expressText.trim().length > 0}");
    expect(wizard).toContain("{!edit && step === S.identity && <HouseStrip cards={houseDeck} />}");
  });

  it("only moves where motion is welcome, and hides the strip beside the deck", () => {
    const css = read("app", "ux", "create.css");
    const parts = css.split("@media (prefers-reduced-motion: no-preference)");
    const atRest = parts[0] + parts.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
    expect(atRest).not.toMatch(/\.house-deck[^{]*\{[^}]*(transition|animation)/);
    expect(css).toMatch(/\.house-deck-card\.is-front \{\s*animation: house-deck-turn/);
    expect(css).toMatch(/@media \(min-width: 60rem\) \{[^@]*\.house-strip \{\s*display: none;/);
  });
});
