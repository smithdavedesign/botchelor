import { describe, expect, it } from "vitest";
import { recouplingIn } from "@/app/watch/SeasonLine";
import { premiereTimeWords } from "@/lib/premiere-clock";
import { seasonArc } from "@/lib/season-format";
import { daysUntil } from "@/lib/season-window";

// The 2026-11-22 audit: the strip under the header said "8 days to the finale" while /watch's season line said "the
// Recoupling in 9 days" for the same night (one counted UTC days, the other rounded hours), and the December season's
// page said "Starts Mon, Nov 30, 4:00 PM PST" beside a pilot line in UTC, ET and PT. One count of days, one zone.
const at = (iso: string) => new Date(iso);

describe("days to something (lib/season-window.ts daysUntil)", () => {
  it("counts UTC days, whatever the hour", () => {
    expect(daysUntil(at("2026-11-22T00:00:00Z"), "2026-11-22T23:59:00Z")).toBe(0);
    expect(daysUntil(at("2026-11-22T23:59:00Z"), "2026-11-23T00:01:00Z")).toBe(1);
    expect(daysUntil(Date.parse("2026-11-22T03:00:00Z"), at("2026-11-30T20:00:00Z"))).toBe(8);
    expect(daysUntil(at("2026-11-30T20:00:00Z"), "2026-11-22T03:00:00Z")).toBe(-8);
  });

  it("the season line's Recoupling and the strip's finale say the same number of days", () => {
    // The season's last night is 30 November; at 03:00 UTC on the 22nd it is 8 days and 17 hours to 20:00 that night.
    const now = at("2026-11-22T03:00:00Z");
    const arc = seasonArc(now);
    expect(arc).toMatchObject({ night: 22, nights: 30, left: 8, to: "finale" });
    // Rounding the hours said 9 (209 h / 24 = 8.7).
    expect(recouplingIn("2026-11-30T20:00:00Z", now.getTime())).toBe(`in ${arc.left} days`);
    expect(recouplingIn("2026-11-30T20:00:00Z", Date.parse("2026-11-22T23:00:00Z"))).toBe("in 8 days");
    expect(recouplingIn("2026-11-30T20:00:00Z", Date.parse("2026-11-29T23:00:00Z"))).toBe("in 21h");
    expect(recouplingIn("2026-11-30T20:00:00Z", Date.parse("2026-11-29T19:00:00Z"))).toBe("in 1 day");
    expect(recouplingIn("2026-11-30T20:00:00Z", Date.parse("2026-11-30T16:00:00Z"))).toBe("tonight (in 4h)");
  });
});

describe("a season's times in one zone (lib/premiere-clock.ts premiereTimeWords)", () => {
  it("says a weekly time as the premiere's line does, the US's own day beside it when that's another", () => {
    expect(premiereTimeWords("2026-12-06T23:00:00.000Z", { weekly: true })).toBe("Sundays, 23:00 UTC (6 pm ET, 3 pm PT)");
    expect(premiereTimeWords("2026-12-01T00:00:00.000Z", { day: true })).toBe("Tuesday 1 December, 00:00 UTC (Mon 7 pm ET, Mon 4 pm PT)");
    expect(premiereTimeWords("2026-12-07T00:20:00.000Z", { weekly: true })).toBe("Mondays, 00:20 UTC (Sun 7:20 pm ET, Sun 4:20 pm PT)");
  });
});
