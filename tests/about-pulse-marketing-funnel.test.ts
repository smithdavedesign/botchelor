/**
 * The visual pop audit's last two rows: /about's pulse down the six layers (app/ux/company.css, scroll-tied) and
 * Marketing's funnel. The funnel went with the visitor numbers it drew, when /marketing was cut to a short page
 * (2026-11-22 audit; tests/public-marketing.test.ts), so the pulse is what's left here: source reads for its motion rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const css = read("app", "ux", "company.css");
// The stylesheet with every motion block taken out: what someone who asked for less motion gets.
const atRest = (src: string) => {
  const parts = src.split(/@media \(prefers-reduced-motion: no-preference\) \{/);
  return parts[0] + parts.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
};

describe("the pulse down /about's layers", () => {
  it("runs only with view timelines and motion welcome, tied to each layer's own scroll", () => {
    const block = css.slice(css.indexOf("@supports (animation-timeline: view())"));
    expect(block).toMatch(/^@supports \(animation-timeline: view\(\)\) \{\s*@media \(prefers-reduced-motion: no-preference\) \{\s*\.about-layers > li \{\s*view-timeline: --about-layer block;/);
    expect(block).toMatch(/\.about-layers > li \+ li::before \{[^}]*animation: about-pulse-run linear both;\s*animation-timeline: --about-layer;/);
    expect(atRest(css)).not.toMatch(/about-pulse-run linear|about-layer-land linear/);
  });

  it("keeps the line and arrow that were there, so the stack reads the same still", () => {
    expect(css).toMatch(/\.about-layers > li \+ li::before \{\s*content: "";[^}]*width: 2px;[^}]*background: linear-gradient\(var\(--accent\), var\(--accent-2\)\);/);
    expect(css).toMatch(/@keyframes about-layer-land \{\s*0%,\s*100% \{\s*outline-color: transparent;/);
  });
});
