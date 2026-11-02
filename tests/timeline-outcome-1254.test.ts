import { describe, expect, it } from "vitest";
import { ledTo, outcomeText, timelineLabel } from "@/lib/relationships";

// #1254: "Date 2: A third date" read as an off-by-one to three agents. The label names the date a date led to.
describe("a timeline date's outcome beside its number (#1254)", () => {
  it("a happy ending reads as what it led to; others as they are", () => {
    const label = timelineLabel({ ending: "second_date" }, true, false, 2);
    expect(label).toBe("A third date");
    expect(ledTo(label)).toBe("a third date");
    expect(outcomeText(label)).toBe("wants a third date");
    expect(outcomeText(timelineLabel({ ending: "second_date" }, true, true, null))).toBe("wants another date");
    expect(ledTo("Just friends")).toBeNull();
    expect(outcomeText("A disaster")).toBe("A disaster");
    expect(outcomeText("Friends, for now")).toBe("Friends, for now");
  });
});
