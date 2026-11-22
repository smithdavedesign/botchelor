// The visual pop audit's leftovers (2026-11-21): portrait cards that lean, the figures that count up on Agents and
// Reviews, the contestant card's phone gap, and the couple page's columns ending together.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoupleMain from "@/app/couples/[a]/[b]/CoupleMain";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the visual pop audit's leftovers", () => {
  it("leans the portrait cards on Companion, Casting and Showcase toward the pointer", () => {
    expect(read("app/companion/CompanionBrowser.tsx")).toContain('<Tilt as="li" className="companion-tile"');
    const casting = read("app/casting/page.tsx");
    expect(casting).toContain('<Tilt as="li" className="casting-slot is-taken is-lead tap-card"');
    expect(casting).toContain('<Tilt as="li" key={c.id} className="casting-slot is-taken tap-card"');
    expect(read("app/showcase/ShowcaseFeature.tsx")).toContain('<Tilt as="li" key={a.id}');
  });

  it("counts up the Agents figures and the Reviews stage's visitors and average, with the real number in the page", () => {
    const agents = read("app/agents/page.tsx");
    for (const k of ["agents", "agent_characters", "open_to_dates", "agent_dates"]) expect(agents).toContain(`<CountUp value={stats.${k}} />`);
    const reviews = read("app/BotReviews.tsx");
    expect(reviews).toContain("<CountUp value={view.visitors} />");
    expect(reviews).toContain("<CountUp value={view.average}");
  });

  it("closes the contestant card's phone gap: no margins on its lines, and three rows for the face without a job line", () => {
    const css = bare(read("app/ux/stage.css"));
    const phone = css.slice(css.indexOf("@media (max-width: 560px)"));
    expect(phone).toMatch(/\.contestant-card \.meta > p:is\(\.kicker, \.muted, \.contestant-job\) \{\s*margin-block: 0;/);
    expect(phone).toMatch(/\.contestant-card:not\(:has\(\.contestant-job\)\) \.contestant-card-face \{\s*grid-row: 1 \/ span 3;/);
  });

  it("renders the couple's dates column unpinned until the browser has measured both columns", () => {
    const html = renderToStaticMarkup(createElement(CoupleMain, null, createElement("p", null, "Their dates")));
    expect(html).toBe('<div class="couple-main"><p>Their dates</p></div>');
    expect(read("app/couples/[a]/[b]/page.tsx")).toMatch(/<CoupleMain>[\s\S]*<\/CoupleMain>\s*<aside className="couple-rail"/);
    expect(bare(read("app/ux/show.css"))).toMatch(/\.couple-main\.is-pinned \{\s*position: sticky;\s*top: var\(--pin-top, 5rem\);/);
  });
});
