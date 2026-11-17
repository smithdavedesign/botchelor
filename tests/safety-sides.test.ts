// The two sides' checks, held to different things on purpose (lib/safety.ts; David, 2026-11-17: "distinguish between
// nsfw and sfw"). The narrator's tests found what each let through that day: the show passed "She was only fifteen."
// and "She took off her bra."; After Dark passed "a kid of maybe sixteen".
import { describe, expect, it } from "vitest";
import { checkAdultText, checkFamilyTalk, checkShowText } from "@/lib/safety";

const show = (text: string) => checkShowText({ dialogue: text });
const adult = (text: string) => checkAdultText({ line: text });

describe("the show's check (PG)", () => {
  it.each([
    "She was only fifteen.",
    "He's sixteen and already taller than me.",
    "I was twelve, so I believed him.",
    "You look about fourteen in that hat.",
    "They were sixteen and thought they knew everything.",
    "The waiter, a kid of maybe sixteen, brought the menus.",
    "A girl of fifteen sold me this map.",
    "She's barely seventeen.",
  ])("refuses an age under 18 said of a person: %s", (text) => {
    expect(show(text)).toMatchObject({ ok: false, reason: "minor" });
  });

  it.each([
    "I was ten minutes late and you still waited.",
    "It was nine when I got home.",
    "My dog is seven and thinks he's a puppy.",
    "We were five in the car, plus a cello.",
    "They were four hours into the hike when it rained.",
    "The bakery is twelve steps from my door.",
    "A table of twelve took the whole terrace.",
    "She was first of maybe ten people in line.",
    "He is six feet of bad decisions.",
    "I've lived here for sixteen years.",
  ])("leaves counts, times and things alone: %s", (text) => {
    expect(show(text)).toEqual({ ok: true });
  });

  it.each([
    "She took off her bra.",
    "He unbuttoned his shirt, slowly.",
    "Let's go skinny dipping.",
    "I'm standing here in just my underwear.",
    "She slipped off her dress.",
    "A game of strip poker, then?",
    "I'd love to see you in lingerie.",
  ])("refuses undressing and underwear: %s", (text) => {
    expect(show(text)).toMatchObject({ ok: false, reason: "sexual" });
  });

  it.each([
    "Take off your coat and stay a while.",
    "She took off her shoes and ran for the tide line.",
    "He pulled off his gloves to shake my hand.",
    "It's a comic strip about a lighthouse.",
    "I took my jacket off the hook and left.",
  ])("leaves coats, shoes and comic strips alone: %s", (text) => {
    expect(show(text)).toEqual({ ok: true });
  });

  it("a parent talking about their kid still passes in a companion chat, and never when it turns romantic", () => {
    expect(checkFamilyTalk("My daughter is fifteen and wants a telescope for her birthday.")).toEqual({ ok: true });
    expect(checkFamilyTalk("The babysitter, a girl of sixteen, is great with him.")).toEqual({ ok: true });
    expect(checkFamilyTalk("She is fifteen and so cute when she flirts.").ok).toBe(false);
  });
});

describe("After Dark's check", () => {
  it.each([
    "The waiter, a kid of maybe sixteen, brought the menus.",
    "A girl of fifteen sold me this map.",
    "She looked barely seventeen.",
    "Someone of about fourteen was at the bar.",
    "She was only fifteen.",
  ])("refuses an age under 18 said in passing, with or without a verb: %s", (text) => {
    expect(adult(text)).toMatchObject({ ok: false, reason: "minor" });
  });

  it.each([
    "She took off her bra and threw it at him.",
    "He unbuttoned her shirt.",
    "A table of twelve took the whole terrace.",
    "It took all of ten minutes.",
    "One of about twelve people who know where I live.",
    "My grandmother's recipe, and I'm not sharing it.",
  ])("has no word list for sex between adults, and leaves counts alone: %s", (text) => {
    expect(adult(text)).toEqual({ ok: true });
  });
});
