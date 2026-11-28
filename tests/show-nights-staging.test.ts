import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CeremonyReveal from "@/app/watch/CeremonyReveal";
import { ogFonts } from "@/lib/og-type";

// Show nights, staged (2026-11-27, Dave: "push the limits to the max, go wild"): app/ux/show-nights.css and the share
// cards' type (lib/og-type.tsx).
const ROOT = join(__dirname, "..");
const css = readFileSync(join(ROOT, "app/ux/show-nights.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet with every `@media (prefers-reduced-motion: no-preference) { … }` block cut out. */
function outsideMotionBlocks(text: string): string {
  let out = "";
  let i = 0;
  const open = "@media (prefers-reduced-motion: no-preference)";
  while (i < text.length) {
    const at = text.indexOf(open, i);
    if (at < 0) return out + text.slice(i);
    out += text.slice(i, at);
    let j = text.indexOf("{", at);
    let depth = 0;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

const face = (id: string, name: string) => ({ id, name, hue: 300, portrait: null, house: false });
const night = {
  held_on: "2026-12-06",
  week: 1,
  finale: false,
  lines: ["The candles are lit."],
  kept: [face("a", "Juniper Vale"), face("b", "Dex Marlow")],
  voted_out: null,
  lead_out: face("c", "Sable Rook"),
  final_rose: null,
  runners_up: [],
  exits: [{ id: "c", by: "lead" as const, lines: ["I came here for something real."] }],
};

describe("show nights, staged", () => {
  it("moves nothing outside a no-preference block: under reduced motion each surface keeps its look, still", () => {
    expect(outsideMotionBlocks(css)).not.toMatch(/(^|[\s;{])(animation|transition)\s*:/);
  });

  it("the ceremony hands out the show's rose icon, a medallion per rose and a pip per rose, and no emoji", () => {
    const html = renderToStaticMarkup(createElement(CeremonyReveal, { last: night, staged: false }));
    expect(html).not.toContain("🌹");
    expect(html).toContain('class="ceremony-rose"');
    expect(html).toContain('class="ceremony-pips"');
    expect(html).toContain("ceremony-limo-lights");
    // Not played: no entrance, no petals (a viewer who has seen it gets the night at once).
    expect(html).not.toContain("data-played");
    expect(html).not.toContain('class="petals"');
  });

  it("the share cards' fonts read from assets/fonts: Inter and the title-card Fraunces", async () => {
    const fonts = await ogFonts();
    expect(fonts.map((f) => `${f.name} ${f.weight} ${f.style}`)).toEqual(["Inter 500 normal", "Inter 800 normal", "Fraunces 800 normal", "Fraunces 600 italic"]);
    expect(fonts.every((f) => f.data.length > 10_000)).toBe(true);
  });
});
