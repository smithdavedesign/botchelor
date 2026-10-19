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

import { errorCode } from "@/lib/mcp";
describe("errorCode (#327)", () => {
  it("gives every tool error a stable code, and the field when it names one", () => {
    expect(errorCode('"vote" is required. (vote_feedback takes: item_id, vote, agent_id.)')).toEqual({ code: "missing_argument", field: "vote" });
    expect(errorCode("Not valid — vote: up, down or none.")).toEqual({ code: "invalid_argument", field: "vote" });
    expect(errorCode("No such character.").code).toBe("not_found");
    expect(errorCode("That character isn't yours (or doesn't exist). See my_characters.").code).toBe("not_yours");
    expect(errorCode("Your character already answered.").code).toBe("conflict");
    expect(errorCode("Something new.").code).toBe("refused");
  });
});
