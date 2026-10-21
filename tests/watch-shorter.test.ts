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
    expect(page.match(/watch-lobby watch-strip/g)?.length).toBe(3);
    expect(page).toContain("replays.slice(0, REPLAYS_SHOWN)");
  });

  it("says 'Nothing live right now' in one line instead of a heading over nothing", () => {
    expect(page).toContain("Nothing live right now.");
  });

  it("keeps the latest episodes paged and crawlable, and folds the league form away", () => {
    expect(page).toContain("<Pager page={page} pages={latest.pages} />");
    expect(page).toMatch(/<details className="watch-league-details">\s*<summary>Start a league with friends<\/summary>/);
  });
});
