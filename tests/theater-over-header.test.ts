/**
 * The episode's theater over the site (2026-11-22 audit). The sticky site header painted over the open theater's Exit and
 * names (the episode hero, which holds the theater, had become a stacking context), and the creator's verdict card,
 * centred on the stage, started above a 1280×900 window with its ending line, translucent over the stage's bubbles.
 * Source reads of the stylesheet, as the other layout tests do; the live check is a browser's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const css = read("app/globals.css");

/** Every block written for exactly this selector, as text. */
function blocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, "g"))].map((m) => m[1]);
}

describe("the open theater sits over the site's header", () => {
  it("is rendered inside the episode hero, fixed and above the sticky header", () => {
    expect(read("app/episodes/[id]/page.tsx")).toMatch(/<div className="episode-hero-cta">\s*\{hasTheater && episode\.ending && episode\.transcript \? \(\s*<EpisodeTheater/);
    expect(blocks(".theater")[0]).toMatch(/position: fixed;\s*inset: 0;\s*z-index: 200;/);
    expect(blocks(".site-header")[0]).toMatch(/position: sticky;\s*top: 0;\s*z-index: 20;/);
  });

  it("so the hero stops isolating while a theater is open in it, and only then (its camera layer needs it otherwise)", () => {
    expect(css).toMatch(/\.episode-hero \{\s*overflow: hidden;\s*isolation: isolate;\s*\}/);
    expect(blocks(".episode-hero:has(.theater)")).toEqual([expect.stringMatching(/^\s*isolation: auto;\s*$/)]);
    // Nothing else on the hero makes a stacking context of its own.
    for (const block of blocks(".episode-hero")) expect(block).not.toMatch(/\b(z-index|transform|filter|will-change|contain|opacity):/);
  });
});

describe("the creator's verdict card", () => {
  const card = blocks(".verdict-card");

  it("hangs just under the title bar on a wide screen, stops clear of the transport and scrolls inside", () => {
    expect(card).toHaveLength(1);
    expect(card[0]).toContain("top: 4.5rem;");
    expect(card[0]).toContain("transform: translateX(-50%);");
    expect(card[0]).toContain("max-height: calc(100% - 10.5rem);");
    expect(card[0]).toContain("overflow-y: auto;");
    // Not centred on the stage any more (top 34%, translate -50% -50%), which pushed a tall card off the top.
    expect(card[0]).not.toContain("translate(-50%, -50%)");
  });

  it("on a phone, sits at the foot of the screen and keeps clear of the title bar over the scene banner", () => {
    const phone = blocks(".theater-stage .verdict-card");
    expect(phone).toHaveLength(1);
    expect(phone[0]).toMatch(/top: auto;\s*bottom: calc\(var\(--space-3\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(phone[0]).toContain("max-height: calc(100% - 8rem);");
  });

  it("is solid, as is the replay's bare ending, so the bubbles behind don't read through", () => {
    expect(card[0]).toMatch(/background: rgb\(12, 8, 16\);\s*backdrop-filter: none;/);
    expect(blocks(".theater-replay .theater-verdict")).toEqual([expect.stringMatching(/^\s*background: rgb\(12, 8, 16\);\s*backdrop-filter: none;\s*$/)]);
  });
});
