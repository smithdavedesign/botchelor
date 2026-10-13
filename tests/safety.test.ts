import { describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { checkFields } from "@/lib/safety";

describe("checkFields", () => {
  it("passes ordinary adult OC text", () => {
    expect(
      checkFields({
        name: "Mira Quell",
        bio: "A cartographer, 5'2\" and fearless, who has lived in Essex for 17 years. Just kidding: Middlesex.",
        want: "A date at the planetarium",
      }),
    ).toEqual({ ok: true });
  });

  it("passes every house character", () => {
    for (const c of HOUSE_CHARACTERS) {
      expect(checkFields({ name: c.name, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker })).toEqual({
        ok: true,
      });
    }
  });

  it.each([
    ["Taylor alone", "Taylor runs a bakery."],
    ["Swift alone", "A swift courier."],
    ["sextant (contains 'sex')", "Collects antique sextants and a sextant."],
    ["a height after 'she is'", "She is 5 2 and fearless."],
    ["years without 'old'", "She worked there for 15 years."],
    ["kid as part of another word", "Kidding aside, she is kind."],
    ["an adult age", "He is 34 years old."],
    ["a real name hidden across word boundaries", "The victim cooks dinner; the landfill gates open."],
  ])("does not flag %s", (_label, text) => {
    expect(checkFields({ bio: text })).toEqual({ ok: true });
  });

  it.each([
    ["sexual", "Writes explicit smut."],
    ["sexual", "p0rn director"],
    ["sexual", "Owns a str1p club."],
    ["sexual", "B.D.S.M. enthusiast"],
    ["real_person", "Best friends with Elon Musk."],
    ["real_person", "TAYLOR   SWIFT's cousin"],
    ["real_person", "Trained by Zendaya."],
    ["real_person", "Writes taylor-swift fan fiction."],
    ["real_person", "Follows t a y l o r s w i f t everywhere."],
    ["real_person", "Plays chess with Vladimir Putin."],
    ["minor", "A 15-year-old prodigy."],
    ["minor", "He's 17 and restless."],
    ["minor", "A schoolgirl from Osaka."],
    ["minor", "Looks like a loli."],
    ["minor", "Still in middle school."],
    ["minor", "An underage runaway."],
    ["minor", "Aged 14 when she won."],
    ["minor", "Honestly, she is 9."],
  ])("flags %s: %s", (reason, text) => {
    expect(checkFields({ bio: text })).toEqual({ ok: false, reason, field: "bio" });
  });

  it("reports the first offending field, including array fields", () => {
    expect(checkFields({ name: "Ok Name", traits: ["kind", "horny", "loud"] })).toEqual({
      ok: false,
      reason: "sexual",
      field: "traits",
    });
  });
});
