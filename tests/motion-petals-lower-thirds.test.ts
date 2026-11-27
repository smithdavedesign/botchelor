import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Petals from "@/app/motion/Petals";

const ROOT = join(__dirname, "..");
const css = readFileSync(join(ROOT, "app/ux/motion.css"), "utf8");

describe("rose petals (app/motion/Petals.tsx)", () => {
  it("is a decorative layer of a dozen petals, the same on every render", () => {
    const html = renderToStaticMarkup(createElement(Petals, { delay: 1 }));
    expect(html.startsWith('<span class="petals" aria-hidden="true">')).toBe(true);
    expect(html.match(/class="petal"/g)).toHaveLength(12);
    // The delay offsets every petal (the first falls at exactly the delay).
    expect(html).toContain("--d:1s");
    expect(renderToStaticMarkup(createElement(Petals, { delay: 1 }))).toBe(html);
  });

  it("never shows under reduced motion and never takes a click", () => {
    // Hidden by default; shown only inside the no-preference block.
    expect(css).toMatch(/\.petals \{[^}]*display: none;/);
    const shown = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .petals {"));
    expect(shown).toMatch(/\.petals \{[^}]*display: block;[^}]*pointer-events: none;/);
  });
});

describe("where the new motion lands", () => {
  it("Sunday's reveal drops petals as the card lifts, and the ship's top pick under its stamp", () => {
    expect(readFileSync(join(ROOT, "app/Reveal.tsx"), "utf8")).toContain("{petals && <Petals delay={1.1} />}");
    expect(readFileSync(join(ROOT, "app/ship/[a]/[b]/page.tsx"), "utf8")).toContain("{i === 0 && <Petals delay={1.95} />}");
  });

  it("the contestant card names its face with a lower third the heading already says (aria-hidden)", () => {
    expect(readFileSync(join(ROOT, "app/characters/[id]/page.tsx"), "utf8")).toMatch(/<span className="lower-third" aria-hidden="true">/);
  });

  it("the set parallax and the title card only run with motion allowed, and parallax only with view timelines", () => {
    const parallax = css.slice(css.indexOf("Parallax on the sets"));
    expect(parallax).toMatch(/@supports \(animation-timeline: view\(\)\) \{\s*@media \(prefers-reduced-motion: no-preference\)/);
    const title = css.slice(css.indexOf("Title cards on the sets"));
    expect(title).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.set-hero h1/);
  });
});
