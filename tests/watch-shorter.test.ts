import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Watch was about 15 phone screens (David, 2026-10-21: "it's a long scroll, keep the IA smart and clean").
const page = readFileSync(new URL("../app/watch/page.tsx", import.meta.url), "utf8");

describe("Watch stays short", () => {
  it("shows the Reunion as one card linking to /reunion, never the whole special", () => {
    expect(page).not.toContain("ReunionPanel");
    expect(page).toMatch(/href="\/reunion"[\s\S]*See the Reunion →/);
  });

  it("puts rooms (ready, premieres, replays) in sideways strips, and caps the replays", () => {
    // 2026-10-22: each strip is a StripPager (sideways on a phone, three a page on desktop).
    expect(page.match(/<StripPager label=/g)?.length).toBe(3);
    expect(page).toContain("replays.slice(0, REPLAYS_SHOWN)");
  });

  it("folds the replays behind one line, and leaves them out when there are none (2026-10-31 UX audit, D6)", () => {
    expect(page).toMatch(/replays\.length > 0 && \(\s*<details className="watch-section watch-replays ux-fold">/);
    expect(page).not.toContain("No replays yet.");
  });

  it("says 'Nothing live right now' in one line instead of a heading over nothing", () => {
    expect(page).toContain("Nothing live right now.");
  });

  it("keeps the latest episodes paged and crawlable, and folds the league form away", () => {
    expect(page).toContain("<Pager page={page} pages={latest.pages} label=\"Latest episodes pages\" href={(n) => `${pagePath(n)}#latest`}");
    expect(page).toMatch(/<details className="watch-league-details[^"]*">\s*<summary>🏆 Start a league with friends<\/summary>/);
  });
});

describe("the Reunion has its own page again (2026-10-21: the Watch card's link looped back to Watch)", () => {
  it("renders the special instead of redirecting", () => {
    const route = readFileSync(new URL("../app/reunion/page.tsx", import.meta.url), "utf8");
    expect(route).not.toMatch(/redirect\(/);
    expect(route).toContain("<ReunionPanel reunion={reunion}");
  });
});
