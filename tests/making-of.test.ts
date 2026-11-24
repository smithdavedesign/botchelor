import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPageSafe, pacificDay, pacificTime, parseFirstParent, parseShotLog, prOf, prsPerDay, shotKind } from "../scripts/making-of/lib.mjs";
import {
  busiestDay,
  chapterOf,
  claudeShare,
  dayNumber,
  dayRange,
  episodes,
  frameForDay,
  longDay,
  MAKING_OF,
  runningTotals,
  shortDay,
  stageAt,
  type Frame,
  type Shot,
} from "@/lib/making-of";
import { PUBLIC_PATHS } from "@/lib/site";

const shot = (name: string): Shot => ({ card: { src: `/${name}-c`, w: 1, h: 1 }, full: { src: `/${name}-f`, w: 1, h: 1 }, from: `docs/screenshots/${name}.png` });
const frame = (day: string, extra: Partial<Frame> = {}): Frame => ({ pr: 1, day, title: "t", caption: "c", ...extra });

describe("making-of: reading git", () => {
  it("finds the pull request in a merge commit or a squash, and nothing in a plain commit", () => {
    expect(prOf("Merge pull request #1475 from smithdavedesign/ds-couple-venues", "Character tabs: no glow\n\nmore")).toEqual({ pr: 1475, title: "Character tabs: no glow" });
    expect(prOf("README: place name generator screenshots (#2118)")).toEqual({ pr: 2118, title: "README: place name generator screenshots" });
    expect(prOf("Merge pull request #606: tsc-fix verified on final head")).toEqual({ pr: 606, title: "tsc-fix verified on final head" });
    expect(prOf("Idea: Botchelor — an AI blind-date show")).toBeNull();
  });

  it("dates a commit by the Pacific day and clock, across the end of daylight time", () => {
    expect(pacificDay("2026-10-13T07:44:02-07:00")).toBe("2026-10-13");
    // 06:30 UTC on Nov 2 is still Nov 1 in California (PST, UTC-8).
    expect(pacificDay("2026-11-02T06:30:00Z")).toBe("2026-11-01");
    expect(pacificTime("2026-10-13T07:44:02-07:00")).toBe("7:44 am");
    expect(pacificTime("2026-10-13T15:04:01-07:00")).toBe("3:04 pm");
  });

  it("parses the first-parent log and the screenshot log", () => {
    const log = "a1\x1f2026-10-13T14:01:58-07:00\x1fMerge pull request #1 from x/y\x1fMVP: botchelor\n\x1e\nb2\x1f2026-10-13T07:44:02-07:00\x1fIdea: Botchelor\x1f\x1e\n";
    expect(parseFirstParent(log)).toEqual([
      { sha: "a1", iso: "2026-10-13T14:01:58-07:00", day: "2026-10-13", subject: "Merge pull request #1 from x/y", pr: 1, title: "MVP: botchelor" },
      { sha: "b2", iso: "2026-10-13T07:44:02-07:00", day: "2026-10-13", subject: "Idea: Botchelor", pr: null, title: "Idea: Botchelor" },
    ]);
    const shots = parseShotLog("@@a1\n\nA\tdocs/screenshots/watch-desktop.png\nM\tdocs/screenshots/watch-phone.png\nD\tdocs/screenshots/gone.png\nA\tdocs/screenshots/notes.md\n@@b2\n");
    expect(shots.get("a1")).toEqual([
      { status: "A", path: "docs/screenshots/watch-desktop.png" },
      { status: "M", path: "docs/screenshots/watch-phone.png" },
    ]);
    expect(shots.get("b2")).toEqual([]);
  });

  it("keeps After Dark, the back office, money, accounts and companions off the open page, by whole words", () => {
    for (const bad of ["after-dark-step-in-bond-desktop", "ad-hub-picker-desktop", "admin-analytics-desktop", "studio-pg-gallery-phone", "account-recovery-live-confirm-phone", "companion-plan-desktop", "e2e-after-dark-scene-played", "showcase-reels-phone", "costs-live-desktop"]) {
      expect(openPageSafe(`docs/screenshots/${bad}.png`), bad).toBe(false);
    }
    for (const ok of ["watch-theater-desktop", "oc-chemistry-test-phone", "add-friend-phone", "read-receipts-desktop", "graph-sky-desktop"]) {
      expect(openPageSafe(`docs/screenshots/${ok}.png`), ok).toBe(true);
    }
  });

  it("pairs a desktop and a phone shot by name", () => {
    expect(shotKind("docs/screenshots/watch-theater-desktop.png")).toEqual({ base: "watch-theater", kind: "desktop" });
    expect(shotKind("docs/screenshots/import-live-phone-create.png")).toEqual({ base: "import-live-create", kind: "phone" });
    expect(shotKind("docs/screenshots/live-mobile-matches.png")).toEqual({ base: "live-matches", kind: "phone" });
    expect(shotKind("docs/screenshots/after-dark-step-in-covers-all-45.jpg")).toEqual({ base: "after-dark-step-in-covers-all-45", kind: "other" });
  });

  it("counts pull requests per day with the quiet days in", () => {
    const days = prsPerDay([{ day: "2026-10-13", pr: 1 }, { day: "2026-10-13", pr: 2 }, { day: "2026-10-15", pr: 3 }, { day: "2026-10-15", pr: null }], "2026-10-13", "2026-10-15");
    expect(days).toEqual([
      { day: "2026-10-13", prs: 2 },
      { day: "2026-10-14", prs: 0 },
      { day: "2026-10-15", prs: 1 },
    ]);
  });
});

describe("making-of: the page's helpers", () => {
  it("writes days the way the page says them", () => {
    expect(shortDay("2026-10-21")).toBe("Oct 21");
    expect(longDay("2026-10-13")).toBe("Tue, Oct 13");
    expect(dayNumber("2026-10-13", "2026-10-13")).toBe(1);
    expect(dayNumber("2026-11-23", "2026-10-13")).toBe(42);
    expect(dayRange("2026-10-13", "2026-10-19")).toBe("Oct 13–19");
    expect(dayRange("2026-10-27", "2026-11-02")).toBe("Oct 27–Nov 2");
  });

  it("keeps both screens full: the newest of each kind so far, else the first there is", () => {
    const frames = [frame("2026-10-13", { phone: shot("p1") }), frame("2026-10-14", { desktop: shot("d1") }), frame("2026-10-15", { phone: shot("p2") })];
    expect(stageAt(frames, 0)).toEqual({ desktop: shot("d1"), phone: shot("p1") });
    expect(stageAt(frames, 2)).toEqual({ desktop: shot("d1"), phone: shot("p2") });
  });

  it("scrubs to the last frame on or before a day", () => {
    const frames = [frame("2026-10-13"), frame("2026-10-16"), frame("2026-10-20")];
    expect(frameForDay(frames, "2026-10-12")).toBe(0);
    expect(frameForDay(frames, "2026-10-18")).toBe(1);
    expect(frameForDay(frames, "2026-11-30")).toBe(2);
  });

  it("sums, finds the busiest day and the share Claude Code opened", () => {
    const days = [
      { day: "a", prs: 2 },
      { day: "b", prs: 5 },
      { day: "c", prs: 5 },
    ];
    expect([...runningTotals(days).values()]).toEqual([2, 7, 12]);
    expect(busiestDay(days)).toEqual({ day: "b", prs: 5 });
    expect(claudeShare({ prs: 1657, byClaude: 1617, issues: 0, screenshots: 0, days: 0 })).toBe(98);
  });
});

describe("making-of: the data the page ships", () => {
  const { first, last, days, frames, chapters, totals, dayOne } = MAKING_OF;

  it("has one bar for every day from the first commit to the last count", () => {
    expect(days[0].day).toBe(first);
    expect(days.at(-1)!.day).toBe(last);
    expect(days).toHaveLength(dayNumber(last, first));
    expect(totals.days).toBe(days.length);
    // One list counts them all: the chart, the running total on the slate and the headline agree.
    expect(days.reduce((s, d) => s + d.prs, 0)).toBe(totals.prs);
    expect(totals.byClaude).toBeLessThanOrEqual(totals.prs);
  });

  it("starts day one with the idea, before any pull request", () => {
    expect(dayOne[0].pr).toBeNull();
    expect(dayOne.slice(1).some((c) => c.pr)).toBe(true);
  });

  it("shows frames in order, each with a picture that exists and was safe to show", () => {
    expect(frames.length).toBeGreaterThanOrEqual(30);
    for (const [k, f] of frames.entries()) {
      if (k) expect(f.day >= frames[k - 1].day, `frame ${k} out of order`).toBe(true);
      expect(f.day >= first && f.day <= last).toBe(true);
      expect(f.caption.length).toBeGreaterThan(0);
      expect(f.caption).not.toMatch(/—/);
      const shots = [f.desktop, f.phone].filter(Boolean) as Shot[];
      expect(shots.length, `frame ${k} has no picture`).toBeGreaterThan(0);
      for (const sh of shots) {
        expect(openPageSafe(sh.from), sh.from).toBe(true);
        for (const pic of [sh.card, sh.full]) expect(existsSync(join(__dirname, "..", "public", pic.src)), pic.src).toBe(true);
      }
    }
  });

  it("covers every day with an episode, and every episode has frames", () => {
    expect(chapters[0].from).toBe(first);
    for (let k = 1; k < chapters.length; k++) expect(dayNumber(chapters[k].from, chapters[k - 1].to)).toBe(2);
    expect(chapterOf(last).id).toBe(chapters.at(-1)!.id);
    for (const ep of episodes()) expect(ep.frames.length, ep.title).toBeGreaterThan(0);
    expect(episodes().reduce((s, e) => s + e.prs, 0)).toBe(days.reduce((s, d) => s + d.prs, 0));
  });

  it("is a public page in the sitemap", () => {
    expect(PUBLIC_PATHS).toContain("/making-of");
  });
});
