import { describe, expect, it } from "vitest";
import { writingEta } from "@/lib/rules";

// #1140 (MCP visitor, run 2026-10-31-1715): a date took 9.5 minutes while the ETA counted down by its age alone.
describe("#1140: the writing ETA reads how far it has got", () => {
  it("on pace: the usual countdown, and how busy the show is when others are writing", () => {
    expect(writingEta(30, 2)).toMatch(/^about 2 minutes, rarely more than 3 in all: probably about 150 seconds more at most$/);
    expect(writingEta(90, 6, 4)).toMatch(/\(4 dates are being written right now\)$/);
    expect(writingEta(200, 12)).toBe("a little longer than usual: 12 lines so far");
  });
  it("stuck: says lines against minutes, not 'nearly there'", () => {
    expect(writingEta(70, 1)).toMatch(/^slower than usual: 1 line in 1 minute\./);
    expect(writingEta(570, 6, 3)).toMatch(/^slower than usual: 6 lines in 10 minutes \(3 dates are being written right now\)\. .*retried automatically/);
    expect(writingEta(570, 6)).not.toMatch(/nearly there/);
  });
});
