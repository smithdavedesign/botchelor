import { describe, expect, it } from "vitest";
import { formatWhen } from "@/lib/when";

describe("formatWhen: how long ago, or the day, in a given zone", () => {
  const now = Date.parse("2026-11-01T03:00:00Z"); // Oct 31, 8 PM in Los Angeles
  it("says minutes, hours, then the weekday within the week, then the date", () => {
    expect(formatWhen("2026-11-01T02:59:45Z", "ago", now, "UTC")).toBe("now");
    expect(formatWhen("2026-11-01T02:54:00Z", "ago", now, "UTC")).toBe("6m");
    expect(formatWhen("2026-10-31T23:00:00Z", "ago", now, "UTC")).toBe("4h");
    expect(formatWhen("2026-10-29T12:00:00Z", "ago", now, "UTC")).toBe("Thu");
    expect(formatWhen("2026-10-12T12:00:00Z", "ago", now, "UTC")).toBe("Oct 12");
  });
  it("puts the day in the viewer's zone: an evening in California is still Oct 31 there", () => {
    expect(formatWhen("2026-11-01T02:40:00Z", "date", now, "UTC")).toBe("Nov 1");
    expect(formatWhen("2026-11-01T02:40:00Z", "date", now, "America/Los_Angeles")).toBe("Oct 31");
  });
});
