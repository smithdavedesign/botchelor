/**
 * Home's stage, pass 3 of the visual pop audit: dust drifting in the two spotlight beams, the stage's night run on under
 * the next section, and the camera pushing in on a Just aired card. Set dressing only, complete at rest, moving only
 * where motion is welcome. Pure renders and the stylesheets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomeOpen from "@/app/HomeOpen";

const root = join(__dirname, "..");
const front = readFileSync(join(root, "app", "ux", "front.css"), "utf8");
const catalog = readFileSync(join(root, "app", "ux", "catalog.css"), "utf8");

/** A stylesheet with its no-preference blocks taken out: what everyone gets, reduced motion included. */
const atRest = (css: string) => {
  const parts = css.split("@media (prefers-reduced-motion: no-preference)");
  return parts[0] + parts.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
};

const html = renderToStaticMarkup(createElement(HomeOpen, { kicker: null, line: [], tonight: null, latest: null, watch: { href: "/watch", label: "Watch a date" }, next: null }));

describe("the dust in the beams", () => {
  it("is set dressing over the stage: two beams, hidden from screen readers, before the words", () => {
    expect(html).toMatch(/<div class="home-open-scrim" aria-hidden="true"><\/div><div class="home-open-dust" aria-hidden="true"><span class="home-open-beam is-left"><i><\/i><\/span><span class="home-open-beam is-right"><i><\/i><\/span><\/div><div class="home-open-body">/);
  });

  it("drifts only where motion is welcome, as a transform, and loops on the specks' own tile", () => {
    expect(atRest(front)).not.toMatch(/\.home-open-beam[^{]*\{[^}]*animation/);
    expect(front).toMatch(/\.home-open-beam > i \{\s*animation: home-dust-fall/);
    expect(front).toMatch(/@keyframes home-dust-fall \{\s*to \{\s*transform: translate3d\(0, 160px, 0\);/);
    // Every speck layer's height divides the fall, so the loop has no seam.
    const sizes = front.match(/background-size: (62px 80px, 96px 160px, 46px 80px, 120px 160px);/)?.[1] ?? "";
    expect(sizes).not.toBe("");
    for (const h of sizes.split(",").map((s) => Number(s.trim().split(" ")[1].replace("px", "")))) expect(160 % h).toBe(0);
  });
});

describe("the night run on", () => {
  it("follows the stage, hidden, and the next section paints over it", () => {
    expect(html).toMatch(/<\/section><div class="home-open-tail" aria-hidden="true"><\/div>$/);
    expect(front).toMatch(/\.home-open-tail \+ \* \{\s*position: relative;/);
    expect(front).toMatch(/\.home-open:has\(\+ \.home-open-tail\) \{\s*margin-bottom: 0;/);
    // The gap to the next section stays the stage's old margin.
    expect(front).toMatch(/margin: 0 0 calc\(var\(--space-6\) - 16rem\) calc\(50% - 50vw\);/);
  });
});

describe("the Just aired push-in", () => {
  it("scales the venue on hover or focus, only where motion is welcome", () => {
    expect(atRest(catalog)).not.toMatch(/\.episode-shelf-photo \{[^}]*transition/);
    expect(catalog).toMatch(/\.episode-shelf-card:has\(\.stretch:hover\) \.episode-shelf-photo,\s*\.episode-shelf-card:has\(\.stretch:focus-visible\) \.episode-shelf-photo \{\s*transform: scale\(1\.07\);/);
  });
});
