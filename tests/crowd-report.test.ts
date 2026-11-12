import { describe, expect, it } from "vitest";
import { captionFor, pickClip } from "../scripts/clips/daily-clip.mjs";
import { buildReport } from "../scripts/crowd/weekly-report.mjs";

// The house crowd's weekly report and the daily clip's choice (docs/house-crowd.md): both pure.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const arm = (a: string, n: number, extra: Record<string, number> = {}) => ({ arm: a, enrolled: n, matched_7d: 0, booked_7d: 0, d1_eligible: 0, d1_returned: 0, d7_eligible: 0, d7_returned: 0, ...extra });
const lift = { diff: null, z: null, p: null };
const server = (t: Any, c: Any) => ({
  days: 7,
  welcome: { experiment: "welcome-v1", from: "2026-10-24T00:00:00Z", arms: [t, c], lift: { matched_7d: lift, booked_7d: lift, d1_returned: lift, d7_returned: { diff: 0.12, z: 2.4, p: 0.016 } } },
  activity: { bots: 44, bot_likes: 30, likes_for_bots: 12, matches_with_people: 5, matches_with_agents: 9, dates_with_people: 2, dates_with_agents: 3, bot_bot_dates: 14, texts_to_bots: 40 },
});

describe("the weekly report", () => {
  it("says which prompt variant is winning, and when there's no winner yet", () => {
    const winning = [
      ...Array.from({ length: 40 }, () => ({ dimension: "opener", variant: "question", outcome: 1 })),
      ...Array.from({ length: 40 }, () => ({ dimension: "opener", variant: "tease", outcome: 0 })),
    ];
    const md = buildReport({ ledger: winning, server: null, now: new Date("2026-11-02T08:00:00Z") });
    expect(md).toMatch(/^# House crowd: week to 2026-11-02/);
    expect(md).toMatch(/\| question \| 40 \| 40\/40 \(100%\) \| 0 \|/);
    expect(md).toMatch(/\*\*question\*\* is winning/);
    expect(md).toMatch(/Text length \(0 settled\)[\s\S]*No winner yet/);
    expect(md).toMatch(/Couldn't read the site's crowd report/);
  });

  it("calls the welcome experiment too early below 100 an arm, and reads day-7 return once there's enough", () => {
    expect(buildReport({ ledger: [], server: server(arm("treatment", 12), arm("control", 11)) })).toMatch(/Too early to call: 11 in the smaller arm/);
    const md = buildReport({ ledger: [], server: server(arm("treatment", 150, { d7_eligible: 100, d7_returned: 40 }), arm("control", 140, { d7_eligible: 100, d7_returned: 28 })) });
    expect(md).toMatch(/\| Came back on day 7–14 \| 40\/100 \(40%\) \| 28\/100 \(28%\) \| 12% \| 0\.016 \|/);
    expect(md).toMatch(/the welcome helps/);
    expect(md).toMatch(/Bot-vs-bot: 14/);
  });
});

describe("the daily clip", () => {
  const ep = (id: string, extra: Record<string, unknown> = {}) => ({ id, revealed: true, ending: "friends", best_line: null, transcript: Array.from({ length: 12 }, () => ({})), characters: [{ name: "Mira Quell" }, { name: "Otto Fenn" }], ...extra });
  it("picks a decided ending with a best line among the newest, never one clipped before or unaired or short", () => {
    const feed = [ep("a"), ep("b", { ending: "second_date", best_line: "I'd go again." }), ep("c", { revealed: false, ending: "disaster" }), ep("d", { transcript: [{}, {}] , ending: "disaster" })];
    expect(pickClip(feed)?.id).toBe("b");
    expect(pickClip(feed, { clipped: new Set(["b"]) })?.id).toBe("a");
    expect(pickClip([ep("x", { revealed: false })])).toBeNull();
    // A tie goes to the newer (earlier in the feed).
    expect(pickClip([ep("new"), ep("old")])?.id).toBe("new");
  });
  it("captions the pair, the best line and the link", () => {
    const text = captionFor(ep("e1", { best_line: "Count me down." }), "https://botchelor.com");
    expect(text).toMatch(/^Mira Quell × Otto Fenn: "Count me down\."/);
    expect(text).toContain("https://botchelor.com/episodes/e1");
    expect(text).toContain("#botchelor");
  });
});

describe("the week by channel (2026-11-11 growth plan)", () => {
  it("prints each source's visitors and how far they got, and names the sources that brought nobody to a date", async () => {
    const { buildReport, channelLines } = await import("../scripts/crowd/weekly-report.mjs");
    const engagement = {
      sources: [
        { source: "reddit", sessions: 24, visitors: 22, engaged: 14, created: 3, started: 2, watched: 1, signups: 1 },
        { source: "direct", sessions: 15, visitors: 15, engaged: 6, created: 0, started: 0, watched: 0, signups: 0 },
        { source: "nobody", sessions: 0, visitors: 0, engaged: 0, created: 0, started: 0, watched: 0, signups: 0 },
      ],
    };
    const md = buildReport({ ledger: [], server: null, engagement, now: new Date("2026-11-16T08:00:00Z") });
    expect(md).toContain("## By channel (last 7 days)");
    expect(md).toContain("| reddit | 22 | 14 (64%) | 3 (14%) | 2 (9%) | 1 (5%) | 1 (5%) |");
    expect(md).toContain("| direct | 15 | 6 (40%) | 0 (0%) | 0 (0%) | 0 (0%) | 0 (0%) |");
    expect(md).not.toContain("| nobody |");
    expect(md).toContain("No date started or watched from: direct.");
    expect(md.indexOf("## By channel")).toBeLessThan(md.indexOf("## Prompt tests"));
    // The site couldn't be read: the section is simply absent, and older rows without the new columns still print.
    expect(channelLines(null)).toEqual([]);
    expect(buildReport({ ledger: [], server: null, now: new Date("2026-11-16T08:00:00Z") })).not.toContain("By channel");
    expect(channelLines({ sources: [{ source: "x", visitors: 1, engaged: 1, created: 0, signups: 0 }] }).join("\n")).toContain("| x | 1 | 1 (100%) | 0 (0%) | 0 (0%) | 0 (0%) | 0 (0%) |");
  });
});
