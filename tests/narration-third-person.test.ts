// The narration's third person (lib/narration.ts tellsThemInThirdPerson): story mode says "you" from first to last, and
// a reply that tells the person as "he", "she" or as the character's guest has drifted. Found again on a live redraw,
// 2026-11-23 ("He found his guest already inside"), where no pronoun gave it away.
import { describe, expect, it } from "vitest";
import { tellsThemInThirdPerson } from "@/lib/narration";

describe("the person told in the third person", () => {
  it("is caught by the other set of pronouns, as before", () => {
    expect(tellsThemInThirdPerson("Then he was beside her, close enough to count her freckles.", "he/him")).toBe("her");
    expect(tellsThemInThirdPerson("She set her glass down and looked at him.", "she/her")).toBe("him");
  });

  it("is caught as the character's guest, visitor, date or companion when there's no you anywhere in the prose", () => {
    expect(tellsThemInThirdPerson("Barnaby pushed the door open. He found his guest already inside, studying the clocks.", "he/him")).toBe("guest");
    expect(tellsThemInThirdPerson("She poured two glasses and carried one to her visitor by the window.", "she/her")).toBe("visitor");
    expect(tellsThemInThirdPerson("He held the chair for his date and waited.", "he/him")).toBe("date");
  });

  it("is left alone when the prose says you, when it's inside what's said, and when it's nobody of theirs", () => {
    expect(tellsThemInThirdPerson("He found you already inside, and smiled at his guest of honour: you.", "he/him")).toBeNull();
    expect(tellsThemInThirdPerson('He straightened a clock. "A good host never keeps his guest waiting," he said.', "he/him")).toBeNull();
    expect(tellsThemInThirdPerson("The guests had all gone home, and he was glad of it.", "he/him")).toBeNull();
    // A character who is a they can't be told apart from the person this way: left alone, as before.
    expect(tellsThemInThirdPerson("They found their guest already inside.", "they/them")).toBeNull();
  });
});
