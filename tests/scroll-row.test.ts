// The 2026-11-20 mobile audit, fix #8: one shared .scroll-row (an edge fade and scroll-snap) for every horizontal chip,
// tab and rail row that can be wider than a phone, and wide admin tables scroll inside the same fade.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe(".scroll-row", () => {
  it("is one utility in the catalog sheet: its own scroller, snap, no scrollbar, the ShowTabs fade", () => {
    const css = read("app/ux/catalog.css");
    expect(css).toMatch(/\.scroll-row \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x proximity;[^}]*scrollbar-width: none;/);
    expect(css).toMatch(/\.scroll-row > \* \{[^}]*scroll-snap-align: start;/);
    expect(css).toMatch(/\.scroll-row,\s*\.table-scroll \{[^}]*animation: tabs-fade linear both;[^}]*animation-timeline: scroll\(self inline\);/);
  });

  it("is on the rows the audit named (A1, C3, C7, C8, C9)", () => {
    const rows: [string, string][] = [
      ["app/watch/page.tsx", '<ul className="watch-airing scroll-row">'],
      ["app/watch/StripPager.tsx", "watch-strip strip-paged scroll-row"],
      ["app/after-dark/[a]/[b]/AfterDarkTheater.tsx", '<nav className="ad-theater-tabs scroll-row"'],
      ["app/after-dark/[a]/[b]/SetSceneModal.tsx", '<div className="ad-scenes-cats scroll-row"'],
      ["app/after-dark/[a]/[b]/SetSceneModal.tsx", '<div className="ad-scenes-tags scroll-row"'],
      ["app/after-dark/[a]/[b]/SceneWriter.tsx", '<div className="ad-studio-tabs ad-page-tabbar scroll-row"'],
      ["app/after-dark/studio/[id]/Studio.tsx", '<nav className="ad-studio-tabs scroll-row"'],
    ];
    for (const [file, row] of rows) expect(read(file), file).toContain(row);
    // The Studio's tabs no longer wrap to two rows on a phone.
    expect(read("app/globals.css")).not.toMatch(/\.ad-studio-tabs \{\s*flex-wrap: wrap;/);
  });

  it("holds what's absolutely positioned inside it: the graph's chips, whose counts carry a screen-reader word", () => {
    // An .sr-only span is placed against its nearest positioned ancestor. With none inside the row, that was the stage
    // around it, the row's clip missed the span, and /graph scrolled sideways on a phone (2026-11-20, by up to 382px).
    expect(read("app/graph/ConstellationApp.tsx")).toMatch(/<ul className="constellation-stage-chips scroll-row">[\s\S]*?<span className="sr-only">/);
    expect(read("app/globals.css")).toMatch(/\.constellation-stage-chips \{\s*position: relative;/);
  });

  it("puts every wide admin table in the faded scroller (C20)", () => {
    const graph = read("app/admin/after-dark/graph/page.tsx");
    expect(graph.match(/<div className="table-scroll">\s*<table className="ad-pairs/g)?.length).toBe(2);
    expect(read("app/admin/after-dark/providers/page.tsx")).not.toContain("overflowX");
  });
});
