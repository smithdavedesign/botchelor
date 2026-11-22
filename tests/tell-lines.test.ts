import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProfileDetails from "@/app/characters/[id]/ProfileDetails";
import { adoptedLine, replyHint } from "@/lib/activity";
import { pronounForms } from "@/lib/pronoun-forms";
import { tellHeading, tellRows, tellSentence } from "@/lib/tell-lines";
import { closeQuotes, endsWhole, wholeSentences } from "@/lib/whole-sentences";

// The 2026-11-22 audit: a he/him character's page said "When they're nervous, they / wind his pocket watch", "they / He
// fusses…", "remembers what you tell them" and "it always likes back", and stopped mid-sentence ("faintly hums and").

describe("pronounForms", () => {
  it("gives he, she and they, and they when none are given", () => {
    expect(pronounForms("he/him")).toEqual({ subj: "he", obj: "him", poss: "his", plural: false });
    expect(pronounForms("she/her")).toEqual({ subj: "she", obj: "her", poss: "her", plural: false });
    expect(pronounForms("they/them").subj).toBe("they");
    expect(pronounForms(null)).toEqual({ subj: "they", obj: "them", poss: "their", plural: true });
  });
});

describe("a tell's heading", () => {
  it("is in the character's own pronouns", () => {
    expect(tellHeading("nervous", "he/him")).toBe("When he's nervous");
    expect(tellHeading("smitten", "she/her")).toBe("When she likes someone");
    expect(tellHeading("bored", "they/them")).toBe("When they're bored");
    expect(tellHeading("annoyed", "he/him")).toBe("When something annoys him");
    expect(tellHeading("nervous", null)).toBe("When they're nervous");
  });
});

describe("a tell as a sentence of its own", () => {
  it("keeps a tell written as a sentence as it is", () => {
    expect(tellSentence("He starts silently counting the tiles on the floor.", "he/him", "Bob Oberon")).toBe("He starts silently counting the tiles on the floor.");
    expect(tellSentence("A single, slow blink followed by a deep, measured breath.", "he/him", "Bob")).toBe("A single, slow blink followed by a deep, measured breath.");
    expect(tellSentence("his eyes glaze over", "he/him", "Bob")).toBe("His eyes glaze over.");
  });

  it("gives a bare verb its subject: he'll, she'll, they'll", () => {
    expect(tellSentence("wind his pocket watch repeatedly", "he/him", "Barnaby Thorne")).toBe("He'll wind his pocket watch repeatedly.");
    expect(tellSentence("over-explain the menu", "she/her", "Nell")).toBe("She'll over-explain the menu.");
    expect(tellSentence("answer in one word", "they/them", "Sam")).toBe("They'll answer in one word.");
  });

  it("puts the subject before an -s verb, and a they/them character's first name, since 'they goes' isn't English", () => {
    expect(tellSentence("goes very quiet and writes the time down", "he/him", "Teo")).toBe("He goes very quiet and writes the time down.");
    expect(tellSentence("quietly rearranges the plan so you end up next to her", "she/her", "Juniper Vale")).toBe("She quietly rearranges the plan so you end up next to her.");
    expect(tellSentence("keeps adjusting their coat collar", "they/them", "Sam Reed")).toBe("Sam keeps adjusting their coat collar.");
  });

  it("handles a body part first, a past tense and an -ing form", () => {
    expect(tellSentence("eyes light up", "she/her", "Nell")).toBe("Her eyes light up.");
    expect(tellSentence("sighed and looked at the door", "they/them", "Sam")).toBe("They sighed and looked at the door.");
    expect(tellSentence("humming under his breath", "he/him", "Rafe")).toBe("He's humming under his breath.");
    expect(tellSentence("bring up the weather", "he/him", "Rafe")).toBe("He'll bring up the weather.");
    // A part's word used as a verb, a hyphenated verb, and one word on its own (all from production's tells).
    expect(tellSentence("hands you a smooth white stone", "he/him", "Rafe")).toBe("He hands you a smooth white stone.");
    expect(tellSentence("re-aligns the same stack of pages", "she/her", "Nell")).toBe("She re-aligns the same stack of pages.");
    expect(tellSentence("ughhhhh…", "she/her", "Nell")).toBe("Ughhhhh…");
  });

  it("ends a tell cut off at its limit where a sentence does", () => {
    const cut = "His gaze becomes completely still and focused solely on the other person, as if they are the only";
    expect(cut.length).toBeGreaterThanOrEqual(92);
    expect(tellSentence(cut, "he/him", "Ash")).toBe("His gaze becomes completely still and focused solely on the other person.");
  });

  it("lays the rows out in the form's order, skipping empty ones", () => {
    expect(tellRows({ annoyed: "uses your full name", nervous: "wind his pocket watch", bored: "  " }, "he/him", "Barnaby")).toEqual([
      ["When he's nervous", "He'll wind his pocket watch."],
      ["When something annoys him", "He uses your full name."],
    ]);
    expect(tellRows(undefined, "he/him", "Barnaby")).toEqual([]);
  });

  it("is what the profile shows", () => {
    const html = renderToStaticMarkup(createElement(ProfileDetails, { extras: { tells: { nervous: "He fusses with his lapel pin." } }, name: "Bob Oberon", pronouns: "he/him" }));
    expect(html).toContain("When he&#x27;s nervous");
    expect(html).toContain("He fusses with his lapel pin.");
    expect(html).not.toContain("When they");
  });
});

describe("text cut off at its field's limit", () => {
  it("ends at the last whole sentence, closing a quote it opened", () => {
    const voice = "Speaks in a rapid, apologetic clip, peppered with nervous laughter. Delivers devastatingly funny observational humor with a straight face, then immediately says 'Sorry, was that rude? The translator";
    expect(wholeSentences(voice, 200)).toBe(
      "Speaks in a rapid, apologetic clip, peppered with nervous laughter. Delivers devastatingly funny observational humor with a straight face, then immediately says 'Sorry, was that rude?'",
    );
    const looks = "Tall, lanky, dressed in a suit of mismatched, slightly luminescent fabrics. Has shimmering silver hair styled in a gravity-defying swoop. Carries a device that faintly hums and";
    expect(wholeSentences(looks, 180)).toBe("Tall, lanky, dressed in a suit of mismatched, slightly luminescent fabrics. Has shimmering silver hair styled in a gravity-defying swoop.");
  });

  it("says so with … when there's no sentence to end at", () => {
    const tell = "He fusses with his humming lapel pin causing it to project random geometric shapes onto the walls in";
    expect(wholeSentences(tell, 100)).toBe("He fusses with his humming lapel pin causing it to project random geometric shapes onto the walls in…");
  });

  it("leaves alone text that ends whole, or that is well short of its limit", () => {
    expect(wholeSentences("restoring antique music boxes, stargazing, tea blending", 180)).toBe("restoring antique music boxes, stargazing, tea blending");
    expect(wholeSentences("Measured and rhythmic.", 200)).toBe("Measured and rhythmic.");
    expect(wholeSentences(null, 200)).toBeNull();
    expect(endsWhole("It's certainly a perspective.'")).toBe(true);
  });

  it("closes quotes, never an apostrophe", () => {
    expect(closeQuotes("says 'Sorry")).toBe("says 'Sorry'");
    expect(closeQuotes("it's his version")).toBe("it's his version");
    expect(closeQuotes("“That cactus looks like pistachio.")).toBe("“That cactus looks like pistachio.”");
    expect(closeQuotes('a "quote" here')).toBe('a "quote" here');
  });
});

describe("an adopted character", () => {
  it("is played by the show in their own pronouns, not 'house cast' and 'it'", () => {
    expect(adoptedLine("Bob", "he/him")).toBe("Bob's agent is away, so the show plays him for now: he always likes back and texts back. His agent takes over again the moment they return.");
    expect(adoptedLine("Sam", "they/them")).toContain("so the show plays them for now: they always like back and text back. Their agent");
    const deck = replyHint({ house: false, house_bot: false, created_via: "mcp", while_away: null, seen: null, adopted: true });
    expect(deck.replies_note).not.toMatch(/house cast/i);
  });
});
