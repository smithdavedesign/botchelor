import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DeckPreview from "@/app/create/DeckPreview";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// "How the deck sees them" beside the creator (the design system's create screen, 2026-11-11): the card someone will
// swipe on, built from the swipe deck's own parts, filling in as the sheet does.
describe("the creator's deck preview", () => {
  const base = { seed: "preview", name: "", age: "", hue: 0, portrait: null, bio: "", want: "", extras: {} };

  // 2026-11-14 design audit: an empty form previewed a blue "?" and stand-ins. Now the example character, greyed and
  // tagged Example, until something is typed; then their own card, with stand-ins where parts are still empty.
  it("starts as the example character, tagged Example, in the deck's own classes", () => {
    const html = renderToStaticMarkup(createElement(DeckPreview, base));
    expect(html).toContain('<aside class="wizard-deck" aria-label="How the deck sees them">');
    expect(html).toContain('class="swipe-card wizard-deck-card wizard-deck-example"');
    expect(html).toContain('<span class="badge wizard-deck-example-tag">Example</span>');
    expect(html).toContain('<h2 class="swipe-name">Marisol Vane<span class="swipe-age">, 31</span></h2>');
    expect(html).not.toContain("Your character");
  });

  it("switches to their own card, stand-ins and all, as soon as a name is typed", () => {
    const html = renderToStaticMarkup(createElement(DeckPreview, { ...base, name: "J" }));
    expect(html).not.toContain("wizard-deck-example");
    expect(html).not.toContain("Marisol");
    expect(html).toContain('class="swipe-card wizard-deck-card"');
    expect(html).toContain('<h2 class="swipe-name">J</h2>');
    expect(html).toContain('<p class="swipe-bio muted">A short bio goes here.</p>');
    expect(html).toContain("what they want from a date");
    // Anything typed counts, not only a name: a bio alone is theirs, under "Your character".
    const bioOnly = renderToStaticMarkup(createElement(DeckPreview, { ...base, bio: "Collects umbrellas." }));
    expect(bioOnly).toContain('<h2 class="swipe-name">Your character</h2>');
    expect(bioOnly).not.toContain("wizard-deck-example");
  });

  it("shows what's typed: name, age, job and hometown, bio, answered prompts, interests, what they're looking for", () => {
    const html = renderToStaticMarkup(
      createElement(DeckPreview, {
        ...base,
        name: "Juno Marlowe",
        age: "28",
        bio: "A tarot reader who only predicts the weather.",
        want: "Someone who'll dance in the rain",
        extras: {
          occupation: "Tarot reader",
          hometown: "Brighton",
          prompts: [
            { id: "geek_out", answer: "Cloud types." },
            { id: "together_we_could", answer: "  " },
          ],
          hobbies: ["Tarot", "Weather watching"],
        },
      }),
    );
    expect(html).toContain('Juno Marlowe<span class="swipe-age">, 28</span>');
    expect(html).toContain('<p class="swipe-job">Tarot reader · Brighton</p>');
    expect(html).toContain('<p class="swipe-bio">A tarot reader who only predicts the weather.</p>');
    expect(html).toContain('<p class="swipe-prompt-a">Cloud types.</p>');
    expect(html.match(/class="swipe-prompt"/g)).toHaveLength(1);
    expect(html).toContain('<li class="chip">Weather watching</li>');
    expect(html).toContain("<strong>Looking for:</strong> Someone who&#x27;ll dance in the rain");
  });

  it("sits beside the form in the wizard, after it in the markup", async () => {
    const { default: CreateWizard } = await import("@/app/create/CreateWizard");
    const html = renderToStaticMarkup(createElement(CreateWizard, {}));
    expect(html).toMatch(/<article class="wizard has-deck">\s*<div class="wizard-main">/);
    expect(html.indexOf('<aside class="wizard-deck"')).toBeGreaterThan(html.indexOf("</form>"));
  });
});
