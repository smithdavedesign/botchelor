// The visual pop audit's first pass (docs/audits/2026-11-20-visual-pop-audit.md): the set hero on the marketing pages,
// the house ribbon, and the videos moved to the top. Pinned here: the band's shape and its one eager picture, the
// ribbon's copy kept out of reach of screen readers and the keyboard, PG portraits only, and reduced motion's stills.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FaceRibbon, { HOUSE_RIBBON, ribbonName } from "@/app/FaceRibbon";
import SetHero from "@/app/SetHero";
import { SHOW_SETS } from "@/lib/show-sets";

const css = readFileSync(join(process.cwd(), "app", "ux", "stage.css"), "utf8");
const source = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("SetHero", () => {
  it("is a band on a set: the page's own kicker, h1 and lede, and the set as its one eager picture", () => {
    const html = renderToStaticMarkup(createElement(SetHero, { set: "booth", kicker: "Plans and packs", title: "Pricing", lede: "The show is free." }));
    // React hoists a preload for the high-priority picture into the head, so the set is fetched with the HTML.
    expect(html).toMatch(/^<link rel="preload" as="image" href="\/cast\/set-booth-v3\.webp" fetchPriority="high"\/><header class="set-hero set-hero--booth is-flush" data-set="booth">/);
    expect(html).toContain('<img class="set-hero-art" src="/cast/set-booth-v3.webp" alt="" width="1024" height="576" decoding="async" fetchPriority="high"/>');
    expect(html).toContain('<p class="kicker">Plans and packs</p><h1>Pricing</h1><p class="lede">The show is free.</p>');
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toContain("set-hero-media");
  });

  it("takes a media slot beside the words, and keeps its distance when it isn't first on the page", () => {
    const html = renderToStaticMarkup(createElement(SetHero, { set: "stage", title: "Press kit", media: createElement("i", null, "clip"), flush: false }));
    expect(html).toContain('<header class="set-hero set-hero--stage has-media" data-set="stage">');
    expect(html).toContain('<div class="set-hero-media"><i>clip</i></div>');
  });

  it("draws every set from a file that's on disk", () => {
    for (const set of SHOW_SETS) expect(existsSync(join(process.cwd(), "public", "cast", `set-${set}-v3.webp`)), set).toBe(true);
  });

  it("is still under reduced motion, and starts complete: nothing waits at opacity 0", () => {
    const calm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(calm).toMatch(/\.set-hero-art \{\s*animation: none;/);
    expect(css).not.toMatch(/opacity:\s*0[;\s]/);
  });
});

describe("FaceRibbon", () => {
  const html = renderToStaticMarkup(createElement(FaceRibbon, { title: "Who they'll meet" }));

  it("shows the eighteen house faces, each a link to their page, from the committed house-look portraits", () => {
    expect(HOUSE_RIBBON).toHaveLength(18);
    for (const f of HOUSE_RIBBON) {
      expect(f.src, f.id).toMatch(/^\/cast\/house-[a-z]+-v5\.webp$/);
      expect(existsSync(join(process.cwd(), "public", f.src)), f.src).toBe(true);
    }
    expect(new Set(HOUSE_RIBBON.map((f) => f.id)).size).toBe(18);
    expect(html).toContain('<section class="face-ribbon" aria-label="Who they&#x27;ll meet">');
    expect(html).toContain('href="/characters/house-barnaby"');
    expect(html.match(/loading="lazy"/g)).toHaveLength(36);
  });

  it("loops on a copy that screen readers and the keyboard never reach", () => {
    const lists = [...html.matchAll(/<ul class="face-ribbon-list"( aria-hidden="true")?>/g)];
    expect(lists.map((m) => Boolean(m[1]))).toEqual([false, true]);
    const split = html.indexOf('<ul class="face-ribbon-list" aria-hidden="true">');
    const copy = html.slice(split);
    expect(copy.match(/tabindex="-1"/g)).toHaveLength(18);
    const first = html.slice(0, split);
    expect(first).not.toContain('tabindex="-1"');
    expect(first).toContain('aria-label="Captain Odalys Reyes"');
  });

  it("can be paused for good with a switch, and stops on hover and focus; reduced motion is one still, wrapped row", () => {
    expect(html).toContain('<label class="face-ribbon-pause"><input type="checkbox"/> Pause</label>');
    expect(css).toMatch(/\.face-ribbon:hover \.face-ribbon-track,\s*\.face-ribbon:focus-within \.face-ribbon-track,\s*\.face-ribbon:has\(\.face-ribbon-pause input:checked\) \.face-ribbon-track \{\s*animation-play-state: paused;/);
    const calm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(calm).toMatch(/\.face-ribbon-track \{\s*width: auto;\s*animation: none;/);
    expect(calm).toMatch(/flex-wrap: wrap;/);
    expect(calm).toMatch(/ul\.face-ribbon-list\[aria-hidden="true"\],\s*\.face-ribbon-pause \{\s*display: none;/);
  });

  it("names a face by its first name, without a title", () => {
    expect(ribbonName("Captain Odalys Reyes")).toBe("Odalys");
    expect(ribbonName("Inés Castellano")).toBe("Inés");
  });

  it("never shows After Dark's media", () => {
    expect(source("app/FaceRibbon.tsx")).not.toMatch(/after-dark|afterDark|adult/i);
  });
});

describe("the pages", () => {
  it("puts a set behind each marketing page's heading, and leaves the legal pages plain", () => {
    const sets: [string, string][] = [
      ["app/pricing/page.tsx", "booth"],
      ["app/shop/page.tsx", "booth"],
      ["app/alternatives/AlternativePage.tsx", "booth"],
      ["app/import/page.tsx", "booth"],
      ["app/agents/page.tsx", "booth"],
      ["app/press/page.tsx", "stage"],
      ["app/about/page.tsx", "stage"],
      ["app/BotReviews.tsx", "stage"],
      ["app/casting/page.tsx", "stage"],
      ["app/faq/page.tsx", "confessional"],
      ["app/costs/page.tsx", "confessional"],
      ["app/newsletter/page.tsx", "elimination"],
    ];
    for (const [file, set] of sets) expect(source(file), file).toMatch(new RegExp(`<SetHero[\\s\\S]{0,40}set="${set}"`));
    for (const legal of ["app/terms/page.tsx", "app/privacy/page.tsx"]) if (existsSync(legal)) expect(source(legal), legal).not.toContain("SetHero");
  });

  it("plays /agents's MCP cut in its hero and no longer halfway down", () => {
    const agents = source("app/agents/page.tsx");
    expect(agents).toContain("media={<LoopClip video={PROMO.agentsWide}");
    expect(agents).not.toContain("agents-video");
    expect(agents).not.toContain("PromoVideo");
  });

  it("carries the house ribbon on everything, the switching landings, import, companion and the letter", () => {
    for (const file of ["app/everything/page.tsx", "app/alternatives/AlternativePage.tsx", "app/import/page.tsx", "app/companion/(list)/page.tsx", "app/newsletter/page.tsx"]) {
      expect(source(file), file).toContain("<FaceRibbon");
    }
  });
});
