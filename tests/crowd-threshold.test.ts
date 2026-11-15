// The empty-room rule (lib/crowd-threshold.ts; docs/show-style.md, 2026-11-14): a crowd count shows to a stranger only
// from CROWD_MIN people up; someone with a character of their own sees it from 1. One helper at every count, and this
// file pins the files that use it, so a new count can't slip in unguarded.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import SeasonPoolPanel, { PoolBoardList } from "@/app/SeasonPool";
import TonightBand from "@/app/TonightBand";
import { CallersBoardPanel } from "@/app/YourCalls";
import { CROWD_MIN_DEFAULT, crowdLine, crowdMin, showCrowd } from "@/lib/crowd-threshold";
import type { PoolBoard, PoolStanding } from "@/lib/season-pool";
import type { CallersBoard } from "@/lib/streaks";
import type { LobbyEntry } from "@/lib/watch";

afterEach(() => vi.unstubAllEnvs());

describe("showCrowd and crowdLine", () => {
  it("hides a small count from a stranger and shows it from the threshold up", () => {
    expect(CROWD_MIN_DEFAULT).toBe(5);
    expect([0, 1, 2, 4].map((n) => showCrowd(n))).toEqual([false, false, false, false]);
    expect([5, 6, 50].map((n) => showCrowd(n))).toEqual([true, true, true]);
    expect(showCrowd(NaN)).toBe(false);
  });

  it("an insider sees every count from 1; zero is never a count", () => {
    expect(showCrowd(1, { insider: true })).toBe(true);
    expect(showCrowd(0, { insider: true })).toBe(false);
  });

  it("reads CROWD_MIN from the environment, a whole number from 1, else the default", () => {
    vi.stubEnv("CROWD_MIN", "2");
    expect(crowdMin()).toBe(2);
    expect(showCrowd(2)).toBe(true);
    expect(showCrowd(1)).toBe(false);
    vi.stubEnv("CROWD_MIN", "1");
    expect(showCrowd(1)).toBe(true);
    for (const junk of ["0", "-3", "2.5", "abc", ""]) {
      vi.stubEnv("CROWD_MIN", junk);
      expect(crowdMin(), junk).toBe(CROWD_MIN_DEFAULT);
    }
    expect(showCrowd(3, { min: 3 })).toBe(true);
  });

  it("puts the count in words, or nothing at all", () => {
    expect(crowdLine(7, "watching")).toBe("7 watching");
    expect(crowdLine(2, "watching")).toBe("");
    expect(crowdLine(1, { one: "player has", many: "players have" }, { insider: true })).toBe("1 player has");
    expect(crowdLine(9, { one: "player", many: "players" })).toBe("9 players");
  });
});

const pair: LobbyEntry["characters"] = [
  { id: "a", name: "Ana", house: false, hue: 10, portrait: null },
  { id: "b", name: "Bo", house: true, hue: 20, portrait: null },
];
const liveRoom = (watching: number): LobbyEntry => ({
  id: "r",
  kind: "template",
  room_path: "/watch/r",
  title: "Ana × Bo",
  characters: pair,
  phase_label: "Act 1",
  started: true,
  ended: false,
  watching,
  status: "live",
  starts_at: new Date().toISOString(),
  followup_of: null,
  date_number: null,
});

describe("the counts on the way in", () => {
  it("the tonight band says 'On the air' for a quiet room, 'N watching' for a crowd or to an insider", () => {
    const band = (watching: number, insider: boolean) =>
      renderToStaticMarkup(createElement(TonightBand, { rooms: [liveRoom(watching)], airing: [], situation: null, latest: null, now: Date.now(), insider }));
    expect(band(1, false)).toContain("On the air — tap in");
    expect(band(1, false)).not.toContain("1 watching");
    expect(band(1, true)).toContain("1 watching — tap in");
    expect(band(6, false)).toContain("6 watching — tap in");
    expect(band(6, false)).toContain("1 date filming · 6 watching");
    expect(band(2, false)).toContain("1 date filming<");
  });

  it("the season pool names its players only for a crowd, or to an insider", () => {
    const standing: PoolStanding = { season_id: "2026-11", points: 0, place: null, players: 2, leader: 3, reveals_at: new Date(Date.now() + 86_400_000).toISOString() };
    const stranger = renderToStaticMarkup(createElement(SeasonPoolPanel, { standing, revealed: null, now: Date.now() }));
    expect(stranger).not.toContain("players have points");
    expect(stranger).toContain("Call an ending</a> to get on the board.");
    const insider = renderToStaticMarkup(createElement(SeasonPoolPanel, { standing, revealed: null, now: Date.now(), insider: true }));
    expect(insider).toContain("2 players have points so far.");
    const crowd = renderToStaticMarkup(createElement(SeasonPoolPanel, { standing: { ...standing, players: 12 }, revealed: null, now: Date.now() }));
    expect(crowd).toContain("12 players have points so far.");
    // Someone with points: their place, "of N" only for a crowd.
    const placed = renderToStaticMarkup(createElement(SeasonPoolPanel, { standing: { ...standing, points: 4, place: 1 }, revealed: null, now: Date.now() }));
    expect(placed).toContain("You: 4 points, 1st so far.");
    expect(placed).not.toContain("of 2");
    const board: PoolBoard = { season_id: "2026-10", label: "October 2026", path: "/seasons/october-2026", frozen_at: new Date().toISOString(), top: [{ place: 1, name: "Sam", points: 9, calls_right: 3, mine: false, agent: false }], players: 2, me: null };
    expect(renderToStaticMarkup(createElement(PoolBoardList, { board }))).not.toContain("2 players.");
    expect(renderToStaticMarkup(createElement(PoolBoardList, { board, insider: true }))).toContain("2 players. Names show only");
  });

  it("the best-callers board becomes the invitation to call an ending below the threshold", () => {
    const board: CallersBoard = { top: [{ name: "Sam", right: 3, called: 4, mine: false }, { name: null, right: 1, called: 1, mine: false }], callers: 2, my_rank: null };
    const stranger = renderToStaticMarkup(createElement(CallersBoardPanel, { board }));
    expect(stranger).toContain("Best callers this week");
    expect(stranger).not.toContain('class="callers-board"');
    expect(stranger).toContain("Call the ending before a date airs");
    expect(stranger).toContain('href="/calls"');
    const insider = renderToStaticMarkup(createElement(CallersBoardPanel, { board, insider: true }));
    expect(insider).toContain('class="callers-board"');
    expect(insider).toContain("(2 callers)");
    const crowd = renderToStaticMarkup(createElement(CallersBoardPanel, { board: { ...board, callers: 9 } }));
    expect(crowd).toContain('class="callers-board"');
  });
});

/* ------------------------------ the call sites, pinned ------------------------------ */

const ROOT = join(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const sources = () => [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))].map((p) => relative(ROOT, p)).sort();

/** Every file that applies the rule. Adding a count? Guard it with the helper and add its file here. */
const CALL_SITES = [
  "app/ReunionPanel.tsx",
  "app/SeasonPool.tsx",
  "app/TonightBand.tsx",
  "app/YourCalls.tsx",
  "app/calls/page.tsx",
  "app/characters/page.tsx",
  "app/reunion/page.tsx",
  "app/seasons/[slug]/page.tsx",
  "app/watch/page.tsx",
  "lib/watch.ts",
];

/** Words that are a crowd count in code: "${n} watching", "${n} players have", "${n} viewers called". */
const CROWD_PHRASES = [/\}\s*watching\b/, /\}\s*(?:players?|callers?|viewers?)\s+(?:ha(?:s|ve)|called|voted)\b/, /players? ha(?:s|ve) points/];
/** Files that say a count without the helper, each for a reason. */
const ALLOWED_WITHOUT: Record<string, string> = {
  "app/watch/[id]/WatchRoom.tsx": "a client component: the server decided (RoomState.show_watching, lib/watch.ts)",
  "lib/discord-posts.ts": "the Discord digest goes to people who joined the show's own server",
  "lib/newsletter-issue.ts": "the newsletter goes to people who subscribed",
  "lib/reunion.ts": "builds the counted words (count_line); app/ReunionPanel.tsx decides whether they show",
  "lib/leagues.ts": "a doc comment about the MCP's standing, which returns numbers, not copy",
  "lib/season-pool.ts": "returns the numbers; the pages decide",
};

describe("the call sites", () => {
  it("are exactly the pinned files (a new one must import the helper and join the list)", () => {
    const using = sources().filter((f) => /from "(?:@\/lib|\.\.?\/?(?:\.\.\/)*)\/?crowd-threshold"/.test(readFileSync(join(ROOT, f), "utf8")) || /crowd-threshold"/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(using.filter((f) => f !== "lib/crowd-threshold.ts")).toEqual(CALL_SITES);
  });

  it("every file that puts a crowd count into words either uses the helper or is excused by name", () => {
    const offenders = sources().filter((f) => {
      if (f === "lib/crowd-threshold.ts" || CALL_SITES.includes(f) || f in ALLOWED_WITHOUT) return false;
      const src = readFileSync(join(ROOT, f), "utf8");
      return CROWD_PHRASES.some((re) => re.test(src));
    });
    expect(offenders).toEqual([]);
  });
});
