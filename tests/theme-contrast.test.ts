import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the palette in app/globals.css (docs/brand.md, "Color"). It reads the real token blocks, so a future
// colour change that breaks WCAG 2.2 AA fails here instead of shipping: text tokens at 4.5:1 on every surface
// they sit on, control edges and focus rings at 3:1, in light, dark, and under prefers-contrast: more.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The custom properties declared in one block of the stylesheet, by its opening selector. */
function tokens(block: RegExp): Record<string, string> {
  const m = css.match(block);
  if (!m) throw new Error(`token block not found: ${block}`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((x) => [x[1], x[2]]));
}

const light = tokens(/^:root \{([\s\S]*?)\n\}/m);
const dark = { ...light, ...tokens(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n {2}\}/) };
const lightMore = { ...light, ...tokens(/@media \(prefers-contrast: more\) \{\s*:root \{([\s\S]*?)\n {2}\}/) };
const darkMore = { ...dark, ...tokens(/@media \(prefers-contrast: more\) and \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n {2}\}/) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every colour a piece of text can be set in, and every surface it can sit on.
const TEXT = ["ink", "muted", "accent-text", "accent-2", "ok-text", "bad-text", "warn"];
const SURFACES = ["paper", "paper-2", "card", "soft"];

describe("theme contrast (WCAG 2.2 AA)", () => {
  const themes = { light, dark, "light, prefers-contrast: more": lightMore, "dark, prefers-contrast: more": darkMore };

  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: text tokens clear 4.5:1 on every surface`, () => {
      for (const text of TEXT) for (const surface of SURFACES) {
        expect(ratio(t[text], t[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: control edges and focus rings clear 3:1`, () => {
      for (const edge of ["field", "focus"]) for (const surface of ["card", "paper"]) {
        expect(ratio(t[edge], t[surface]), `${edge} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${name}: label on the gradient clears 4.5:1 at both ends`, () => {
      for (const end of ["accent-btn", "accent-2"]) {
        expect(ratio(t["accent-ink"], t[end]), `accent-ink on ${end}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("type scale", () => {
  it("every text size token is fluid (clamp), so no step is a fixed size", () => {
    const sizes = [...css.matchAll(/--text-(\w+):\s*([^;]+);/g)].filter((m) => m[1] !== "base");
    expect(sizes.length).toBeGreaterThan(5);
    for (const [, name, value] of sizes) expect(value, `--text-${name}`).toMatch(/^clamp\(/);
  });

  it("the .small helper is defined, so secondary text in a paragraph is sized", () => {
    expect(css).toMatch(/\.small \{\s*font-size: var\(--text-sm\);/);
  });
});
