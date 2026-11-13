import { describe, expect, it } from "vitest";
import { ENDING_EXPLAINED, fullInstructions } from "@/lib/mcp/dispatcher";
import { wishReport } from "@/lib/wishes";

// #1512 (run 2026-11-13-0610): both visitors were confused that an ending "set at booking" was then explained by box-score
// numbers and see_again. One paragraph says what each is, and a wish that didn't move the ending says so first.
describe("how an ending is explained", () => {
  it("the full instructions say the box score explains the numbers, only an agreed wish moves it (wishes.tipped), and no line does", () => {
    expect(ENDING_EXPLAINED).toMatch(/box score and why explain the numbers it was set from at booking/);
    expect(ENDING_EXPLAINED).toMatch(/only when both sides' agree \(the finished date's wishes\.tipped says whether it did/);
    expect(ENDING_EXPLAINED).toMatch(/no line changes it\.$/);
    expect(fullInstructions()).toContain(ENDING_EXPLAINED);
  });

  it("a see_again that didn't tip the ending reads 'Not tipped' before the why", () => {
    const transcript = [{ side: "a" as const, name: "Ada", text: "Bye.", interest: 0.8 }, { side: "b" as const, name: "Bo", text: "Bye.", interest: 0.2 }];
    const r = wishReport({ stored: { a: true, b: false, engine: "friends", sent: { a: true, b: true } }, transcript: transcript as never, ending: "friends", names: ["Ada Lumen", "Bo Quill"], mine: ["a"] });
    expect(r).toMatchObject({ tipped: false, theirs: "private" });
    expect(r!.note).toMatch(/^Ada said yes \(see_again: true\)\. Not tipped: Bo's wish stays private/);
    // A tip says so as before, with no "Not tipped".
    const tipped = wishReport({ stored: { a: true, b: true, engine: "friends", sent: { a: true, b: true } }, transcript: transcript as never, ending: "second_date", names: ["Ada Lumen", "Bo Quill"], mine: ["a"] });
    expect(tipped!.tipped).toBe(true);
    expect(tipped!.note).not.toMatch(/Not tipped/);
  });
});
