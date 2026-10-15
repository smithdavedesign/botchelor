import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileDetails from "@/app/characters/[id]/ProfileDetails";
import { characterSchema } from "@/lib/agents";
import { buildDirectorMessages } from "@/lib/beats";
import { assembleCharacter, characterBlindView, characterSelfView, type Character } from "@/lib/character";
import { buildTurnMessages, critiqueTurn, type Turn } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type SideOutcome, type SideSetup } from "@/lib/engine";
import type { Ending } from "@/lib/rules";
import {
  ExtrasInput,
  LINE_SUGGESTIONS,
  NEVER_SAY_SUGGESTIONS,
  normaliseExtras,
  TELL_SUGGESTIONS,
  type CharacterExtras,
} from "@/lib/extras";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { currentTell, tellMoment } from "@/lib/personality";
import { lineIssues, neverSaid } from "@/lib/quality";
import { checkFields } from "@/lib/safety";
import { pickVenue } from "@/lib/venues";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const KIT: CharacterExtras = {
  lines: { hello: "Oh good, you're real. I had a small bet with myself.", dodge: "Ask me again when the fog lifts." },
  tells: { nervous: "check the sky through the nearest window", smitten: "start predicting your weather", bored: "count the ceiling tiles", annoyed: "get terrifyingly polite" },
  never_says: ["no worries", "literally"],
};

const sheetA: CharacterSheet = { name: "Juno Marlowe", age: 28, bio: "A tarot reader who only predicts the weather.", traits: ["mystic", "cheeky", "kind"], want: "someone who dances in the rain", dealbreaker: "checking the forecast app", house: false, pronouns: "she/her" };
const sheetB: CharacterSheet = { name: "Cass Vega", age: 33, bio: "A demolition expert turned florist.", traits: ["bold", "gentle", "precise"], want: "a quiet evening", dealbreaker: "surprise fireworks", house: false, pronouns: "she/her" };
const side = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_funny", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: side(sheetA), b: side(sheetB) };
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "juno", sheet: sheetA, soul: null, memory: null, extras: KIT }),
  assembleCharacter({ id: "cass", sheet: sheetB, soul: null, memory: null, extras: { tells: { nervous: "CASS-ONLY-TELL straighten the cutlery" } } }),
];
const VENUE = pickVenue(1);
const so = (wants: boolean, extra: Partial<SideOutcome> = {}): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null, ...extra });
const outcome = (ending: Ending, a: SideOutcome, b: SideOutcome = so(true)) => fixedEngine({ ending, sides: [a, b] }).decide(INPUT, 1);

/** The per-agent data the turn prompt carries (the user message). */
const turnData = (o: ReturnType<typeof outcome>, transcript: Turn[], turnIndex: number, total = 6): Any =>
  JSON.parse(buildTurnMessages(INPUT, o, CHARS, "a_hard_question", VENUE, transcript, turnIndex, "classic", {}, { totalTurns: total }).messages[1].content.replace(/^[^\n]*\n/, ""));

const line = (side: "a" | "b", dialogue: string, action = ""): Turn => ({ side, act: 0, dialogue, action, emotion: "", interest: 0.5 });

describe("the voice kit's shape", () => {
  it("keeps what's filled, drops blanks, and de-dupes never-says without minding case", () => {
    expect(
      normaliseExtras({
        lines: { hello: "  Hi.  ", dodge: "   " },
        tells: { bored: "", annoyed: "go quiet" },
        never_says: ["No worries", "no worries", " ", "literally"],
      } as Any),
    ).toEqual({ lines: { hello: "Hi." }, tells: { annoyed: "go quiet" }, never_says: ["No worries", "literally"] });
    expect(normaliseExtras({ lines: {}, tells: {} } as Any)).toEqual({});
  });

  it("refuses unknown moments, too many never-says and over-long lines", () => {
    expect(ExtrasInput.safeParse({ lines: { goodbye: "Bye." } }).success).toBe(false);
    expect(ExtrasInput.safeParse({ tells: { jealous: "sulks" } }).success).toBe(false);
    expect(ExtrasInput.safeParse({ never_says: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(ExtrasInput.safeParse({ lines: { hello: "x".repeat(141) } }).success).toBe(false);
    expect(ExtrasInput.safeParse(KIT).success).toBe(true);
  });

  it("every built-in idea passes the show's content rules", () => {
    const ideas = [...Object.values(LINE_SUGGESTIONS).flat(), ...Object.values(TELL_SUGGESTIONS).flat(), ...NEVER_SAY_SUGGESTIONS];
    for (const idea of ideas) expect(checkFields({ idea }).ok, idea).toBe(true);
  });

  it("is published for agents in the character JSON Schema", () => {
    const extras = (characterSchema("https://b.test") as Any).properties.extras.properties;
    expect(Object.keys(extras.lines.properties)).toEqual(["hello", "dodge", "flirt", "upset"]);
    expect(Object.keys(extras.tells.properties)).toEqual(["nervous", "smitten", "bored", "annoyed"]);
    expect(extras.never_says.maxItems).toBe(5);
  });
});

describe("tells react to how the date is going", () => {
  it("nerves first; then the feeling the engine decided for this side", () => {
    expect(tellMoment(outcome("second_date", so(true)), 0, 0)).toBe("nervous");
    expect(tellMoment(outcome("second_date", so(true)), 0, 1)).toBe("smitten");
    expect(tellMoment(outcome("friends", so(true)), 0, 2)).toBe("smitten");
    expect(tellMoment(outcome("friends", so(false)), 0, 1)).toBe("bored");
    expect(tellMoment(outcome("second_date", so(false, { dealbreaker_hit: "fireworks" })), 0, 1)).toBe("annoyed");
    expect(tellMoment(outcome("disaster", so(false)), 0, 2)).toBe("annoyed");
    // Against their better judgement: drawn in during the date, then unsettled by the end.
    expect(tellMoment(outcome("disaster", so(true)), 0, 1)).toBe("smitten");
    expect(tellMoment(outcome("disaster", so(true)), 0, 2)).toBe("nervous");
  });

  it("the speaker gets only the one tell for this act, in the second person, and never the other's", () => {
    const o = outcome("disaster", so(false));
    const act0 = turnData(o, [], 0);
    expect(act0.your_tell_right_now).toBe("When you're nervous, you check the sky through the nearest window");
    expect(JSON.stringify(act0)).not.toContain("terrifyingly polite");
    expect(JSON.stringify(act0)).not.toContain("CASS-ONLY-TELL");

    const act2 = turnData(o, [line("a", "Hi."), line("b", "Hello."), line("a", "So."), line("b", "Yes.")], 4);
    expect(act2.your_tell_right_now).toBe("When something annoys you, you get terrifyingly polite");
    expect(currentTell(CHARS[1], o, 1, 1)).toBeNull(); // Cass has no tell for that feeling: nothing is invented
  });

  it("a character with no tells gets none, and its prompt is unchanged", () => {
    const plain = assembleCharacter({ id: "p", sheet: sheetA, soul: null, memory: null });
    expect(currentTell(plain, outcome("second_date", so(true)), 0, 0)).toBeNull();
    expect(characterSelfView(plain)).not.toHaveProperty("voice_examples");
    expect(characterSelfView(plain)).not.toHaveProperty("never_say");
    expect(characterSelfView(plain)).not.toHaveProperty("details");
  });

  it("the director, who plans the whole date, sees every tell", () => {
    const data = buildDirectorMessages(INPUT, outcome("second_date", so(true)), CHARS, "a_hard_question", VENUE, "classic", {})[1].content;
    expect(data).toContain("When they're bored, they count the ceiling tiles");
    expect(data).toContain("CASS-ONLY-TELL");
  });
});

describe("the voice, shown rather than described", () => {
  it("the speaker sees its own sample lines and never-says; its date sees neither", () => {
    const self = characterSelfView(CHARS[0]) as Any;
    expect(self.voice_examples).toEqual(["How they say hello: Oh good, you're real. I had a small bet with myself.", "How they dodge a question: Ask me again when the fog lifts."]);
    expect(self.never_say).toEqual(["no worries", "literally"]);
    expect(self).not.toHaveProperty("details"); // the voice kit is not a list of things to talk about
    const blind = JSON.stringify(characterBlindView(CHARS[0]));
    expect(blind).not.toContain("small bet");
    expect(blind).not.toContain("no worries");
  });

  it("never-says match whole words, any case", () => {
    expect(neverSaid("No worries! Honestly.", ["no worries"])).toBe("no worries");
    expect(neverSaid("I literally can't.", ["Literally"])).toBe("Literally");
    expect(neverSaid("That's a worriesome forecast.", ["no worries"])).toBeNull();
    expect(neverSaid("Anything", undefined)).toBeNull();
  });

  it("the critic sends back a never-say, or a sample line read out word for word", () => {
    const said = (dialogue: string) => lineIssues([line("b", "So what do you do?")], line("a", dialogue), CHARS);
    expect(said("No worries, I predict the weather.").never_said).toBe("no worries");
    expect(said("Oh good, you're real. I had a small bet with myself.").sample_echo).toBe(true);
    expect(said("You're real! I bet the fog you'd show.").sample_echo).toBe(false);

    const note = critiqueTurn([line("b", "So what do you do?")], line("a", "No worries, honestly."), INPUT, CHARS, VENUE);
    expect(note).toContain(`you'd never say "no worries"`);
    const echo = critiqueTurn([line("b", "Hi!")], line("a", "Ask me again when the fog lifts."), INPUT, CHARS, VENUE);
    expect(echo).toContain("repeats one of your example lines");
  });
});

describe("on the card", () => {
  it("shows the lines, the never-says and the tells", () => {
    const html = renderToStaticMarkup(createElement(ProfileDetails, { extras: KIT }));
    expect(html).toContain("In their own words");
    expect(html).toContain("How they say hello");
    expect(html).toContain("“no worries”");
    expect(html).toContain("Their tells");
    expect(html).toContain("When they&#x27;re nervous, they");
  });
});

describe("through the API and MCP", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it("stores the kit, runs the content filter over it, and edits it", async () => {
    const owner = newUserCookie();
    const res = await api.createCharacter(validCharacter({ extras: KIT }), owner);
    expect(res.status).toBe(201);
    const id = (await res.json()).id;
    expect((await t.db.query<Any>(`select extras from characters where id = $1`, [id])).rows[0].extras.tells.smitten).toBe("start predicting your weather");

    const bad = await api.editCharacter(id, { extras: { tells: { annoyed: "watches porn" } } }, owner);
    expect(bad.status).toBe(422);
    expect((await bad.json()).field).toBe("tells");
    expect((await api.editCharacter(id, { extras: { lines: { flirt: "You'd be a good bookmark." } } }, owner)).status).toBe(200);
    expect((await t.db.query<Any>(`select extras from characters where id = $1`, [id])).rows[0].extras).toEqual({ lines: { flirt: "You'd be a good bookmark." } });
  });

  it("an agent can give its character a voice kit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx);
    const r = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ extras: KIT }) } },
      { sessionId: ctx.issuedSessionId },
    ))!.result as Any;
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.character.extras.never_says).toEqual(["no worries", "literally"]);
  });
});
