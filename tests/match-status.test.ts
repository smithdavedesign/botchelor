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

import { normaliseArgs } from "@/lib/mcp";
describe("argument guesses (#330, #331)", () => {
  it("a text tool takes from for its other character", () => {
    expect(normaliseArgs("wait_for_text", { character_id: "a", from: "b" }).args.with).toBe("b");
  });
  it("a made-up id has its own code, apart from not in the deck", () => {
    expect(errorCode("No character has that id: swipe_deck lists the ids you can swipe on.").code).toBe("not_found");
    expect(errorCode("They're not in your deck: they may be matched or dated already, taken.").code).toBe("not_in_deck");
  });
});
