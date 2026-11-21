/**
 * The visual pop audit's last two rows: /about's pulse down the six layers (app/ux/company.css, scroll-tied) and
 * Marketing's funnel that draws itself above the log (lib/marketing-funnel.ts, app/marketing/MarketingFunnel.tsx).
 * Pure steps and renders, plus source reads for the wiring and the motion rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarketingFunnel from "@/app/marketing/MarketingFunnel";
import { funnelSteps, percentOf } from "@/lib/marketing-funnel";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const css = read("app", "ux", "company.css");
// The stylesheet with every motion block taken out: what someone who asked for less motion gets.
const atRest = (src: string) => {
  const parts = src.split(/@media \(prefers-reduced-motion: no-preference\) \{/);
  return parts[0] + parts.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
};

const live = { posts: 103, channels: 23, visitors: 48, created: 4, started: 2 };

describe("funnelSteps", () => {
  it("is posts, visitors, characters and dates on one scale, each with what it means", () => {
    const steps = funnelSteps(live)!;
    expect(steps.map((s) => s.key)).toEqual(["posts", "visitors", "created", "started"]);
    expect(steps.map((s) => s.value)).toEqual([103, 48, 4, 2]);
    expect(steps[0].share).toBe(1);
    expect(steps[1].share).toBeCloseTo(48 / 103);
    expect(steps.map((s) => s.note)).toEqual(["on 23 channels", "0.5 a post", "8.3% of visitors", "4.2% of visitors"]);
  });

  it("scales to the largest step, says nothing it can't work out, and is nothing before a post or a visitor", () => {
    const more = funnelSteps({ posts: 2, channels: 1, visitors: 40, created: 0, started: 0 })!;
    expect(more[1].share).toBe(1);
    expect(more[0].note).toBe("on 1 channel");
    expect(more[1].note).toBe("20 a post");
    expect(funnelSteps({ posts: 5, channels: 0, visitors: 0, created: 0, started: 0 })!.map((s) => s.note)).toEqual([null, "0 a post", null, null]);
    expect(funnelSteps({ posts: 0, channels: 0, visitors: 0, created: 0, started: 0 })).toBeNull();
  });

  it("prints a share as a person would", () => {
    expect(percentOf(4, 48)).toBe("8.3%");
    expect(percentOf(12, 48)).toBe("25%");
    expect(percentOf(2, 48)).toBe("4.2%");
    expect(percentOf(1, 100)).toBe("1%");
    expect(percentOf(0, 48)).toBe("0%");
  });
});

describe("the funnel at rest", () => {
  const html = renderToStaticMarkup(createElement(MarketingFunnel, { steps: funnelSteps({ ...live, started: 0 })! }));

  it("is complete as sent: every bar at its length, every figure and note in words", () => {
    expect(html).toContain('<figure class="marketing-funnel" data-draw="rest">');
    expect(html).toContain('<figcaption class="kicker">From a post to a date</figcaption>');
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toContain("--share:1;--n:0");
    expect(html).toContain("<strong>103</strong>");
    expect(html).toContain("8.3% of visitors");
    expect(html.match(/class="marketing-funnel-track" aria-hidden="true"/g)).toHaveLength(4);
    // A step at nothing draws no sliver.
    expect(html.match(/marketing-funnel-bar is-empty/g)).toHaveLength(1);
  });
});

describe("the wiring", () => {
  it("sits above the log, worked out on the server", () => {
    const page = read("app", "marketing", "page.tsx");
    expect(page).toContain("const funnel = m ? funnelSteps(m.totals) : null;");
    expect(page.indexOf("<MarketingFunnel steps={funnel} />")).toBeGreaterThan(page.indexOf("<Summary m={m} />"));
    expect(page.indexOf("<MarketingFunnel steps={funnel} />")).toBeLessThan(page.indexOf('<section id="posts">'));
    const client = read("app", "marketing", "MarketingFunnel.tsx");
    expect(client).toContain('import type { FunnelStep } from "@/lib/marketing-funnel";');
    expect(client).not.toMatch(/import \{[^}]*\} from "@\/lib\/marketing-funnel"/);
  });

  it("draws only where motion is welcome, holding the bars at nothing only once it knows they're off screen", () => {
    expect(atRest(css)).not.toMatch(/\.marketing-funnel[^{]*\{[^}]*(animation|scale:)/);
    expect(css).toMatch(/\.marketing-funnel\[data-draw="armed"\] \.marketing-funnel-bar \{\s*scale: 0 1;/);
    expect(css).toMatch(/\.marketing-funnel\[data-draw="go"\] \.marketing-funnel-bar \{\s*animation: fill-grow/);
  });
});

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
