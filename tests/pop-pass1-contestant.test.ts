// The visual pop audit's first pass, part B (docs/audits/2026-11-20-visual-pop-audit.md): a character page's top as a
// contestant card (app/characters/[id]/page.tsx). Pinned here: the hello is the card's face and no longer sits under
// "Right now" as well, the place behind is a static picture that never competes with the page for the first paint,
// the counts are chips, and reduced motion holds everything still. The page's own behaviour (the header's actions, the
// ratings, the tabs) is covered by the character page's tests, which render it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import IntroClip from "@/app/characters/[id]/IntroClip";

const source = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = source("app/characters/[id]/page.tsx");
const css = source("app/ux/stage.css");

describe("the contestant card", () => {
  it("is one dark card: the place behind, the face, then the header as it was", () => {
    expect(page).toContain('"contestant contestant-card has-intro" : "contestant contestant-card"');
    expect(page).toMatch(/<div className="contestant-card-stage" aria-hidden="true">[\s\S]{0,300}<img src=\{backdrop\} alt="" width=\{1024\} height=\{576\} decoding="async" fetchPriority="low" \/>/);
    // The place of their latest aired date, else the stage.
    expect(page).toContain('const backdrop = (lastVenue && venueBackdrop(lastVenue)) || showSetPath("stage");');
    expect(page).toContain('<ul className="contestant-stats"');
  });

  it("plays the hello as the face, and only there", () => {
    expect(page).toContain("<IntroClip src={intro.url}");
    expect(page).not.toContain("intro-card");
    expect(css).not.toContain(".intro-card");
  });

  it("draws the hello with the portrait as its first paint, muted, and nothing loaded until it plays", () => {
    const html = renderToStaticMarkup(createElement(IntroClip, { src: "/api/cast-intro/i-1/intro.mp4", poster: "/cast/house-juniper-v5.webp", name: "Juniper" }));
    expect(html).toContain('<video muted="" loop="" playsInline="" preload="none" poster="/cast/house-juniper-v5.webp" aria-label="Juniper says hello">');
    // No buttons before the page is live, so nothing flashes; they arrive with the first play.
    expect(html).not.toContain("<button");
  });

  it("holds still under reduced motion, and starts complete", () => {
    const calm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(calm).toMatch(/\.contestant-card-stage img,[\s\S]{0,140}\{\s*animation: none;/);
    expect(css).not.toMatch(/opacity:\s*0[;\s]/);
  });
});
