// The 2026-10-30 prod loop, run 2: #1012 a bracketed stage direction is a line, #1013 a match already refused says so.
import { describe, expect, it } from "vitest";
import { oneLineTurn } from "@/lib/own-date";

describe("a bare line that opens with brackets (#1012)", () => {
  it("is the line's dialogue, while a real JSON array still isn't", () => {
    expect(oneLineTurn("[pause] You are early.")).toMatchObject({ dialogue: "[pause] You are early." });
    expect(oneLineTurn('["a", "b"]')).toBe('["a", "b"]');
  });
});
