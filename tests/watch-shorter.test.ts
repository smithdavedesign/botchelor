import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Watch was about 15 phone screens (David, 2026-10-21: "it's a long scroll, keep the IA smart and clean").
const page = readFileSync(new URL("../app/watch/page.tsx", import.meta.url), "utf8");

describe("Watch stays short", () => {
  it("links the Reunion in one line, never the whole special", () => {
    expect(page).not.toContain("ReunionPanel");
    expect(page).toContain('<Link href="/reunion">The Reunion</Link>');
  });

  it("is three blocks: on now, vote before it airs, recent episodes (the 2026-11-14 design audit)", () => {
    expect(page.match(/<section className="watch-block"/g)?.length).toBe(3);
    expect(page).toContain('id="on-now"');
    expect(page).toContain("Vote before it airs");
    expect(page).toContain("Recent episodes");
    // One column of votes: never side by side.
    expect(page).not.toContain("is-two");
  });

  it("puts 'Airing soon: call it' first, right after the lede (the 2026-11-20 mobile audit, A1)", () => {
    const lede = page.indexOf('className="lede watch-intro"');
    const airing = page.indexOf('id="airing-soon"');
    expect(lede).toBeGreaterThan(-1);
    expect(airing).toBeGreaterThan(lede);
    expect(airing).toBeLessThan(page.indexOf('id="on-now"'));
    expect(page).toContain('<section className="watch-block watch-airing-block" aria-labelledby="airing-soon">');
  });

  it("sends the season's games to their own pages, and old #anchors still land on the way there", () => {
    for (const gone of ["BackCast", "CastChat", "ChemistryShiftsPanel", "SeasonPoolPanel", "CallersBoardPanel", "CreateLeagueForm"]) expect(page).not.toContain(gone);
    for (const id of ["season-pool", "cast-chat", "best-callers", "leagues"]) expect(page).toContain(`id="${id}"`);
    const reunion = readFileSync(new URL("../app/reunion/page.tsx", import.meta.url), "utf8");
    for (const here of ["<BackCast", "<CastChat", "<ChemistryShiftsPanel", "<SeasonPoolPanel"]) expect(reunion).toContain(here);
    const calls = readFileSync(new URL("../app/calls/page.tsx", import.meta.url), "utf8");
    expect(calls).toContain("<CallersBoardPanel");
    expect(calls).toContain('id="leagues"');
    expect(calls).toMatch(/<details className="watch-league-details[^"]*">\s*<summary>\s*<Icon name="trophy" \/> Start a league with friends\s*<\/summary>/);
  });

  it("puts rooms (ready, premieres, replays) in sideways strips, and caps the replays", () => {
    // 2026-10-22: each strip is a StripPager (sideways on a phone, three a page on desktop).
    expect(page.match(/<StripPager label=/g)?.length).toBe(3);
    expect(page).toContain("replays.slice(0, REPLAYS_SHOWN)");
  });

  it("folds the replays behind one line, and leaves them out when there are none (2026-10-31 UX audit, D6)", () => {
    expect(page).toMatch(/replays\.length > 0 && \(\s*<details className="watch-replays ux-fold">/);
    expect(page).not.toContain("No replays yet.");
  });

  it("says 'Nothing live right now' in one line instead of a heading over nothing", () => {
    expect(page).toContain("Nothing live right now.");
  });

  it("keeps the latest episodes paged and crawlable", () => {
    expect(page).toContain("<Pager page={page} pages={latest.pages} label=\"Latest episodes pages\" href={(n) => `${pagePath(n)}#latest`}");
  });
});

describe("the Reunion has its own page again (2026-10-21: the Watch card's link looped back to Watch)", () => {
  it("renders the special instead of redirecting", () => {
    const route = readFileSync(new URL("../app/reunion/page.tsx", import.meta.url), "utf8");
    expect(route).not.toMatch(/redirect\(/);
    expect(route).toContain("<ReunionPanel reunion={reunion}");
  });
});

// The 2026-11-21 audit: every card on the lobby rendered its room in the background (Link prefetch), and a room page read
// its room twice, once for its title and once for the page.
describe("Watch loads lightly", () => {
  it("never prefetches a room from a lobby card, and a room page reads its room once a request", () => {
    expect(page).toMatch(/<Link href=\{room\.status === "ready" \? `\$\{room\.room_path\}\?start=1` : room\.room_path\} prefetch=\{false\}/);
    const room = readFileSync(new URL("../app/watch/[id]/page.tsx", import.meta.url), "utf8");
    expect(room).toContain("const roomFor = cache(async (id: string, viewerId: string | null) => getRoomState(");
    expect(room.match(/getRoomState\(/g)).toHaveLength(1);
    expect(room.match(/roomFor\(id, /g)).toHaveLength(2);
  });
});
