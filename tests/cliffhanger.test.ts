import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACE_LOOP_IDS, faceLoopOf } from "@/lib/face-loops";
import {
  answerLine,
  askCopy,
  CLIFF,
  cliffArgs,
  cliffCaption,
  cliffhangerEdl,
  cliffSeconds,
  cliffTitle,
  cutText,
  daysBefore,
  faceChoices,
  HOUSE_LOOPS,
  keepHead,
  keepTail,
  layerHtml,
  nextDateOption,
  ordinalWord,
  pickPair,
  previousKit,
  setupLine,
  spoilerHits,
  STILL_ZOOM,
  tellsEnding,
  TILES,
  TITLE_MAX,
  yesterdaysAnswer,
} from "../scripts/clips/cliffhanger.mjs";
import type { CliffEpisode } from "../scripts/clips/cliffhanger.mjs";
import { episodeFormat, estimateSeconds, SERIES_MARK } from "../scripts/clips/daily-episode.mjs";
import { LEAD_IN, LEAD_OUT, resolveBeats, SILENT_SECONDS } from "../scripts/clips/episode-cut.mjs";

const date: CliffEpisode = {
  id: "ep7",
  title: "Spinning out of control",
  venue: "pottery_class",
  ending: "second_date",
  why: "An eighth date: chemistry 80 and attraction 59 carried it.",
  share_path: "/episodes/ep7",
  date_number: 7,
  best_line: "Is thinking always the enemy of fun, or just in empty rooms?",
  characters: [
    { id: "house-nell", name: "Nell Abiodun", pronouns: "she/her", portrait: "/cast/house-nell-v5.webp" },
    { id: "house-sable", name: "Sable Quist", pronouns: "she/her", portrait: "/cast/house-sable-v5.webp" },
  ],
  transcript: [
    { side: "a", dialogue: "You're here. Good. The wheel's already going too fast." },
    { side: "b", dialogue: "NELL! Yes, I'm here, the gull lost. Wobbliest bowl gets a party hat!" },
    { side: "a", dialogue: "A party hat is just a bribe. Are you planning to wobble on purpose for it?" },
    { side: "b", dialogue: "Wobble on purpose? I'd never insult the wheel like that." },
    { side: "a", dialogue: "Oh. Right. That's fair, it's a fair no. Can I ask one follow-up, though? Is thinking always the enemy of fun, or just in empty rooms?" },
    { side: "b", dialogue: "Honest answer? Only in empty rooms. And I said no before you'd even finished asking, which is my speed thing, and it wasn't fair to you." },
    { side: "a", dialogue: "Then I'm glad you grabbed a hat. Thank you for saying it straight, Sable." },
    { side: "b", dialogue: "Honest back, because you earned it: afterwards I go quiet." },
    { side: "a", dialogue: "I have to leave first, my shift's calling. Next time, the hypocaust." },
  ],
};

/** The same date with another ending, another verdict and another report: none of it may change the cut. */
const endings: CliffEpisode[] = [
  date,
  { ...date, ending: "friends", why: "Just friends: trust 41 held it back." },
  { ...date, ending: "close_friends", why: "Close friends: trust carried it." },
  { ...date, ending: "disaster", why: "A disaster: awkwardness 80 sank it." },
];

describe("the cliffhanger's two lines", () => {
  it("opens on the best line in its own sentences, then the opening of the reply that answers it", () => {
    expect(pickPair(date)).toEqual({ hook: { line: 4, keep: [4] }, reply: { line: 5, keep: [0, 1] }, how: "best" });
    const edl = cliffhangerEdl(date, { n: 3 });
    expect(edl.segments[0]).toEqual({ kind: "cold", line: 4, keep: [4], label: "Their seventh date · Nell" });
    const [hook, reply] = resolveBeats(edl, [date]);
    expect(hook.text).toBe("Is thinking always the enemy of fun, or just in empty rooms?");
    expect(reply.text).toBe("Honest answer? Only in empty rooms.");
    expect(edl.hook).toBe(hook.text);
    expect(edl.cover).toBe(0);
  });

  it("knows the talk that tells how a date went, and quotes none of it", () => {
    for (const s of ["Same channel next time?", "I'd love a second date.", "We're just friends, Barnaby.", "This is a disaster!", "I have to leave first.", "Goodnight, Sable.", "Will I see you again?", "Can we do this again?", "Walk me home."]) expect(tellsEnding(s), s).toBe(true);
    for (const s of ["Is thinking always the enemy of fun?", "Honest answer? Only in empty rooms.", "I asked what it does to you and I got trousers."]) expect(tellsEnding(s), s).toBe(false);
    expect(keepHead("Neither have I. Same channel next time?")).toEqual([0]);
    expect(keepHead("Next time, then. Neither have I.")).toEqual([]);
    const long = "I spent the whole of last winter learning to throw pots and every one of them collapsed in the kiln.";
    expect(keepTail(`${long} Okay. I've also never once been surprised, not in my whole life.`)).toEqual([1, 2]);
    expect(keepTail("I have to go first. But honestly? I've never once been surprised.")).toEqual([1, 2]);
    expect(keepTail("Honestly? Goodnight, Sable.")).toEqual([]);
    // A lone short sentence isn't a hook: the one before it comes along.
    expect(keepTail("The scratching has stopped. Honestly?")).toEqual([0, 1]);
  });

  it("puts the best line second when it closes the date or its reply would tell the ending", () => {
    const last = { ...date, best_line: "Next time, the hypocaust.", transcript: [...date.transcript.slice(0, 8), { side: "a" as const, dialogue: "Quiet isn't a plan. It's the room listening." }] };
    const lastPick = pickPair({ ...last, best_line: "Quiet isn't a plan. It's the room listening." });
    expect(lastPick).toMatchObject({ how: "best last", hook: { line: 7 }, reply: { line: 8, keep: [0, 1] } });
    const spoilt = { ...date, transcript: date.transcript.map((t, i) => (i === 5 ? { ...t, dialogue: "Another date? Yes. Only in empty rooms." } : t)) };
    expect(pickPair(spoilt)).toEqual({ how: "best last", hook: { line: 3, keep: [0, 1] }, reply: { line: 4, keep: [4] } });
  });

  it("without a best line, opens on the last question it can answer, never on the date's last line", () => {
    const pick = pickPair({ ...date, best_line: null });
    expect(pick.how).toBe("question");
    expect(pick.hook.line).toBeLessThan(date.transcript!.length - 1);
    expect(pick).toEqual({ how: "question", hook: { line: 4, keep: [3, 4] }, reply: { line: 5, keep: [0, 1] } });
    // A question in the last line is never the hook: nothing after it can answer.
    const ends = { ...date, best_line: null, transcript: [...date.transcript!.slice(0, 8), { side: "a" as const, dialogue: "So is that a yes?" }] };
    expect(pickPair(ends).hook.line).toBe(4);
    expect(() => pickPair({ ...date, transcript: date.transcript!.slice(0, 3) })).toThrow(/needs 4/);
  });

  it("sets the scene in the show's words: the date's number, or a blind date", () => {
    expect(setupLine(date)).toBe("Their seventh date");
    expect(setupLine({ date_number: null })).toBe("A blind date");
    expect(setupLine({ date_number: 14 })).toBe("Their 14th date");
    expect(ordinalWord(11)).toBe("11th");
    expect(ordinalWord(22)).toBe("22nd");
    expect(nextDateOption(date)).toBe("Eighth date");
    expect(nextDateOption({})).toBe("Second date");
  });
});

describe("no spoilers: no ending, no grade, no report card", () => {
  it("cuts the same date the same way whatever its ending, so it can't give one away", () => {
    const edls = endings.map((e) => cliffhangerEdl(e, { n: 3 }));
    for (const edl of edls) expect(edl).toEqual(edls[0]);
    const captions = endings.map((e, i) => cliffCaption(e, edls[i]));
    for (const c of captions) expect(c).toBe(captions[0]);
  });

  it("shows and says no ending and no grade, and asks with all three endings alike", () => {
    const report = { grade: "B+", subjects: [{ label: "Chemistry", grade: "A" }] };
    for (const e of endings) {
      const edl = cliffhangerEdl(e, { n: 3 });
      expect(spoilerHits(cutText(edl, [e]), e, report), e.ending ?? "").toEqual([]);
      expect(edl.segments.map((s) => s.kind)).toEqual(["cold", "line", "card"]);
      expect(edl.segments.some((s) => ["report", "reveal", "choice", "diary", "thought"].includes(s.kind))).toBe(false);
      for (const b of resolveBeats(edl, [e]).filter((x) => x.kind !== "card")) expect(tellsEnding(b.text), b.text).toBe(false);
      expect(edl.segments.at(-1)).toMatchObject({ kind: "card", title: "How did it end?", sub: "Eighth date · Just friends · Disaster", url: "botchelor.com", ask: true });
      expect(edl.segments.at(-1)!.say).toBe("How did it end? Eighth date, just friends, or disaster? Call it in the comments.");
    }
    expect(askCopy({}).options).toEqual(["Second date", "Just friends", "Disaster"]);
  });

  it("finds what would give an ending away", () => {
    expect(spoilerHits("An eighth date. Report card: a B+.", date)).toEqual(["An eighth date", "report card", "a letter grade"]);
    expect(spoilerHits("They got an F on it", date)).toEqual(["a letter grade"]);
    expect(spoilerHits("Here's how it ended", date)).toEqual(["how it ended"]);
    expect(spoilerHits("Just friends, then.", endings[1])).toEqual(["Just friends"]);
    expect(spoilerHits("A-list wit, C-suite nerves.", date, { grade: "C", subjects: [] })).toEqual([]);
    expect(spoilerHits("Their seventh date · Nell\nIs thinking always the enemy of fun?", date)).toEqual([]);
  });

  it("refuses to build a cut that would spoil (the day's episode then cuts the full one)", () => {
    const src = readFileSync("scripts/clips/cliffhanger.mjs", "utf8");
    expect(src).toContain("const hits = spoilerHits(cutText(edl, [e]), e);");
    expect(src).toContain("if (hits.length) throw new Error(");
  });
});

describe("timing: 12 to 20 seconds, the hook voiced from the first moment", () => {
  it("fits the lines to about CLIFF.fit seconds by keeping less of the reply, never of the best line", () => {
    const wordy = { ...date, transcript: date.transcript!.map((t, i) => (i === 5 ? { ...t, dialogue: `Honest answer? Only in empty rooms, and here is why it took me so long to say it. ${"I keep talking because the quiet frightens me a little. ".repeat(3)}` } : t)) };
    const edl = cliffhangerEdl(wordy, { n: 1 });
    const beats = resolveBeats(edl, [wordy]);
    const est = beats.reduce((s, b) => s + estimateSeconds(b.kind === "card" ? b.say! : b.text!), 0);
    expect(est).toBeLessThanOrEqual(CLIFF.fit + 1);
    expect(beats[0].text).toBe("Is thinking always the enemy of fun, or just in empty rooms?");
    expect(beats[1].text!.startsWith("Honest answer?")).toBe(true);
  });

  it("holds the question so the whole runs at least 12 seconds, and leaves the lines as they're voiced", () => {
    const beats = resolveBeats(cliffhangerEdl(date), [date]);
    const short = cliffSeconds(beats, [2, 2, 3]);
    expect(short[0]).toBeCloseTo(2 + LEAD_IN + LEAD_OUT, 3);
    expect(short[1]).toBeCloseTo(2 + LEAD_IN + LEAD_OUT, 3);
    expect(short.reduce((a, b) => a + b, 0)).toBeCloseTo(CLIFF.min, 2);
    const long = cliffSeconds(beats, [4, 6, 5]);
    expect(long[2]).toBeCloseTo(5 + LEAD_IN + LEAD_OUT, 3);
    // Silent, the question still holds for its card's length.
    expect(cliffSeconds(beats, [5, 6, 0])[2]).toBeGreaterThanOrEqual(SILENT_SECONDS.card);
  });

  it("films it in one pass: faces in their half-frame tiles, the hook's voice at once, no fade in, a fade at the very end", () => {
    expect(TILES.map((t) => t.w)).toEqual([540, 540]);
    expect(TILES[1].x).toBe(540);
    const args = cliffArgs({
      background: "base.png",
      faces: [{ file: "nell.mp4", kind: "loop" }, { file: "sable.webp", kind: "still" }],
      tops: [{ file: "t0.png", secs: 3.5 }, { file: "t1.png", secs: 1.2 }, { file: "t2.png", secs: 7.3 }],
      voices: [{ file: "v0.mp3", at: LEAD_IN }, null, { file: "v2.mp3", at: 4.82 }],
      total: 12,
      out: "post.mp4",
    });
    const all = args.join(" ");
    expect(all).toContain("-stream_loop -1 -i nell.mp4");
    expect(all).toContain("-loop 1 -framerate 30 -t 12.000 -i sable.webp");
    expect(all).toContain(`zoompan=z='${STILL_ZOOM.from}+`);
    expect(all).toContain(`overlay=${TILES[0].x}:${TILES[0].y}`);
    expect(all).toContain(`overlay=${TILES[1].x}:${TILES[1].y}`);
    expect(all).toContain("concat=n=3:v=1:a=0");
    expect(all).toContain("adelay=120|120");
    expect(all).toContain("adelay=4820|4820");
    expect(all).toContain("amix=inputs=2");
    expect(all).not.toContain("fade=t=in");
    expect(all).toContain("fade=t=out:st=11.86:d=0.14");
    expect(args.slice(args.indexOf("-t", args.indexOf("-filter_complex")), args.indexOf("-t", args.indexOf("-filter_complex")) + 2)).toEqual(["-t", "12.000"]);
    expect(args.at(-1)).toBe("post.mp4");
    // No voice at all: a silent track, so the apps still take the file.
    expect(cliffArgs({ background: "b.png", faces: [null, null], tops: [{ file: "t.png", secs: 12 }], voices: [], total: 12, out: "o.mp4" }).join(" ")).toContain("anullsrc=r=48000:cl=stereo");
  });
});

describe("the frame", () => {
  it("shows the hook whole from the first frame, the speaker lit and the other dimmed", () => {
    const [hook, reply, ask] = resolveBeats(cliffhangerEdl(date, { n: 3 }), [date]);
    const first = layerHtml(hook, { e: date, n: 3 });
    expect(first).toContain("Is thinking always the enemy of fun, or just in empty rooms?");
    expect(first).not.toContain('class="hide"');
    expect(first).toContain('class="tile lit a"');
    expect(first).toContain('class="tile dim b"');
    expect(first).toContain("Their seventh date · Nell");
    expect(first).toContain("AI dating show · Day 3");
    expect(layerHtml(reply, { e: date, n: 3, shown: 1 })).toContain('class="tile lit b"');
    const end = layerHtml(ask, { e: date, n: 3 });
    for (const s of ["How did it end?", "<span>Eighth date</span>", "<span>Just friends</span>", "<span>Disaster</span>", "Call it in the comments", "botchelor.com", "AI-generated fiction"]) expect(end).toContain(s);
    expect(end).not.toContain("tile lit");
  });

  it("escapes what it quotes", () => {
    const odd = { ...date, best_line: 'Fish & "chips" <b>now</b>?', transcript: date.transcript!.map((t, i) => (i === 4 ? { ...t, dialogue: 'Fish & "chips" <b>now</b>?' } : t)) };
    const [hook] = resolveBeats(cliffhangerEdl(odd), [odd]);
    expect(layerHtml(hook, { e: odd })).toContain("Fish &amp; &quot;chips&quot; &lt;b&gt;now&lt;/b&gt;?");
  });
});

describe("the faces", () => {
  it("moves each face: the call face loop first, then the house cast's loop, then a push-in on the portrait", () => {
    expect(faceChoices(date.characters[0], { loop: "/api/face-kit/abc?v=1" }).map((c) => c.from)).toEqual(["call face loop", "house loop", "portrait push-in"]);
    expect(faceChoices(date.characters[0], null).map((c) => [c.kind, c.url])).toEqual([
      ["loop", "/cast/house-nell-loop-tall-a.mp4"],
      ["still", "/cast/house-nell-v5.webp"],
    ]);
    expect(faceChoices({ id: "u1", name: "Zuri Mensah", portrait: "/api/assets/x" }, { loop: null })).toEqual([{ url: "/api/assets/x", kind: "still", from: "portrait push-in" }]);
  });

  it("uses the house cast's loops the site plays (lib/face-loops.ts, the tall cut)", () => {
    expect(Object.keys(HOUSE_LOOPS).sort()).toEqual([...FACE_LOOP_IDS].sort());
    for (const id of FACE_LOOP_IDS) expect(HOUSE_LOOPS[id]).toBe(faceLoopOf(id, "tall"));
  });
});

describe("the caption, and the answer the next day", () => {
  const answer = "Yesterday's answer: Star and Sweet → a ninth date 💘";

  it("asks the question first, with the show's name, short enough to stay the Short's title", () => {
    const q = cliffTitle(date, 3);
    expect(q).toBe("Botchelor Day 3: how did Nell and Sable's date end? Eighth date, just friends, or disaster?");
    expect(q.length).toBeLessThanOrEqual(TITLE_MAX);
    const long = { ...date, characters: [{ ...date.characters[0], name: "Bartholomew Szczepanski" }, { ...date.characters[1], name: "Ottoline Brackwater" }] as CliffEpisode["characters"] };
    const lq = cliffTitle(long, 12);
    expect(lq).toBe("Botchelor Day 12: how did Bartholomew and Ottoline's date end?");
    // The three endings then move into the caption, by the call to comment.
    expect(cliffCaption(long, { question: lq })).toContain("Eighth date, just friends, or disaster? Call it in the comments");
    expect(cliffCaption(date, { question: q })).toContain("\nCall it in the comments: the answer is in tomorrow's episode.");
  });

  it("puts yesterday's answer right under the question, then the whole date, the AI line and credits", () => {
    const credited = { ...date, characters: [{ ...date.characters[0], credit: { handle: "ada", name: "Ada" } }, date.characters[1]] as CliffEpisode["characters"] };
    const rows = cliffCaption(credited, cliffhangerEdl(credited, { n: 3 }), { answer }).split("\n");
    expect(rows[0]).toBe("Botchelor Day 3: how did Nell and Sable's date end? Eighth date, just friends, or disaster?");
    expect(rows[1]).toBe(answer);
    expect(rows).toContain("Can't wait? The whole date: botchelor.com/episodes/ep7?s=tiktok");
    expect(rows).toContain("Every character is AI, and every date is AI-generated fiction.");
    expect(rows).toContain("Nell is by Ada: botchelor.com/creators/ada");
    expect(rows.at(-1)).toContain("#botchelor");
    expect(cliffCaption(date, cliffhangerEdl(date)).split("\n")[1]).toBe("");
  });

  it("finds the last daily episode the way the day count does (its checklist's mark and link)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cliff-prev-"));
    expect(previousKit(join(dir, "missing"))).toBeNull();
    const kit = (name: string, text: string) => {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "checklist.md"), text);
    };
    kit("2026-11-22-ada-bo", `# Posting Ada × Bo\n\nEpisode: https://botchelor.com/episodes/11111111-1111-4111-8111-111111111111\n${SERIES_MARK}3\n`);
    kit("2026-11-23-star-dust-sweet-thang", `# Posting Star Dust × Sweet thang\n\nEpisode: https://botchelor.com/episodes/F3F125E3-9CCC-4951-B511-AAC28A0F6C34\n${SERIES_MARK}4\n`);
    kit("2026-11-21-zz-cut-6-doorway", "# Posting the episode cut: doorway\n\nEpisode: https://botchelor.com/episodes/22222222-2222-4222-8222-222222222222\n");
    mkdirSync(join(dir, "not-a-kit"));
    expect(previousKit(dir, 5)).toEqual({ day: 4, episode: "f3f125e3-9ccc-4951-b511-aac28a0f6c34", dir: "2026-11-23-star-dust-sweet-thang", date: "2026-11-23" });
    expect(previousKit(dir, 4)).toMatchObject({ day: 3, episode: "11111111-1111-4111-8111-111111111111" });
    expect(previousKit(dir, 3)).toBeNull();
  });

  it("says yesterday's ending the way its page names it, from the public record", () => {
    const star = { ...date, characters: [{ id: "s", name: "Star Dust" }, { id: "w", name: "Sweet thang" }] as CliffEpisode["characters"] };
    expect(answerLine({ ...star, ending: "second_date", why: "A ninth date: chemistry 79 carried it." })).toBe(answer);
    expect(answerLine({ ...star, ending: "friends", why: "Just friends: trust held it back." })).toBe("Yesterday's answer: Star and Sweet → just friends 🤝");
    expect(answerLine({ ...star, ending: "disaster", why: null })).toBe("Yesterday's answer: Star and Sweet → a disaster 💔");
    expect(answerLine({ ...star, ending: "second_date", why: null }, { daysAgo: 3 })).toBe("Last episode's answer: Star and Sweet → a second date 💘");
    expect(answerLine({ ...star, ending: null, why: null })).toBeNull();
    expect(daysBefore("2026-11-23", new Date("2026-11-24T02:30:00Z"))).toBe(1);
    expect(daysBefore("not a day")).toBeNull();
  });

  it("never answers today's own date: its ending is tomorrow's answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cliff-same-"));
    mkdirSync(join(dir, "2026-11-23-nell-sable"));
    writeFileSync(join(dir, "2026-11-23-nell-sable", "checklist.md"), `Episode: https://botchelor.com/episodes/33333333-3333-4333-8333-333333333333\n${SERIES_MARK}2\n`);
    await expect(yesterdaysAnswer(dir, { before: 3, episode: "33333333-3333-4333-8333-333333333333", base: "http://127.0.0.1:9" })).resolves.toBeNull();
    // A date the public record no longer shows (here: nothing answers) gives no answer, not an error.
    await expect(yesterdaysAnswer(dir, { before: 3, episode: "other", base: "http://127.0.0.1:9" })).resolves.toBeNull();
  });
});

describe("the switch: the cliffhanger by default, the full episode on request", () => {
  it("picks the format from --format, then EPISODE_FORMAT, else the cliffhanger", () => {
    expect(episodeFormat(null, {})).toBe("cliffhanger");
    expect(episodeFormat(null, { EPISODE_FORMAT: "full" })).toBe("full");
    expect(episodeFormat("cliffhanger", { EPISODE_FORMAT: "full" })).toBe("cliffhanger");
    expect(episodeFormat("FULL", {})).toBe("full");
    expect(() => episodeFormat("long", {})).toThrow(/cliffhanger or full/);
  });

  it("falls back to the full episode only when the cliffhanger wasn't asked for by name", () => {
    const src = readFileSync("scripts/clips/daily-episode.mjs", "utf8");
    expect(src).toContain('if (chosen === "cliffhanger") {');
    expect(src).toContain("if (format || process.env.EPISODE_FORMAT) throw err;");
    expect(src).toContain('format: arg("format") ?? null');
  });
});
