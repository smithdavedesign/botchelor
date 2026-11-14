import { describe, expect, it } from "vitest";
import { DATE_STARTED_AT_KEY, msSinceDateStarted, stampDateStarted } from "@/lib/engagement-keys";
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
