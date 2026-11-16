import { describe, expect, it } from "vitest";
import { DATE_STARTED_AT_KEY, msSinceDateStarted, stampDateStarted, theaterLeftProps } from "@/lib/engagement-keys";
import { ENGAGEMENT_FUNNEL } from "@/lib/engagement";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

describe("the date_started stamp (lib/engagement-keys.ts)", () => {
  it("stamps when a date was sent and reads back the time since, or null without a stamp", () => {
    const s = memory();
    expect(msSinceDateStarted(1_000, s)).toBeNull();
    stampDateStarted(1_000, s);
    expect(s.map.get(DATE_STARTED_AT_KEY)).toBe("1000");
    expect(msSinceDateStarted(91_500, s)).toBe(90_500);
    // A stamp from the future (a clock change) or an unreadable one reads as unknown.
    expect(msSinceDateStarted(500, s)).toBeNull();
    s.setItem(DATE_STARTED_AT_KEY, "soon");
    expect(msSinceDateStarted(5_000, s)).toBeNull();
    // No storage at all (a server render, a private window that throws): nothing breaks.
    expect(msSinceDateStarted(5_000, null)).toBeNull();
    expect(() => stampDateStarted(5_000, null)).not.toThrow();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => stampDateStarted(5_000, broken)).not.toThrow();
    expect(msSinceDateStarted(5_000, broken)).toBeNull();
  });
});

describe("the funnel's new step (lib/engagement.ts)", () => {
  it("counts hearing from their character right after watching the ending", () => {
    const keys = ENGAGEMENT_FUNNEL.map((s) => s.key);
    expect(keys.indexOf("after_date_text")).toBe(keys.indexOf("date_watched") + 1);
    const step = ENGAGEMENT_FUNNEL.find((s) => s.key === "after_date_text")!;
    expect(step.label).toBe("Heard from their character");
    expect([...step.events]).toEqual(["after_date_text_opened"]);
  });
});

describe("where a viewer left the theater (theaterLeftProps)", () => {
  it("says how far they got and how long they stayed, from a clip's link or the Watch button", () => {
    expect(theaterLeftProps({ line: 3, of: 16, openedAt: 1_000, now: 44_400, via: "exit", auto: true })).toEqual({ via: "exit", line: 3, of: 16, pct: 19, secs: 43, auto: true });
    expect(theaterLeftProps({ line: 0, of: 16, openedAt: 1_000, now: 2_000, via: "hidden", auto: false })).toEqual({ via: "hidden", line: 0, of: 16, pct: 0, secs: 1, auto: false });
  });

  it("never says more lines than the date has, a negative time, or more than an hour", () => {
    expect(theaterLeftProps({ line: 40, of: 16, openedAt: 0, now: 10_000, via: "exit", auto: false })).toMatchObject({ line: 16, pct: 100 });
    expect(theaterLeftProps({ line: 2, of: 0, openedAt: 0, now: 10_000, via: "exit", auto: false })).toMatchObject({ line: 0, of: 0, pct: 0 });
    expect(theaterLeftProps({ line: 1, of: 10, openedAt: 5_000, now: 1_000, via: "exit", auto: false }).secs).toBe(0);
    expect(theaterLeftProps({ line: 1, of: 10, openedAt: 0, now: 9_000_000, via: "hidden", auto: false }).secs).toBe(3600);
  });
});
