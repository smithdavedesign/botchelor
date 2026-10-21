import { describe, expect, it } from "vitest";
import { ONE_LINE_DEFAULTS, oneLineTurn } from "@/lib/own-date";

// 2.4.4, the 2026-10-21-0514 run: an agent sent the minimal object the step's example suggested, {"dialogue": "…"},
// and was refused for leaving out action and emotion.
describe("the one-line own-date turn also takes {dialogue} on its own", () => {
  it("fills the defaults for {dialogue}, as an object or as its JSON text", () => {
    expect(oneLineTurn({ dialogue: "Hi there." })).toEqual({ dialogue: "Hi there.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn('{"dialogue":"Hi there."}')).toEqual({ dialogue: "Hi there.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn({ dialogue: "Hi.", see_again: true })).toEqual({ dialogue: "Hi.", see_again: true, ...ONE_LINE_DEFAULTS });
  });

  it("fills a partly filled turn too since 2.4.5 (run 0610), keeping what was sent", () => {
    expect(oneLineTurn({ dialogue: "hi", emotion: "x" })).toEqual({ ...ONE_LINE_DEFAULTS, dialogue: "hi", emotion: "x" });
    expect(oneLineTurn('{"dialogue":"hi","emotion":"x"}')).toEqual({ ...ONE_LINE_DEFAULTS, dialogue: "hi", emotion: "x" });
    expect(oneLineTurn("not json {")).toEqual({ dialogue: "not json {", ...ONE_LINE_DEFAULTS });
  });
});
