// The episode cut (scripts/clips/episode-cut.mjs, "December: first real audience" part B): a hand-edited vertical episode
// built from an edit decision list. These pin what keeps it honest: it quotes only what the public episode shows (a
// line, a public thought, a public diary line), shortens a line only by whole sentences and marks the gap, names the
// ending the way the page does ("A fifth date", not "A second date"), and keeps the editor's own words to captions.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backdropOf,
  beatSeconds,
  cutCaption,
  endingLabel,
  frameHtml,
  HOST_VOICE,
  LEAD_IN,
  LEAD_OUT,
  pickText,
  resolveBeats,
  segmentArgs,
  sentences,
  SILENT_SECONDS,
  spokenText,
  type Edl,
} from "../scripts/clips/episode-cut.mjs";

const nell = { id: "house-nell", name: "Nell Abiodun", pronouns: "she/her", portrait: "/api/assets/nell" };
const sable = { id: "house-sable", name: "Sable Quist", pronouns: "she/her", portrait: "/api/assets/sable" };
const pip = { id: "agent-pip", name: "Pip Okonkwo-Barr", pronouns: null, portrait: "/api/assets/pip" };

// Shaped like GET /api/episodes/<id> once a date has aired (the fields the cut reads).
const date = {
  id: "4bec5555-8e60-459d-ab21-e790c5af53fe",
  title: "One Leftover Screw",
  venue: "flat_pack",
  ending: "second_date",
  why: "A fifth date: chemistry 72 and attraction 68 carried it.",
  share_path: "/episodes/4bec5555-8e60-459d-ab21-e790c5af53fe",
  characters: [nell, sable],
  transcript: [
    { side: "a" as const, emotion: "warm", dialogue: "Fine, I'll confess. I know the way out. The sign's behind the bunk beds. I've been standing here not taking it. That's the one I'm hiding." },
    { side: "b" as const, emotion: "delighted", dialogue: "Wait, you KNOW the way out? Yes! Whatever you're about to suggest, yes." },
    { side: "a" as const, emotion: "wry", dialogue: "*adjusts glasses* Honest answer? I go to work." },
  ],
  inner: {
    thoughts: ["She said it lightly, but she meant it.", null, null],
    choices: [
      { character_id: "house-nell", see_again: "yes" },
      { character_id: "house-sable", see_again: "maybe" },
    ],
  },
  diary: [{ character_id: "house-sable", line: "She knows the way out and still stays." }],
};
const other = { ...date, id: "ed42110f", title: "Shouting By The Pillar", venue: "nightclub", ending: "disaster", why: "A disaster: trust 40 finished low.", characters: [pip, nell], inner: { thoughts: [], choices: [] }, diary: [] };

describe("shortening a line", () => {
  it("splits a line into whole sentences, punctuation kept", () => {
    expect(sentences("Yes! Whatever you're about to suggest, yes.  Fine…  ok")).toEqual(["Yes!", "Whatever you're about to suggest, yes.", "Fine…  ok".replace(/\s+/g, " ")]);
    expect(sentences("")).toEqual([]);
  });

  it("keeps whole sentences in order and marks only the gaps between them", () => {
    const line = date.transcript[0].dialogue;
    expect(pickText(line)).toBe(line);
    expect(pickText(line, [1, 3])).toBe("I know the way out. … I've been standing here not taking it.");
    expect(pickText(line, [3, 1, 1])).toBe("I know the way out. … I've been standing here not taking it."); // sorted, once each
    expect(pickText(line, [1, 2])).toBe("I know the way out. The sign's behind the bunk beds."); // adjacent: no mark
    expect(pickText(line, [4])).toBe("That's the one I'm hiding."); // nothing marked at the edges
  });

  it("refuses a sentence the line doesn't have", () => {
    expect(() => pickText("One. Two.", [2])).toThrow(/no sentence 2/);
    expect(() => pickText("One. Two.", [-1])).toThrow(/no sentence -1/);
  });
});

describe("the ending as the page names it", () => {
  it("reads the page's own name for a follow-up date, and the plain label otherwise", () => {
    expect(endingLabel(date)).toBe("A fifth date");
    expect(endingLabel({ ending: "second_date", why: "An eighth date: chemistry 81 carried it." })).toBe("An eighth date");
    expect(endingLabel({ ending: "second_date", why: "A twenty-first date: chemistry carried it." })).toBe("A twenty-first date");
    expect(endingLabel(other)).toBe("A disaster");
    expect(endingLabel({ ending: "friends", why: null })).toBe("Just friends");
    expect(endingLabel({ ending: "second_date", why: "Something else entirely" })).toBe("A second date");
    expect(endingLabel({ ending: null, why: null })).toBeNull();
  });
});

describe("resolving the edit against the public episode", () => {
  const edl = (segments: Edl["segments"]) => ({ segments });

  it("quotes a line with its speaker, the other one, the emotion and an optional label", () => {
    const [cold, line] = resolveBeats(edl([{ kind: "cold", line: 0, keep: [1, 3] }, { kind: "line", line: 1, label: "Date four with Nell" }]), [date]);
    expect(cold).toMatchObject({ kind: "cold", speaker: nell, other: sable, emotion: "warm", text: "I know the way out. … I've been standing here not taking it.", voiced: true, label: null });
    expect(line).toMatchObject({ speaker: sable, other: nell, label: "Date four with Nell" });
  });

  it("shows only a thought or a diary line the page shows, and both see-again answers or none", () => {
    expect(resolveBeats(edl([{ kind: "thought", line: 0 }]), [date])[0]).toMatchObject({ speaker: nell, text: "She said it lightly, but she meant it.", label: "What Nell was thinking" });
    // An agent's own thoughts are private on the page (null in the JSON): the cut can't show them either.
    expect(() => resolveBeats(edl([{ kind: "thought", line: 1 }]), [date])).toThrow(/segment 1 \(thought\): line 1 has no public thought/);
    expect(resolveBeats(edl([{ kind: "diary", side: "b" }]), [date])[0]).toMatchObject({ speaker: sable, label: "Sable, afterwards" });
    expect(() => resolveBeats(edl([{ kind: "diary", side: "a" }]), [date])).toThrow(/no public diary line for Nell Abiodun/);
    expect(resolveBeats(edl([{ kind: "choice" }]), [date])[0]).toMatchObject({ answers: ["yes", "maybe"], voiced: false });
    expect(() => resolveBeats(edl([{ kind: "choice" }]), [other])).toThrow(/doesn't show both answers/);
  });

  it("names the ending the page's way and lets a title or card choose its faces", () => {
    const [reveal, title, solo, card, cardFace] = resolveBeats(
      edl([
        { kind: "reveal", sub: "Nell left first anyway." },
        { kind: "title", title: "Lost in a furniture maze" },
        { kind: "title", title: "Sable has a line.", faces: [[0, "b"]] },
        { kind: "card", title: "Nell is December's Botchelor.", url: "botchelor.com/december", say: "Nell is December's Botchelor." },
        { kind: "card", title: "Three dates.", faces: [[0, "a"], [1, "a"], [1, "b"]] },
      ]),
      [date, other],
    );
    expect(reveal).toMatchObject({ ending: "second_date", title: "A fifth date", sub: "Nell left first anyway.", voiced: false });
    expect(title.faces).toEqual([nell, sable]);
    expect(solo.faces).toEqual([sable]);
    expect(card).toMatchObject({ faces: [], voiced: true, voice: HOST_VOICE });
    expect(cardFace.faces).toEqual([nell, pip, nell]);
  });

  it("says which segment is wrong", () => {
    expect(() => resolveBeats(edl([]), [date])).toThrow(/no segments/);
    expect(() => resolveBeats(edl([{ kind: "line", line: 9 }]), [date])).toThrow(/segment 1 \(line\): line 9 has no dialogue/);
    expect(() => resolveBeats(edl([{ kind: "line", line: 0 }, { kind: "line", ep: 2, line: 0 }]), [date])).toThrow(/segment 2 \(line\): no episode 2/);
    expect(() => resolveBeats(edl([{ kind: "title" }]), [date])).toThrow(/a title needs a title/);
    expect(() => resolveBeats(edl([{ kind: "title", title: "x", faces: [[3, "a"]] }]), [date])).toThrow(/face 1 names no episode 3/);
    expect(() => resolveBeats(edl([{ kind: "reveal" }]), [{ ...date, ending: null }])).toThrow(/no ending yet/);
    expect(() => resolveBeats(edl([{ kind: "nope" as "line" }]), [date])).toThrow(/unknown kind/);
  });
});

describe("timing and voices", () => {
  it("holds a spoken beat for its voice plus breath, a silent one for its own length", () => {
    expect(beatSeconds({ kind: "line", voiced: true, secs: null }, 3)).toBe(Math.round((3 + LEAD_IN + LEAD_OUT) * 100) / 100);
    expect(beatSeconds({ kind: "choice", voiced: false, secs: null }, 0)).toBe(SILENT_SECONDS.choice);
    expect(beatSeconds({ kind: "reveal", voiced: false, secs: null }, 0)).toBe(SILENT_SECONDS.reveal);
    expect(beatSeconds({ kind: "title", voiced: true, secs: 5 }, 2)).toBe(5); // an editor's length, never shorter than the voice
    expect(beatSeconds({ kind: "title", voiced: true, secs: 1 }, 2)).toBeCloseTo(2 + LEAD_IN + LEAD_OUT);
  });

  it("puts the editor's words in the host's mouth and a character's own words in theirs", () => {
    expect(spokenText({ kind: "card", voiced: true, say: "Nell is December's Botchelor." })).toBe("Nell is December's Botchelor.");
    expect(spokenText({ kind: "line", voiced: true, text: date.transcript[2].dialogue })).toBe("Honest answer? I go to work."); // actions aren't read out
    expect(spokenText({ kind: "choice", voiced: false })).toBe("");
  });

  it("films a silent beat over silence and a spoken one over its voice, breath first", () => {
    const silent = segmentArgs({ frame: "f.png", voice: null, seconds: 3, out: "s.mp4" });
    expect(silent.join(" ")).toContain("anullsrc=r=48000:cl=stereo");
    expect(silent.slice(-1)).toEqual(["s.mp4"]);
    const spoken = segmentArgs({ frame: "f.png", voice: "v.mp3", seconds: 4.2, out: "s.mp4" }).join(" ");
    expect(spoken).toContain(`adelay=${Math.round(LEAD_IN * 1000)}|${Math.round(LEAD_IN * 1000)}`);
    expect(spoken).toContain("-t 4.200");
    expect(spoken).toContain("1080x1920");
  });
});

describe("frames and captions", () => {
  it("draws the venue's backdrop when the venue has one", () => {
    expect(backdropOf("flat_pack")).toBe("/cast/venue-flat_pack-v2.webp");
    expect(backdropOf("nightclub@2")).toBe("/cast/venue-nightclub-v2.webp");
    expect(backdropOf("elsewhere")).toBeNull();
    expect(backdropOf("../etc")).toBeNull();
    expect(backdropOf(null)).toBeNull();
  });

  it("escapes what it draws and marks private words as shown once the date aired", () => {
    const [thought, line] = resolveBeats({ segments: [{ kind: "thought", line: 0 }, { kind: "line", line: 1, label: "<b>Date four</b>" }] }, [date]);
    expect(frameHtml(thought, { base: "https://botchelor.com" })).toContain("A private thought, shown once the date aired");
    const html = frameHtml(line, { base: "https://botchelor.com" });
    expect(html).toContain("&lt;b&gt;Date four&lt;/b&gt;");
    expect(html).not.toContain("<b>Date four</b>");
    expect(html).toContain("https://botchelor.com/api/assets/sable");
    expect(html).toContain("/cast/venue-flat_pack-v2.webp");
  });

  it("writes the caption: hook, question, where to watch, the AI line, tags once each", () => {
    const caption = cutCaption({ episodes: [date.id], hook: "She knew the way out.", question: "Who's in more trouble?", tags: "#romance #realitytv", segments: [] }, [date]);
    expect(caption.split("\n")).toEqual([
      "She knew the way out.",
      "",
      "Who's in more trouble?",
      "",
      `Watch the whole date: botchelor.com${date.share_path}?s=tiktok`,
      "Every character is AI, and every date is AI-generated fiction.",
      "",
      "#botchelor #aicharacters #datingshow #realitytv #originalcharacter #romance",
    ]);
    const own = cutCaption({ episodes: [date.id], hook: "h", question: "q", watch: "botchelor.com/characters/house-sable", watch_label: "All of Sable's dates", segments: [] }, [date]);
    expect(own).toContain("All of Sable's dates: botchelor.com/characters/house-sable?s=tiktok");
  });
});

describe("the December cuts (docs/clips/edl)", () => {
  const dir = "docs/clips/edl";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const kinds = new Set(["cold", "line", "thought", "diary", "choice", "title", "card", "reveal"]);

  it("are six, two per direction, each with a hook, a question and a closing card that sends people to December", () => {
    expect(files).toHaveLength(6);
    const edls = files.map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Edl);
    const directions = edls.map((e) => e.direction).sort();
    expect(directions).toEqual(["confessional", "confessional", "funny_disaster", "funny_disaster", "unexpected_chemistry", "unexpected_chemistry"]);
    for (const e of edls) {
      expect(e.episodes.length).toBeGreaterThan(0);
      expect(e.hook && e.question).toBeTruthy();
      for (const s of e.segments) expect(kinds.has(s.kind)).toBe(true);
      const last = e.segments[e.segments.length - 1];
      expect(last).toMatchObject({ kind: "card", url: "botchelor.com/december" });
      // A cut quotes lines by number from an aired episode: never a line typed into the EDL.
      for (const s of e.segments) expect(Object.keys(s)).not.toContain("text");
    }
  });
});
