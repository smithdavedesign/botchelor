import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CountUp, { countText } from "@/app/motion/CountUp";
import Tilt from "@/app/motion/Tilt";

const ROOT = join(__dirname, "..");
const css = readFileSync(join(ROOT, "app/ux/motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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

describe("the motion kit (app/ux/motion.css, pass 2 of the visual pop audit)", () => {
  it("runs nothing for someone who prefers no motion: every animation and transition sits in a no-preference block", () => {
    const rest = outsideMotionBlocks(css);
    expect(rest).not.toMatch(/(^|[;{\s])animation(-[a-z]+)?\s*:/);
    expect(rest).not.toMatch(/(^|[;{\s])transition(-[a-z]+)?\s*:/);
    expect(rest).not.toMatch(/(^|[;{\s])transform\s*:/);
  });

  it("ties scroll-driven pieces to browsers that have view timelines", () => {
    const supports = css.indexOf("@supports (animation-timeline: view())");
    expect(supports).toBeGreaterThan(0);
    for (const m of css.matchAll(/animation-timeline:\s*view\(\)/g)) expect(m.index!).toBeGreaterThan(supports);
  });

  // With a backwards fill every card under the fold sat at the start's quarter opacity, so a contrast check, a
  // full-page picture or a reader's tool met it faded (2026-11-22 audit: /tools, an episode's lines). Forwards only:
  // below the fold a card is itself until it starts to come into view.
  it("rises in with a forwards fill, so a card below the fold is at full strength", () => {
    const uses = [css, readFileSync(join(ROOT, "app/globals.css"), "utf8")].flatMap((text) => [...text.matchAll(/animation:\s*rise-in\b[^;]*;/g)].map((m) => m[0]));
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const use of uses) {
      expect(use).toMatch(/\bforwards\b/);
      expect(use).not.toMatch(/\b(both|backwards)\b/);
    }
  });

  it("is loaded on every page", () => {
    expect(readFileSync(join(ROOT, "app/layout.tsx"), "utf8")).toContain('import "./ux/motion.css";');
  });
});

describe("CountUp", () => {
  it("prints figures the way the pages do", () => {
    expect(countText(600.63, 2, "$")).toBe("$600.63");
    expect(countText(1234)).toBe("1,234");
    expect(countText(0, 0, "$")).toBe("$0");
    expect(countText(48.2, 0)).toBe("48");
  });

  it("has the real figure in the HTML, once, with the width held by the final text", () => {
    const html = renderToStaticMarkup(createElement(CountUp, { value: 600.63, decimals: 2, prefix: "$" }));
    expect(html).toBe('<span class="count-up" data-final="$600.63"><span>$600.63</span></span>');
    expect(html.match(/\$600\.63</g)).toHaveLength(1);
  });
});

describe("Tilt", () => {
  it("wraps its card without changing it at rest", () => {
    const html = renderToStaticMarkup(createElement(Tilt, { className: "award", as: "li", children: "Barnaby" }));
    expect(html).toBe('<li class="award tilt">Barnaby</li>');
  });
});
