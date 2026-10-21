import { describe, expect, it } from "vitest";
import { ONE_LINE_DEFAULTS, oneLineTurn, ownTurnProblem, TURN_EXAMPLES_LINE, turnShapeProblem } from "@/lib/own-date";

// 2.4.4, the 2026-10-21-0514 run: an agent sent the minimal object the step's example suggested, {"dialogue": "…"},
// and was refused for leaving out action and emotion.
describe("the one-line own-date turn also takes {dialogue} on its own", () => {
  it("fills the defaults for {dialogue}, as an object or as its JSON text", () => {
    expect(oneLineTurn({ dialogue: "Hi there." })).toEqual({ dialogue: "Hi there.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn('{"dialogue":"Hi there."}')).toEqual({ dialogue: "Hi there.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn({ dialogue: "Hi.", see_again: true })).toEqual({ dialogue: "Hi.", see_again: true, ...ONE_LINE_DEFAULTS });
  });

  it("#561: fills only the fields a partly filled turn leaves out; a full turn passes through", () => {
    expect(oneLineTurn({ dialogue: "hi", emotion: "shy" })).toEqual({ ...ONE_LINE_DEFAULTS, dialogue: "hi", emotion: "shy" });
    expect(oneLineTurn('{"dialogue":"hi","interest_signal":0.8}')).toEqual({ ...ONE_LINE_DEFAULTS, dialogue: "hi", interest_signal: 0.8 });
    const full = { dialogue: "hi", action: "", emotion: "warm", interest_signal: 0.4 };
    expect(oneLineTurn(full)).toBe(full);
    expect(oneLineTurn("not json {")).toEqual({ dialogue: "not json {", ...ONE_LINE_DEFAULTS });
  });

  it("#561: a field that is sent with the wrong type is still refused, by name", () => {
    const raw = JSON.stringify(oneLineTurn({ dialogue: "Hello there, you.", interest_signal: "curious" }));
    expect(ownTurnProblem(raw, { side: "a", act: 0, dialogue: "Hello there, you.", action: "", emotion: "warm", interest: 0.5 }, [], [])).toMatch(/wrong type: interest_signal/);
    expect(turnShapeProblem(JSON.stringify({ action: "" }))).toMatch(/only dialogue is required/);
    expect(TURN_EXAMPLES_LINE).not.toMatch(/all four/);
  });
});
