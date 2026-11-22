import { describe, expect, it } from "vitest";
import { dateBadge } from "@/lib/rules";
import { isTitleCase, midSentence, properWords, sentenceCase } from "@/lib/sentence-case";

// The 2026-11-22 audit: every word of an episode title capitalised ("Cobwebs And Polite Apologies") beside sentence-case
// headings, and the badge said "SEVENTH DATE" on one episode and "11TH DATE" on the next.

describe("sentenceCase", () => {
  it("shows a Title Case title in sentence case", () => {
    expect(sentenceCase("Four AM At The Diner")).toBe("Four AM at the diner");
    expect(sentenceCase("Golden Hour Countdown")).toBe("Golden hour countdown");
    expect(sentenceCase("Winds Of Change")).toBe("Winds of change");
  });

  it("leaves a title already in sentence case as it is, a name in it too", () => {
    expect(sentenceCase("First date at a sticky dive bar")).toBe("First date at a sticky dive bar");
    expect(sentenceCase("Midnight with Rafe")).toBe("Midnight with Rafe");
    expect(isTitleCase("Midnight with Rafe")).toBe(false);
  });

  it("keeps the daters' names, places from the setting, acronyms, I, and a capital after a colon", () => {
    expect(sentenceCase("Rafe And Nell Split The Bill", ["Rafe Okafor", "Nell Abiodun"])).toBe("Rafe and Nell split the bill");
    expect(sentenceCase("Front Row Roast In Marseille", [], "a Marseille-style bar by the port")).toBe("Front row roast in Marseille");
    expect(sentenceCase("OC Night: The Big Reveal")).toBe("OC night: The big reveal");
    expect(sentenceCase("What I Wanted To Say")).toBe("What I wanted to say");
    expect(sentenceCase("Dinner With McQueen Again")).toBe("Dinner with McQueen again");
  });

  it("lowers the rest of a hyphenated word", () => {
    expect(sentenceCase("Mid-Air Over The Bay")).toBe("Mid-air over the bay");
  });

  it("passes null and empty through", () => {
    expect(sentenceCase(null)).toBeNull();
    expect(sentenceCase("")).toBe("");
  });

  it("reads mid-sentence capitals from the setting, not small words or a sentence's first", () => {
    expect(properWords("The rooftop of The Velvet Room. Paris at night")).toEqual(["Velvet", "Room"]);
  });
});

describe("midSentence", () => {
  it("lowers a phrase's first letter inside a sentence, but not an acronym, I, or a question said as it was", () => {
    expect(midSentence("Checking the time")).toBe("checking the time");
    expect(midSentence("OCD about napkins")).toBe("OCD about napkins");
    expect(midSentence("I'm always right")).toBe("I'm always right");
    expect(midSentence("chewing loudly")).toBe("chewing loudly");
    expect(midSentence("Who does that?")).toBe("Who does that?");
    expect(midSentence("Liars!")).toBe("Liars!");
    expect(midSentence("")).toBe("");
  });
});

describe("dateBadge", () => {
  it("numbers every date the same way, short enough for a phone", () => {
    expect(dateBadge(7)).toBe("Date 7");
    expect(dateBadge(11)).toBe("Date 11");
    expect(dateBadge(0)).toBe("Date 1");
  });
});
