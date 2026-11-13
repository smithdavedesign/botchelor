import { describe, expect, it } from "vitest";
import { crowdLocalHour, crowdMinutesToWake } from "@/lib/house-bots";
import { botReplySeconds, HOUSE_BOT_EVERY_MINUTES, HOUSE_BOT_REPLY_SECONDS } from "@/lib/mcp/dispatcher";
import * as P from "../scripts/crowd/policy.mjs";

// #1523 (the 2026-11-13 runs): a crowd bot seen a minute ago promised "usually within 120 seconds", then didn't answer for
// 8 to 50 minutes: it was mid-pass, and its next pass was about 40 minutes off (or it was asleep).
describe("how soon a house-run bot answers (#1523)", () => {
  it("knows each crowd bot's local hour and sleep as the crowd's own policy does", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `bot-${i}-${(i * 7919).toString(36)}`);
    for (let h = 0; h < 24; h++) {
      const now = Date.UTC(2026, 10, 13, h, 17);
      for (const id of ids) {
        expect(crowdLocalHour(id, now)).toBe(P.localHour(id, now));
        expect(crowdMinutesToWake(id, now) === 0).toBe(P.isAwake(id, now));
      }
    }
  });

  it("a crowd bot never promises two minutes: its reply comes on the next pass", () => {
    expect(botReplySeconds({ minutes: 1, crowd: true, asleep_minutes: 0 })).toBe((HOUSE_BOT_EVERY_MINUTES - 1 + 10) * 60);
    expect(botReplySeconds({ minutes: 1, crowd: true, asleep_minutes: 0 })).not.toBe(HOUSE_BOT_REPLY_SECONDS);
    // Its pass is due: about the pass's own length.
    expect(botReplySeconds({ minutes: 45, crowd: true, asleep_minutes: 0 })).toBe(10 * 60);
    // Asleep: the first pass after it wakes.
    expect(botReplySeconds({ minutes: 5, crowd: true, asleep_minutes: 180 })).toBe((180 + HOUSE_BOT_EVERY_MINUTES + 10) * 60);
    // Gone past the pause line: nothing promised.
    expect(botReplySeconds({ minutes: 120, crowd: true, asleep_minutes: 0 })).toBeNull();
  });

  it("a live loop script seen just now still answers in two minutes", () => {
    expect(botReplySeconds({ minutes: 1, crowd: false, asleep_minutes: 0 })).toBe(HOUSE_BOT_REPLY_SECONDS);
    expect(botReplySeconds(1)).toBe(HOUSE_BOT_REPLY_SECONDS);
  });
});
