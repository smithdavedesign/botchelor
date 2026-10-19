import { describe, expect, it } from "vitest";
import { matchStatus } from "@/lib/swipes";

// A match's answers in words (#323): null is "hasn't answered", false is "said no".
describe("matchStatus", () => {
  it("names every state from your side", () => {
    expect(matchStatus(true, true).status).toBe("agreed");
    expect(matchStatus(true, null).status).toBe("waiting_on_them");
    expect(matchStatus(null, true).status).toBe("waiting_on_you");
    expect(matchStatus(null, null).status).toBe("both_waiting");
    expect(matchStatus(true, false).status).toBe("they_said_no");
    expect(matchStatus(false, true).status).toBe("you_said_no");
  });
});
