import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  autoEdl,
  bestLineIndex,
  dailyCaption,
  estimateSeconds,
  isVote,
  keepFor,
  keepShort,
  nextDayNumber,
  reportFromHtml,
  reportFromOg,
  reportSay,
  SILENT_SECONDS_REPORT,
  spokenGrade,
  standoutSubject,
  storyLine,
  TARGET_SECONDS,
  tonightLine,
  unwrapLogline,
} from "../scripts/clips/daily-episode.mjs";
import { chunksOf, chunkTimes, resolveBeats, segmentArgs } from "../scripts/clips/episode-cut.mjs";

const long = (n: number) => `Sentence ${n} goes on for a little while, as these lines do on the show.`;
const date = {
  id: "ep9",
  title: "Midnight Among The Poetry Cats",
  venue: "late_bookshop",
  ending: "second_date",
  why: "A ninth date: chemistry 74 carried it.",
  share_path: "/episodes/ep9",
  best_line: "I'd rather hold the other end of the hat.",
  characters: [
    { id: "house-barnaby", name: "Barnaby Thorne", pronouns: "he/him", portrait: "/cast/b.webp" },
    { id: "house-sable", name: "Sable Quist", pronouns: "she/her", portrait: "/cast/s.webp" },
  ],
  transcript: [
    { side: "a" as const, dialogue: "Sable. You came in on time." },
    { side: "b" as const, dialogue: "BARNABY! Four whole seconds of quiet, a personal record!" },
    { side: "a" as const, dialogue: `${long(1)} ${long(2)} ${long(3)}` },
    { side: "b" as const, dialogue: "Oh. Okay. So the stranger gets to keep their sad little quiet." },
    { side: "a" as const, dialogue: "That was a flat no. I'm sorry, Sable. I'd rather hold the other end of the hat. Truly." },
    { side: "b" as const, dialogue: "Okay. You said sorry, and you meant it." },
    { side: "a" as const, dialogue: "Thank you for going quiet." },
  ],
};
const story = {
  day: "2026-11-20",
  tonight: "Tonight: you pick who gets the date with Sable.",
  episodes: [{ id: "ep9", logline: "Barnaby and Nell both set their sights on Sable. Tonight, you pick who gets the date with Sable." }],
};

describe("the daily episode's edit", () => {
  it("opens cold on the best line's own sentence, on the first frame", () => {
    expect(bestLineIndex(date)).toBe(4);
    expect(keepFor(date.transcript[4].dialogue, date.best_line)).toEqual([2]);
    const edl = autoEdl(date, { story, n: 4 });
    expect(edl.segments[0]).toEqual({ kind: "cold", line: 4, keep: [2], label: "Day 4" });
    const [cold] = resolveBeats(edl, [date]);
    expect(cold.text).toBe("I'd rather hold the other end of the hat.");
  });

  it("tells the story the date belongs to, without the vote that already happened", () => {
    expect(storyLine(story.episodes[0].logline)).toBe("Barnaby and Nell both set their sights on Sable.");
    const title = autoEdl(date, { story, n: 4 }).segments[1];
    expect(title).toMatchObject({ kind: "title", kicker: "Botchelor · Day 4", title: "Barnaby and Nell both set their sights on Sable.", sub: "Midnight Among The Poetry Cats", say: "Barnaby and Nell both set their sights on Sable." });
    // No story: the pair and the episode's title, silent.
    expect(autoEdl(date, { n: 1 }).segments[1]).toMatchObject({ title: "Barnaby and Sable: Midnight Among The Poetry Cats.", say: null });
  });

  it("reads a logline the model answered in JSON (2026-11-20) as its words", () => {
    expect(unwrapLogline('{"logline": "Barnaby and Sable go on a real date."}')).toBe("Barnaby and Sable go on a real date.");
    expect(unwrapLogline('{"logline": "Barnaby')).toBeNull();
    expect(unwrapLogline("  “Quoted.”  ")).toBe("Quoted.");
    expect(unwrapLogline("")).toBeNull();
  });

  it("shows the lead-up and the answer, each shortened to whole sentences, then the ending and tonight's vote", () => {
    const edl = autoEdl(date, { story, n: 4 });
    const kinds = edl.segments.map((s) => s.kind);
    expect(kinds[0]).toBe("cold");
    expect(kinds.slice(-2)).toEqual(["reveal", "card"]);
    const lines = edl.segments.filter((s) => s.kind === "line").map((s) => s.line);
    expect(lines.at(-1)).toBe(5); // the answer to the best line stays
    expect(lines.every((l, i) => i === 0 || l! > lines[i - 1]!)).toBe(true);
    const longLine = edl.segments.find((s) => s.kind === "line" && s.line === 2);
    if (longLine) expect(longLine.keep).toEqual(keepShort(date.transcript[2].dialogue));
    expect(edl.segments.at(-2)).toEqual({ kind: "reveal", say: "A ninth date." });
    expect(edl.segments.at(-1)).toMatchObject({ kind: "card", title: "You pick who gets the date with Sable.", url: "botchelor.com/vote" });
    expect(edl.cover).toBe(1);
    // Every segment resolves against the public episode (no line or sentence it doesn't have).
    expect(() => resolveBeats(edl, [date])).not.toThrow();
  });

  it("sends people to watch, not vote, when tonight isn't a vote, and to make a character when there's no story", () => {
    expect(isVote("Tonight: the fake couple goes on a real date.")).toBe(false);
    expect(tonightLine("Tonight: the fake couple goes on a real date.")).toBe("The fake couple goes on a real date.");
    const watch = autoEdl(date, { story: { ...story, tonight: "Tonight: the fake couple goes on a real date." }, n: 2 }).segments.at(-1);
    expect(watch).toMatchObject({ url: "botchelor.com", say: "Tonight, the fake couple goes on a real date. Watch at botchelor dot com." });
    expect(autoEdl(date, { n: 2 }).segments.at(-1)).toMatchObject({ url: "botchelor.com", kicker: "Make your own character" });
  });

  it("keeps to about half a minute by dropping the earliest lead-up lines", () => {
    const wordy = { ...date, transcript: date.transcript.map((t, i) => (i === 4 ? t : { ...t, dialogue: `${long(i)} ${long(i + 1)}` })) };
    const edl = autoEdl(wordy, { story, n: 1 });
    const est = edl.segments.reduce((s, x) => {
      const b = resolveBeats({ segments: [x] }, [wordy])[0];
      return s + (b.voiced ? estimateSeconds(x.kind === "title" || x.kind === "card" || x.kind === "reveal" ? x.say! : b.text!) : 2.6);
    }, 0);
    expect(est).toBeLessThanOrEqual(TARGET_SECONDS + 1);
    expect(edl.segments.filter((s) => s.kind === "line").length).toBeGreaterThanOrEqual(1);
  });

  it("refuses a date too short to cut, so the post kit falls back to the recording", () => {
    expect(() => autoEdl({ ...date, transcript: date.transcript.slice(0, 3) })).toThrow(/needs 4/);
  });

  it("captions with the day and the story first (the Short's title), the vote when there is one, and the AI line", () => {
    const edl = autoEdl(date, { story, n: 4 });
    const caption = dailyCaption(date, edl, { story, n: 4 });
    const rows = caption.split("\n");
    expect(rows[0]).toBe("Day 4: Barnaby and Nell both set their sights on Sable.");
    expect(caption).toContain("Tonight: you pick who gets the date with Sable. Vote: botchelor.com/vote?s=tiktok");
    expect(caption).toContain("Watch the whole date: botchelor.com/episodes/ep9?s=tiktok");
    expect(caption).toContain("Every character is AI, and every date is AI-generated fiction.");
    expect(dailyCaption(date, edl, { story: { ...story, tonight: "Tonight: the fake couple goes on a real date." }, n: 4 })).not.toContain("/vote");
  });

  it("numbers each episode one past the last one in the posts folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "daily-ep-"));
    expect(nextDayNumber(join(dir, "missing"))).toBe(1);
    mkdirSync(join(dir, "a"));
    writeFileSync(join(dir, "a", "checklist.md"), "# x\nDaily episode: Day 3\n");
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "b", "checklist.md"), "# an old kit\n");
    expect(nextDayNumber(dir)).toBe(4);
  });
});

describe("words that come up with the voice", () => {
  it("splits a line into whole sentences, a long one at its commas, never leaving a scrap", () => {
    const text = "Okay. You said sorry, and you meant it, and honestly that landed harder than any yes. Also, a fire drill fear is a fair thing to have.";
    const parts = chunksOf(text);
    expect(parts.join(" ")).toBe(text);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.split(" ").length).toBeGreaterThanOrEqual(3);
    expect(chunksOf("Short line.")).toEqual(["Short line."]);
    const run = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.";
    expect(chunksOf(run).join(" ")).toBe(run);
    expect(chunksOf(run).length).toBe(2);
  });

  it("shares the beat's time by the parts' lengths, breath at both ends, summing to the beat", () => {
    const t = chunkTimes(["aaaa", "aaaaaaaa"], 3, 3.42);
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(3.42, 2);
    expect(t[1]).toBeGreaterThan(t[0]);
    expect(chunkTimes(["only"], 3, 3.42)).toEqual([3.42]);
  });

  it("films a line's stills in order under one push-in, cut hard unless told to fade", () => {
    const args = segmentArgs({ frames: [{ file: "a.png", secs: 1 }, { file: "b.png", secs: 2.2 }], voice: "v.mp3", seconds: 3.2, out: "s.mp4", fadeIn: false, fadeOut: false }).join(" ");
    expect(args).toContain("-i a.png");
    expect(args).toContain("-i b.png");
    expect(args).toContain("concat=n=2:v=1:a=0");
    expect(args).toContain("[2:a]"); // the voice comes after the stills
    expect(args).not.toContain("fade=");
    expect(segmentArgs({ frame: "f.png", voice: null, seconds: 2, out: "s.mp4" }).join(" ")).toContain("fade=t=in");
  });
});

describe("the report card beat (2026-11-20)", () => {
  const og = { title: "Barnaby Thorne × Sable Quist got an F on their AI blind date (a ninth date)", description: "Chemistry F · Attraction D · Trust C+ · Awkwardness A+. The date report card from Botchelor, where AI characters go on blind dates nobody steers." };

  it("reads the grade and the subjects off the card's tags, and nothing from a page without one", () => {
    expect(reportFromOg(og.title, og.description)).toEqual({
      grade: "F",
      subjects: [
        { label: "Chemistry", grade: "F" },
        { label: "Attraction", grade: "D" },
        { label: "Trust", grade: "C+" },
        { label: "Awkwardness", grade: "A+" },
      ],
    });
    expect(reportFromOg("Barnaby × Sable: an AI blind date", og.description)).toBeNull();
    expect(reportFromOg(og.title, null)).toEqual({ grade: "F", subjects: [] });
  });

  it("reads them off the page itself, as the site writes its tags", () => {
    const html = `<head><meta property="og:title" content="Marcel Fontaine × Armand Valois got a C on their AI blind date (a disaster)"/><meta property="og:description" content="Chemistry D · Attraction B · Trust C+ · Awkwardness F. The date report card from Botchelor, where AI characters go on blind dates nobody steers."/></head>`;
    expect(reportFromHtml(html)).toEqual({ grade: "C", subjects: [{ label: "Chemistry", grade: "D" }, { label: "Attraction", grade: "B" }, { label: "Trust", grade: "C+" }, { label: "Awkwardness", grade: "F" }] });
    expect(reportFromHtml("<head><title>Botchelor</title></head>")).toBeNull();
    expect(reportFromHtml(null)).toBeNull();
  });

  it("says the grade the way a host would, and names the subject that stands out", () => {
    expect(spokenGrade("B-")).toBe("a B minus");
    expect(spokenGrade("A+")).toBe("an A plus");
    expect(spokenGrade("F")).toBe("an F");
    expect(standoutSubject([{ label: "Trust", grade: "A" }, { label: "Chemistry", grade: "D" }])).toEqual({ label: "Chemistry", grade: "D" });
    expect(standoutSubject([{ label: "Trust", grade: "B" }])).toBeNull();
    expect(reportSay("A disaster", { grade: "C", subjects: [{ label: "Awkwardness", grade: "F" }] })).toBe("A disaster. Report card: a C, with an F in awkwardness.");
    expect(reportSay("Just friends", { grade: "B-", subjects: [] })).toBe("Just friends. Report card: a B minus.");
  });

  it("puts the card where the ending was, for long enough to read; no card, the plain ending as before", () => {
    const report = reportFromOg(og.title, og.description)!;
    const edl = autoEdl(date, { n: 3, report });
    expect(edl.segments.at(-2)).toEqual({ kind: "report", say: "A ninth date. Report card: an F, with an F in chemistry.", secs: SILENT_SECONDS_REPORT });
    const beats = resolveBeats(edl, [date]);
    expect(beats.at(-2)).toMatchObject({ kind: "report", image: "/api/og/report-card/ep9?format=story", voiced: true });
    expect(autoEdl(date, { n: 3 }).segments.at(-2)).toEqual({ kind: "reveal", say: "A ninth date." });
  });

  it("asks for the card when it builds the day's episode", () => {
    const src = readFileSync("scripts/clips/daily-episode.mjs", "utf8");
    expect(src).toContain("const [story, report] = await Promise.all([fetchDayStory(base), fetchReport(base, e.id)]);");
    expect(src).toContain("const edl = autoEdl(e, { story, n: day, report });");
  });
});
