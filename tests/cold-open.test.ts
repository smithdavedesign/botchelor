/**
 * The cold open (lib/cold-open.ts, app/episodes/[id]/ColdOpenCard.tsx, EpisodeTheater.tsx): who they are, what each wants
 * and what's at stake before the theater's first line, the date's short version beside it (CutPlayer.tsx), and the
 * scripts that drive the theater pressing Start (2026-11-19, the first-minute plan).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/episodes/e1",
  useSearchParams: () => new URLSearchParams(),
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ColdOpenCard, { cutButtonLabel } from "@/app/episodes/[id]/ColdOpenCard";
import EpisodeTheater from "@/app/episodes/[id]/EpisodeTheater";
import { delayBefore } from "@/app/useReplay";
import { clipLength, coldOpenOf, coldOpenOn, playLength, type ColdOpenInput } from "@/lib/cold-open";
import type { Turn } from "@/lib/conversation";
import { theaterLeftProps } from "@/lib/engagement-keys";
import type { CharacterRef } from "@/lib/game";

const src = (p: string) => readFileSync(p, "utf8");
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const ADA: CharacterRef = { id: "c-ada", name: "Ada Quill", house: false, hue: 200, portrait: null };
const BO: CharacterRef = { id: "c-bo", name: "Bo Marsh", house: true, hue: 20, portrait: null };
const INPUT: ColdOpenInput = {
  characters: [ADA, BO],
  goals: [
    { character_id: "c-bo", goal: "Bo wants someone who laughs at the boat puns." },
    { character_id: "c-ada", goal: "Ada Quill wants to know if he's as kind off the clock." },
  ],
  dateNumber: 1,
  venue: "the night market",
  format: null,
  roleplay: null,
  setting: "  A rainy night market,\n two umbrellas and one table left. ",
  previously: null,
};
const LINES: Turn[] = Array.from({ length: 6 }, (_, i) => ({
  side: i % 2 ? "b" : "a",
  act: Math.floor(i / 2),
  dialogue: `Line ${i + 1}, said plainly.`,
  action: "",
  emotion: "neutral",
  interest: 5,
}));

describe("lib/cold-open: the card's words (pure)", () => {
  it("COLD_OPEN=0 turns it off; unset, or anything else, leaves it on", () => {
    expect(coldOpenOn({})).toBe(true);
    expect(coldOpenOn({ COLD_OPEN: "1" })).toBe(true);
    expect(coldOpenOn({ COLD_OPEN: " 0 " })).toBe(false);
  });

  it("says which date and where, the setting, what each wants in the order they sit, and the question", () => {
    expect(coldOpenOf(INPUT)).toEqual({
      kicker: "A first date at the night market",
      setting: "A rainy night market, two umbrellas and one table left.",
      previously: null,
      roleplay: null,
      wants: [
        { character_id: "c-ada", rest: " wants to know if he's as kind off the clock.", goal: "Ada Quill wants to know if he's as kind off the clock." },
        { character_id: "c-bo", rest: " wants someone who laughs at the boat puns.", goal: "Bo wants someone who laughs at the boat puns." },
      ],
      stakes: "Will there be a second date?",
    });
  });

  it("a later date says so, with what happened last time, the format and the roleplay", () => {
    const open = coldOpenOf({ ...INPUT, dateNumber: 3, format: "Speed round", roleplay: { icon: "🎭", title: "The heist" }, previously: "Their second date at the pier ended in a third date." })!;
    expect(open.kicker).toBe("Their third date at the night market · Speed round");
    expect(open.stakes).toBe("Will there be a fourth date?");
    expect(open.previously).toBe("Their second date at the pier ended in a third date.");
    expect(open.roleplay).toBe("🎭 The heist");
    expect(coldOpenOf({ ...INPUT, dateNumber: 11, venue: null })!.kicker).toBe("Their 11th date");
  });

  it("a goal that doesn't open with the name keeps all of it; a missing goal is left out", () => {
    const open = coldOpenOf({ ...INPUT, goals: [{ character_id: "c-ada", goal: "To be surprised, for once." }] })!;
    expect(open.wants).toEqual([{ character_id: "c-ada", rest: null, goal: "To be surprised, for once." }]);
  });

  it("nothing to set up (no setting, no goals) is no card", () => {
    expect(coldOpenOf({ ...INPUT, setting: " ", goals: [] })).toBeNull();
    expect(coldOpenOf({ ...INPUT, setting: null, goals: [{ character_id: "c-ada", goal: "" }] })).toBeNull();
  });

  it("tells lengths the way people read them", () => {
    expect(clipLength(64.5)).toBe("1:05");
    expect(clipLength(59.4)).toBe("0:59");
    expect(clipLength(130)).toBe("2:10");
    expect(playLength(20_000)).toBe("about a minute");
    expect(playLength(185_000)).toBe("about 3 minutes");
    expect(cutButtonLabel(64.5)).toBe("🎬 The short version · 1:05");
  });

  it("theater_left says whether the opening began with the card, and only when the theater says", () => {
    const base = { line: 0, of: 12, openedAt: 0, now: 9_000, via: "exit" as const, auto: false };
    expect(theaterLeftProps({ ...base, intro: true })).toEqual({ via: "exit", line: 0, of: 12, pct: 0, secs: 9, auto: false, intro: true });
    expect(theaterLeftProps(base)).not.toHaveProperty("intro");
  });
});

describe("the card", () => {
  const open = coldOpenOf(INPUT)!;
  const render = (over: Partial<Parameters<typeof ColdOpenCard>[0]> = {}) =>
    text(renderToStaticMarkup(createElement(ColdOpenCard, { coldOpen: open, characters: [ADA, BO], lines: 12, playMs: 185_000, cut: null, again: false, onStart() {}, onCut() {}, ...over })));

  it("names them, says what each wants once, asks the question and starts the date", () => {
    const out = render();
    expect(out).toContain('<p class="cold-open-kicker">A first date at the night market</p>');
    expect(out).toMatch(/<h2 id="cold-open-title" class="cold-open-pair">[\s\S]*Ada Quill[\s\S]*×[\s\S]*Bo Marsh/);
    expect(out).toContain("<strong>Ada Quill</strong> wants to know if he's as kind off the clock.");
    expect(out).toContain("<strong>Bo Marsh</strong> wants someone who laughs at the boat puns.");
    expect(out).not.toContain("Ada Quill wants to know");
    expect(out).toContain('<p class="cold-open-stakes">Will there be a second date?</p>');
    expect(out).toMatch(/<button type="button" class="primary"[^>]*data-track="cold-open-start"[^>]*>▶ Start the date<\/button>/);
    expect(out).toContain("12 lines · about 3 minutes");
    expect(out).not.toContain("cold-open-cut");
  });

  it("offers the short version when there is one", () => {
    const out = render({ cut: { src: "/api/home-clip/k/cut.mp4", poster_src: "/api/home-clip/k/poster.jpg", seconds: 64.5 } });
    expect(out).toMatch(/<button type="button" class="secondary" data-track="cold-open-cut">🎬 The short version · 1:05<\/button>/);
  });

  it("reopened partway (Who's who), it goes back to the date", () => {
    const out = render({ again: true });
    expect(out).toContain('data-track="cold-open-back"');
    expect(out).toContain("▶ Back to the date");
    expect(out).not.toContain("about 3 minutes");
  });
});

describe("the theater", () => {
  const coldOpen = coldOpenOf(INPUT);
  const cut = { src: "/api/home-clip/k/cut.mp4", poster_src: "/api/home-clip/k/poster.jpg", seconds: 64.5 };
  const theater = (over: Record<string, unknown> = {}) =>
    text(renderToStaticMarkup(createElement(EpisodeTheater, { episodeId: "e1", characters: [ADA, BO], venue: null, transcript: LINES, endingLabel: "A second date", coldOpen, cut, ...over })));

  it("closed: Watch in theater, and the short version beside it when there is one", () => {
    const out = theater();
    expect(out).toContain("Watch in theater");
    expect(out).toContain('data-track="episode-cut">🎬 The short version · 1:05</button>');
    expect(theater({ cut: null })).not.toContain("The short version");
  });

  it("opens on the cold open, the date waiting behind it, with Who's who in the bar", () => {
    const out = theater({ autoOpen: true });
    expect(out).toContain('class="cold-open"');
    expect(out).toContain("▶ Start the date");
    expect(out).toContain(`${LINES.length} lines · ${playLength(LINES.reduce((ms, _, i) => ms + delayBefore(LINES, i), 0))}`);
    expect(out).toContain('aria-label="Who\'s who"');
    // Nothing has played: the bar offers Play, and no line is on the stage.
    expect(out).toContain('aria-label="Play"');
    expect(out).not.toContain("Line 1, said plainly.");
    // The card sits under the bar (before it in the page, the same layer), so Exit stays in reach.
    expect(out.indexOf('class="cold-open"')).toBeLessThan(out.indexOf('class="theater-hud"'));
  });

  it("never for the creator who just filmed it, someone picking up where they watched live, or with no card", () => {
    for (const over of [{ justFilmed: true }, { startAt: 3 }, { coldOpen: null }]) {
      const out = theater({ autoOpen: true, ...over });
      expect(out, JSON.stringify(over)).not.toContain('class="cold-open"');
      expect(out, JSON.stringify(over)).toContain('aria-label="Pause"');
    }
    expect(theater({ autoOpen: true, coldOpen: null })).not.toContain("Who's who");
  });

  it("counts the card, how it ended and where it was left (the source)", () => {
    const t = src("app/episodes/[id]/EpisodeTheater.tsx");
    expect(t).toContain('queueEvent("cold_open", { lines: transcript.length, cut: Boolean(cut), again: false })');
    expect(t).toMatch(/queueEvent\("date_watched", \{[\s\S]{0,400}\bintro,/);
    expect(t).toContain("via, auto: Boolean(autoOpen), intro }));");
    const player = src("app/episodes/[id]/CutPlayer.tsx");
    for (const e of ['"cut_play"', '"cut_ended"', '"cut_left"', 'queueEvent("date_watched", { via: "cut"']) expect(player).toContain(e);
  });
});

describe("the scripts that drive the theater press Start", () => {
  it("the daily clip records from Start, as it did from Watch before the card", () => {
    const clip = src("scripts/clips/daily-clip.mjs");
    const watch = clip.indexOf('getByRole("button", { name: "Watch in theater" }).click(');
    const start = clip.indexOf("await startTheDate(page);");
    const record = clip.indexOf('cdp.send("Page.startScreencast"');
    expect(watch).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(watch);
    expect(record).toBeGreaterThan(start);
    expect(clip).toContain('page.locator(".theater .cold-open").getByRole("button", { name: /Start the date/ })');
  });

  it("the e2e checks no line plays behind the card, then starts it; the screenshots take the card", () => {
    expect(src("scripts/e2e.mjs")).toContain("a line played behind the cold open");
    expect(src("scripts/screenshots.mjs")).toContain('await shot(home, "episode-cold-open");');
  });
});
