// The empty-room rule (lib/crowd-threshold.ts; docs/show-style.md, 2026-11-14): a crowd count shows to a stranger only
// from CROWD_MIN people up; someone with a character of their own sees it from 1. One helper at every count, and this
// file pins the files that use it, so a new count can't slip in unguarded.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackCast from "@/app/BackCast";
import CastingBoard from "@/app/casting/CastingBoard";
import SeasonPoolPanel, { PoolBoardList } from "@/app/SeasonPool";
import SituationVote from "@/app/SituationVote";
import TonightBand from "@/app/TonightBand";
import { CallersBoardPanel } from "@/app/YourCalls";
import { CROWD_MIN_DEFAULT, crowdLine, crowdMin, showCrowd, tallyLine } from "@/lib/crowd-threshold";
import type { CastingBoard as AuditionBoard } from "@/lib/auditions";
import type { BackingBoard } from "@/lib/backing";
import type { PoolBoard, PoolStanding } from "@/lib/season-pool";
import { BOARD_NAMED_MIN, type CallersBoard } from "@/lib/streaks";
import type { LobbyEntry } from "@/lib/watch";
import type { SituationBoard } from "@/lib/situations";

// The ballots are client components with useAction (useRouter): outside the app router, a stand-in.
vi.mock("next/navigation", async (original) => ({ ...((await original()) as object), useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

// The cases below were written at a threshold of five and still say what they said: each runs at five. The default
// itself, ten since 2026-11-16, has its own case.
beforeEach(() => vi.stubEnv("CROWD_MIN", "5"));
afterEach(() => vi.unstubAllEnvs());

describe("showCrowd and crowdLine", () => {
  it("the default is ten: \"10 viewers\" was still a sign saying nobody's here at five (David, 2026-11-16)", () => {
    vi.unstubAllEnvs();
    expect(CROWD_MIN_DEFAULT).toBe(10);
    expect([1, 5, 9].map((n) => showCrowd(n))).toEqual([false, false, false]);
    expect([10, 11, 50].map((n) => showCrowd(n))).toEqual([true, true, true]);
    expect(tallyLine(7)).toBe("Your vote's in.");
  });

  it("hides a small count from a stranger and shows it from the threshold up", () => {
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

  it("a ballot's tally once you've voted: the count for a crowd or an insider, else that your vote is in", () => {
    expect(tallyLine(1)).toBe("Your vote's in.");
    expect(tallyLine(1, { insider: true })).toBe("1 vote so far.");
    expect(tallyLine(7)).toBe("7 votes so far.");
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
    // The real threshold, so 6 callers with 5 names up is below it for a stranger and a list for an insider.
    vi.stubEnv("CROWD_MIN", String(CROWD_MIN_DEFAULT));
    const board: CallersBoard = { top: [{ name: "Sam", right: 3, called: 4, mine: false }, { name: null, right: 1, called: 1, mine: false }], callers: 6, named: BOARD_NAMED_MIN, my_rank: null };
    const stranger = renderToStaticMarkup(createElement(CallersBoardPanel, { board }));
    expect(stranger).toContain("Best callers this week");
    expect(stranger).not.toContain('class="callers-board"');
    expect(stranger).toContain("Call the ending before a date airs");
    expect(stranger).toContain('href="/calls#open-calls"');
    const insider = renderToStaticMarkup(createElement(CallersBoardPanel, { board, insider: true }));
    expect(insider).toContain('class="callers-board"');
    expect(insider).toContain("(6 callers)");
    const crowd = renderToStaticMarkup(createElement(CallersBoardPanel, { board: { ...board, callers: 12 } }));
    expect(crowd).toContain('class="callers-board"');
  });

  it("waits for names, for an insider too: never a list of 'A viewer' rows (the 2026-11-22 audit)", () => {
    const anon = { name: null, right: 1, called: 1, mine: false };
    const board: CallersBoard = { top: [anon, anon, anon, { ...anon, mine: true }], callers: 12, named: BOARD_NAMED_MIN - 1, my_rank: 4 };
    const html = renderToStaticMarkup(createElement(CallersBoardPanel, { board, insider: true }));
    expect(html).not.toContain('class="callers-board"');
    expect(html).not.toContain("A viewer");
    expect(html).toContain("Call the ending before a date airs");
    expect(html).toContain(`You&#x27;re number 4 this week. The list shows once ${BOARD_NAMED_MIN} callers have put a name up.`);
    const named = renderToStaticMarkup(createElement(CallersBoardPanel, { board: { ...board, named: BOARD_NAMED_MIN }, insider: true }));
    expect(named).toContain('class="callers-board"');
  });
});

describe("the votes on the way in (GPT review 2026-11-16: \"Last vote: 1 of 1\", \"Most backed: 2 viewers\", \"0 votes\")", () => {
  const face = (id: string, name: string) => ({ id, name, hue: 10, portrait: null });
  const situation = (total: number, my_pick: string | null = null): SituationBoard => ({
    day: "2026-11-16",
    closes_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    cast: [face("j", "Juniper Vale"), face("s", "Sable Quist")],
    headline: null,
    choices: [{ id: "x", title: "The rivals share a table", icon: "👀", premise: "They sit down.", votes: total }],
    my_pick,
    total,
    last: { day: "2026-11-15", title: "Sable gets the date", icon: "💘", votes: total, total, cast: ["Juniper Vale", "Sable Quist"], room_path: "/watch/r", my_pick: null, won: false },
  });
  const sit = (board: SituationBoard, insider = false) => renderToStaticMarkup(createElement(SituationVote, { board, now: Date.now(), insider }));

  it("the last vote names what won, and by how many only for a crowd or to an insider", () => {
    expect(sit(situation(1))).toContain("Sable gets the date</strong> won");
    expect(sit(situation(1))).not.toContain("1 of 1");
    expect(sit(situation(1), true)).toContain("won with 1 of 1");
    expect(sit(situation(12))).toContain("won with 12 of 12");
  });

  it("a stranger's lone vote reads as in, with no 100% bar", () => {
    const lone = sit(situation(1, "x"));
    expect(lone).toContain("Your vote&#x27;s in.");
    expect(lone).not.toContain("1 vote so far");
    expect(lone).not.toContain("situation-bar");
    expect(sit(situation(1, "x"), true)).toContain("1 vote so far.");
    expect(sit(situation(9, "x"))).toContain("situation-bar");
  });

  it("the most backed is named, its count only for a crowd or to an insider", () => {
    const board = (total: number): BackingBoard => ({
      season: "2026-11",
      label: "November 2026",
      locks_at: new Date(Date.now() + 86_400_000).toISOString(),
      locked: false,
      cast: [{ ...face("n", "Nell Abiodun"), backers: Math.min(total, 2) }],
      my_pick: null,
      total,
      most: { id: "n", name: "Nell Abiodun", backers: Math.min(total, 2) },
    });
    const back = (b: BackingBoard, insider = false) => renderToStaticMarkup(createElement(BackCast, { board: b, insider }));
    // A front-runner on two picks isn't one: not named to a stranger at all (the second 2026-11-16 review).
    expect(back(board(2))).not.toContain("Most backed this month");
    expect(back(board(2))).not.toContain("2 viewers");
    expect(back(board(2))).not.toContain("2 backing");
    expect(back(board(2), true)).toContain("Most backed this month: <strong>Nell Abiodun</strong> (2 viewers)");
    expect(back(board(20))).toContain("(2 viewers of 20)");
  });

  it("an audition's votes show for a crowd or to an insider; its dates aired always", () => {
    const board = (votes: number): AuditionBoard => ({
      season_id: "2026-12",
      label: "December 2026",
      closes_at: new Date(Date.now() + 86_400_000).toISOString(),
      auditions: [{ character_id: "a", name: "Ambrose Fenn", bio: "Runs a library.", hue: 10, portrait: null, status: "open", votes, aired: 6, creator_handle: null, creator_name: null }],
      my_vote: null,
    });
    const cast = (b: AuditionBoard, insider = false) => renderToStaticMarkup(createElement(CastingBoard, { board: b, viewer: null, insider }));
    expect(cast(board(0))).toContain("6 dates aired");
    expect(cast(board(0))).not.toContain("0 votes");
    expect(cast(board(1), true)).toContain("1 vote · ");
    expect(cast(board(8))).toContain("8 votes · ");
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
  "app/BackCast.tsx",
  "app/DareVote.tsx",
  "app/ReunionPanel.tsx",
  "app/SeasonFormatVote.tsx",
  "app/SeasonPool.tsx",
  "app/SituationVote.tsx",
  "app/TonightBand.tsx",
  "app/WeeklyReveal.tsx",
  "app/YourCalls.tsx",
  "app/calls/page.tsx",
  "app/casting/CastingBoard.tsx",
  "app/casting/page.tsx",
  "app/characters/(list)/page.tsx",
  "app/reunion/page.tsx",
  "app/seasons/[slug]/page.tsx",
  "app/shows/ShowIdeas.tsx",
  "app/shows/page.tsx",
  "app/watch/BotchelorCard.tsx",
  "app/watch/RecouplingCard.tsx",
  "app/watch/page.tsx",
  "lib/casting.ts",
  "lib/ceremony.ts",
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
      // The translations (lib/i18n/messages): the words of strings whose own call sites are checked here.
      if (f.startsWith("lib/i18n/messages/")) return false;
      const src = readFileSync(join(ROOT, f), "utf8");
      return CROWD_PHRASES.some((re) => re.test(src));
    });
    expect(offenders).toEqual([]);
  });
});
