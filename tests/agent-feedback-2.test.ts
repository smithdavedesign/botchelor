// The second uninstructed-visitor run's suggestions (docs/agent-visitor-test.md, run 2), the pure parts.
import { describe, expect, it } from "vitest";
import { extrasVisible } from "@/lib/extras";
import { formatNote } from "@/lib/formats";
import { momentCue } from "@/lib/memory";
import { lookalikeWhy, scoreSheet } from "@/lib/originality";
import { degenerate, ownTurnProblem } from "@/lib/own-date";
import { plainVerb } from "@/lib/personality";
import { computeRelationship, type RelEpisode } from "@/lib/relationships";
import { checkFields, checkShowText } from "@/lib/safety";
import { requestBase } from "@/lib/site";
import type { Turn } from "@/lib/conversation";

const turn = (side: "a" | "b", dialogue: string, interest = 0.5): Turn => ({ side, act: 0, dialogue, action: "", emotion: "", interest });

describe("1. the content rules on what a date's performers write", () => {
  it("holds a line that puts a character's age under 18, even in passing", () => {
    expect(checkShowText({ line: "He started at twelve on his uncle's lawnmower." })).toEqual({ ok: false, reason: "minor", field: "line" });
    expect(checkShowText({ line: "When I was ten I wanted to be a lighthouse." }).ok).toBe(false);
    expect(checkShowText({ line: "I've done this since the age of 14." }).ok).toBe(false);
    expect(checkShowText({ line: "a twelve-year-old me would be proud" }).ok).toBe(false);
  });
  it("lets times, counts and adult ages through", () => {
    for (const ok of ["Lunch at twelve?", "I started at nine this morning.", "Meet at seven tonight.", "When I was 25 I moved here.", "Booth six, Thursday, 3am."]) {
      expect(checkShowText({ line: ok }).ok, ok).toBe(true);
    }
  });
  it("leaves character sheets as they were (a bio can mention a childhood)", () => {
    expect(checkFields({ bio: "Has mowed lawns since she was twelve." }).ok).toBe(true);
  });
  it("sends back an agent's line that breaks its own sheet", () => {
    const before = [turn("a", "Evening. Exact change?"), turn("b", "Never.")];
    const ok = turn("a", "Then that's a warm five.");
    expect(ownTurnProblem(JSON.stringify({ dialogue: ok.dialogue }), ok, ["you're a ten"], before)).toBeNull();
    const ten = turn("a", "Honestly? You're a ten.");
    expect(ownTurnProblem(JSON.stringify({ dialogue: ten.dialogue }), ten, ["you're a ten"], before)).toMatch(/never says "you're a ten"/);
    const long = "x".repeat(400);
    expect(ownTurnProblem(JSON.stringify({ dialogue: long }), turn("a", long.slice(0, 280)), [], before)).toMatch(/400 characters/);
    expect(ownTurnProblem("{}", turn("a", "Evening. Exact change?"), [], before)).toMatch(/already said/);
    expect(degenerate("ten ten ten ten ten ten ten ten ten")).toBe(true);
    expect(degenerate("I keep a ledger, I keep a ledger, I keep a ledger")).toBe(true);
    expect(degenerate("I have never given a ten, but the pencil is getting nervous tonight.")).toBe(false);
  });
});

describe("2. memory comes from what happened", () => {
  it("credits the other's line that moved this character most", () => {
    const t = [turn("a", "Hi.", 0.4), turn("b", "What score would you give me?"), turn("a", "Ask me at the end.", 0.8), turn("b", "Fine."), turn("a", "Ok.", 0.7)];
    expect(momentCue(t, "a", 1)).toBe("What score would you give me?");
    expect(momentCue(t, "a", -1)).toBeNull(); // a 0.1 drop isn't a moment
    expect(momentCue([], "a", 1)).toBeNull();
  });
});

describe("4. originality catches near-clones", () => {
  it("flags the same job with a similar story, and leaves different people alone", () => {
    const marguerite = {
      bio: "Works the night shift at booth 6 on a coastal toll bridge, rating every driver out of ten in a spiral ledger.",
      extras: { occupation: "Night-shift toll collector" },
    };
    const marisol = { bio: "A toll collector on the graveyard shift who scores every driver in a ledger she never rereads.", extras: { occupation: "Toll booth attendant" } };
    const baker = { bio: "Bakes sourdough at dawn for a seaside café and argues with seagulls.", extras: { occupation: "Baker" } };
    expect(lookalikeWhy(marisol, marguerite, "Marguerite Oyelaran")?.why).toMatch(/Marguerite Oyelaran/);
    expect(lookalikeWhy(baker, marguerite, "Marguerite Oyelaran")).toBeNull();
  });
  it("doesn't ask for details already given (run 2, visitor B)", () => {
    const tips = scoreSheet({ extras: { occupation: "Toll collector", quirk: "Scores everything" } }, [], []).tips;
    expect(tips.join(" ")).toMatch(/One more detail/);
    expect(tips.join(" ")).not.toMatch(/a job, a quirk/);
  });
});

describe("6. plans made on a date with no afterglow", () => {
  it("come from its closing lines", () => {
    const e: RelEpisode = {
      id: "own-1", created_at: "2026-10-16T00:00:00Z", revealed_at: "2026-10-16T01:00:00Z", visibility: "public", hidden: false, creator_id: "agent",
      character_a: "a", character_b: "b", ending: "second_date", sides: null, box_score: null, venue: null, followup_of: null, afterglow: null,
      transcript: [turn("a", "So."), turn("b", "So."), turn("a", "Booth six, Thursday, 3am. Bring the thermos."), turn("b", "It's a date.")],
    };
    const rel = computeRelationship("a", "b", [e]);
    expect(rel.plans.map((p) => p.text)).toContain("Booth six, Thursday, 3am. Bring the thermos.");
  });
});

describe("7. the guide points at the host it was fetched from", () => {
  it("uses the request's origin unless production says otherwise", () => {
    expect(requestBase(new Request("http://127.0.0.1:4411/llms.txt"), {})).toBe("http://127.0.0.1:4411");
    expect(requestBase(new Request("http://127.0.0.1:4411/llms.txt"), { VERCEL_PROJECT_PRODUCTION_URL: "botchelor.com" })).toMatch(/botchelor\.com/);
  });
});

describe("8. grammar", () => {
  it("puts a tell's verb in the plain form after 'you'", () => {
    expect(plainVerb("taps your pencil")).toBe("tap your pencil");
    expect(plainVerb("strikes a match")).toBe("strike a match");
    expect(plainVerb("hurries off")).toBe("hurry off");
    expect(plainVerb("touches your sleeve")).toBe("touch your sleeve");
    expect(plainVerb("has a sip")).toBe("have a sip");
    expect(plainVerb("goes quiet")).toBe("go quiet");
    expect(plainVerb("fusses with a cuff")).toBe("fuss with a cuff");
    expect(plainVerb("tap your pencil")).toBe("tap your pencil");
    expect(plainVerb("glass of water")).toBe("glass of water");
  });
  it("lowercases the article in a signature item", () => {
    expect(extrasVisible({ signature_item: "A tuning fork on a cord" })).toEqual(["has a tuning fork on a cord"]);
    expect(extrasVisible({ signature_item: "Alfie's old watch" })).toEqual(["has Alfie's old watch"]);
  });
  it("doesn't call a rematch two strangers", () => {
    expect(formatNote("classic")).toMatch(/two strangers/);
    expect(formatNote("classic", { metBefore: true })).not.toMatch(/strangers/);
  });
});
