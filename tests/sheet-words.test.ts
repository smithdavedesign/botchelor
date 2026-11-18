/**
 * How long a sheet is (lib/sheet-words.ts, PRD styles-and-storylines phase 6): every field its creator wrote counts,
 * the meter's bands are the census's 400–999-word sweet spot, and the create flow shows it on Go deeper and the review.
 * Pure, no database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { sheetBand, sheetMeterNote, sheetTexts, sheetWords, SHEET_WORDS_MAX, SHEET_WORDS_MIN, wordCount } from "@/lib/sheet-words";

describe("words", () => {
  it("counts words, not spaces or punctuation, in any script", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount(null)).toBe(0);
    expect(wordCount("  Restores carousel horses, by the canal.  ")).toBe(6);
    expect(wordCount("It's a late-night thing — honestly!")).toBeGreaterThanOrEqual(5);
    // Chinese, Japanese and Korean text has no spaces between words: it still counts as more than one.
    expect(wordCount("我喜欢在雨天散步")).toBeGreaterThan(1);
    expect(wordCount("雨の日に散歩するのが好き")).toBeGreaterThan(1);
    expect(wordCount("비 오는 날 산책을 좋아해요")).toBeGreaterThan(1);
  });

  it("counts every field a creator writes, and nothing that's a pick", () => {
    const sheet = {
      bio: "one two three",
      want: "four",
      dealbreaker: "five",
      traits: ["six", "seven"],
      voice: "eight",
      appearance: "nine",
      soul: { values: "ten", humor: "eleven", local_only: true },
      extras: {
        occupation: "twelve",
        ideal_first_date: "thirteen",
        kind: "other" as const,
        kind_label: "fourteen",
        hobbies: ["fifteen"],
        prompts: [{ id: "two_truths" as const, answer: "sixteen" }],
        lines: { hello: "seventeen" },
        tells: { nervous: "eighteen" },
        never_says: ["nineteen"],
        facts: [{ label: "twenty", value: "twentyone" }],
        hot_takes: ["twentytwo"],
        baggage: "twentythree",
        wins_them_over: "twentyfour",
        star_sign: "Leo" as const,
        mood: "playful" as const,
      },
      hiding: ["twentyfive"],
      week: "twentysix",
    };
    expect(sheetWords(sheet)).toBe(26);
    // A picked star sign or mood is a pick, not words; a kind label only counts for an "other".
    expect(sheetTexts(sheet)).not.toContain("Leo");
    expect(sheetTexts({ extras: { kind: "human", kind_label: "ignored" } })).toEqual([]);
    expect(sheetWords({})).toBe(0);
  });

  it("puts a length in its band, and says so in words", () => {
    expect([SHEET_WORDS_MIN, SHEET_WORDS_MAX]).toEqual([400, 999]);
    expect(sheetBand(0)).toBe("short");
    expect(sheetBand(399)).toBe("short");
    expect(sheetBand(400)).toBe("sweet");
    expect(sheetBand(999)).toBe("sweet");
    expect(sheetBand(1000)).toBe("long");
    expect(sheetMeterNote(1)).toMatch(/^1 word: the sweet spot is 400–999/);
    expect(sheetMeterNote(120)).toMatch(/^120 words: the sweet spot is 400–999, enough for a date to draw on\. Their voice, more about them and Go deeper add the most\.$/);
    expect(sheetMeterNote(512)).toMatch(/^512 words: in the sweet spot/);
    expect(sheetMeterNote(1450)).toMatch(/^1,450 words: past the sweet spot/);
  });

  it("measures the house cast's sheets as they stand", () => {
    for (const c of ALL_HOUSE_CHARACTERS) {
      const n = sheetWords({ bio: c.bio, want: c.want, dealbreaker: c.dealbreaker, traits: c.traits, voice: c.voice, appearance: c.appearance });
      expect(n).toBeGreaterThan(10);
    }
  });
});

describe("the create flow shows it", () => {
  it("on Go deeper, with the three suggestions, and on the review", () => {
    const deeper = readFileSync("app/create/DeeperStep.tsx", "utf8");
    expect(deeper).toContain("<DepthMeter words={words} />");
    expect(deeper).toContain("An opening line: how ${who} says hello");
    expect(deeper).toContain("A scenario: ${who}'s ideal first date");
    expect(deeper).toContain("things ${who} is hiding");
    const wizard = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(wizard.match(/<DepthMeter words=\{words\} \/>/g)).toHaveLength(1);
    expect(wizard).toContain("jump={(to) => jump(to === \"voice\" ? S.voice : S.details)}");
  });
});
