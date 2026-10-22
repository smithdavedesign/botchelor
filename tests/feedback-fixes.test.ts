import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_TEMPERATURE } from "@/lib/beats";
import { assembleCharacter, loadCharacter, type Character } from "@/lib/character";
import { buildTurnMessages, TURN_TEMPERATURE } from "@/lib/conversation";
import { wantTerms } from "@/lib/dating";
import { deterministicEngine, fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type SideOutcome, type SideSetup } from "@/lib/engine";
import { handleMcpMessage } from "@/lib/mcp";
import { computeMemory, type MemoryEpisode } from "@/lib/memory";
import { STRATEGIES, type Strategy } from "@/lib/rules";
import { buildDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { pickVenue, pickVenueAvoiding, VENUE_IDS } from "@/lib/venues";
import { endingNumbers, endingWhy } from "@/lib/why";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const outcomeSide = (o: Partial<SideOutcome> = {}): SideOutcome => ({ wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null, ...o });

describe("match reasons keep a phrase whole (run 5: “water” out of “High water”)", () => {
  it("a word in a compound only counts as the compound; a telling word on its own still counts", () => {
    expect(wantTerms("Someone who knows when it's high water")).toEqual(["high water"]);
    expect(wantTerms("Someone who loves maps and puzzles")).toEqual(["maps", "puzzles"]);
    expect(wantTerms("A night market regular who plays chess")).toEqual(["night market", "regular", "plays chess"]);
  });
});

describe("memory cues need substance (run 5: “warms to ‘check’”)", () => {
  const aired = (want_met: string): MemoryEpisode => ({
    id: `ep-${want_met}`, ending: "second_date", sides: [outcomeSide({ want_met }), outcomeSide()], transcript: [], reflections: null, is_a: true,
    revealed_at: "2026-10-17T12:00:00Z", drama_question: null, drama_answer: null, venue: null, other_id: "house-nell", other_name: "Nell Abiodun", other_house: true,
  });
  it("an everyday word is never what a character learned it warms to; a telling one is", () => {
    expect(computeMemory([aired("check")], { want: null, dealbreaker: null }).likes).not.toContain("check");
    expect(computeMemory([aired("lighthouses")], { want: null, dealbreaker: null }).likes).toContain("lighthouses");
  });
});

describe("the why line shows the arithmetic (run 5: 62 a disaster, 68 friends)", () => {
  const box = (chemistry: number, attraction: number, trust: number, awkwardness: number) => ({
    chemistry: { start: 50, delta: chemistry - 50, final: chemistry },
    attraction: { start: 48, delta: attraction - 48, final: attraction },
    trust: { start: 45, delta: trust - 45, final: trust },
    awkwardness: { start: 40, delta: awkwardness - 40, final: awkwardness },
  });

  it("says how the strategy weighs the numbers, where this date came out and what each ending needs", () => {
    const why = endingWhy("disaster", box(62, 48, 48, 50), [outcomeSide(), outcomeSide()], "genuine_chemistry", 3)!;
    // 0.45×62 + 0.3×48 + 0.2×48 − 0.4×50 = 31.9; an ordinary date scores 29.9 under the same strategy.
    expect(why).toMatch(/By the numbers: a date played for genuine chemistry counts chemistry 45%, attraction 30% and trust 20%, minus 40% of awkwardness\./);
    expect(why).toMatch(/This one came out \+2\.0 against an ordinary date: friends needs \+6\.5, a second date \+12\.0\.$/);
    expect(endingNumbers(box(62, 48, 48, 50), [outcomeSide({ dealbreaker_hit: "smoking" }), outcomeSide()], "genuine_chemistry", 3)).toMatch(/and 11 for the tripped dealbreaker\. This one came out −9\.0/);
    // Only where it can be reproduced: not for a v1 date, nor without its sides.
    expect(endingNumbers(box(62, 48, 48, 50), [outcomeSide(), outcomeSide()], "genuine_chemistry", 1)).toBeNull();
    expect(endingNumbers(box(62, 48, 48, 50), null, "genuine_chemistry", 3)).toBeNull();
  });

  it("never disagrees with the engine: across strategies and seeds, the number it gives explains the ending", () => {
    const sheet = (name: string, o: Partial<CharacterSheet> = {}): CharacterSheet => ({ name, age: 30, bio: "A cartographer who maps cities that only exist on Tuesdays.", traits: ["curious", "stubborn", "warm"], want: "Someone who can read a map upside down", dealbreaker: "People who hate surprises", house: false, ...o });
    const side = (strategy: Strategy, autonomy: SideSetup["autonomy"], s: CharacterSheet): SideSetup => ({ sheet: s, signals: NEUTRAL_SIGNALS, autonomy, strategy, agendaId: "find_funny", note: null, gameBudget: 25 });
    let checked = 0;
    for (const strategy of STRATEGIES) {
      for (const autonomy of ["guided", "balanced", "unpredictable"] as const) {
        for (let seed = 1; seed <= 25; seed++) {
          const input: DateInput = { a: side(strategy, autonomy, sheet("Mira")), b: side("genuine_chemistry", "balanced", sheet("Rafe", { bio: "A baker who hates surprises and maps." })) };
          const o = deterministicEngine.decide(input, seed * 7919);
          const line = endingNumbers(o.variables, o.sides, strategy, 3)!;
          const rel = Number(line.match(/came out ([+−])(\d+\.\d)/)!.slice(1).join("").replace("−", "-"));
          // One decimal of rounding either side of a mark is the only slack.
          const expected = rel >= 12.05 ? "second_date" : rel >= 6.55 ? "friends" : rel < 6.45 ? "disaster" : null;
          if (expected) expect(o.ending, `${strategy}/${autonomy}/${seed}: ${line}`).toBe(expected);
          checked++;
        }
      }
    }
    expect(checked).toBe(STRATEGIES.length * 75);
  });
});

describe("the venue steps past where a character just was (run 4: the same double date twice)", () => {
  it("with nothing to avoid it deals exactly as before; otherwise it takes the next one free", () => {
    for (let seed = 0; seed < 20; seed++) expect(pickVenueAvoiding(seed)).toBe(pickVenue(seed));
    const first = pickVenue(3);
    expect(pickVenueAvoiding(3, [first])).not.toBe(first);
    expect(pickVenueAvoiding(3, [...VENUE_IDS])).toBe(first); // nowhere left: back to the dealt one
  });
});

describe("on a date, the sheet is a sketch, not a script (David, 2026-10-18)", () => {
  it("turns run warm, plans with some daring, and the prompt asks for something new", () => {
    expect(TURN_TEMPERATURE).toBe(1);
    expect(PLAN_TEMPERATURE).toBe(0.85);
    const s = (name: string, house: boolean): CharacterSheet => ({ name, age: 30, bio: "a cartographer", traits: ["curious", "warm", "dry"], want: "a map reader", dealbreaker: "liars", house });
    const side = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_funny", note: null, gameBudget: 25 });
    const input: DateInput = { a: side(s("Mira", false)), b: side(s("Rafe", true)) };
    const chars: [Character, Character] = [assembleCharacter({ id: "mira", sheet: input.a.sheet, soul: null, memory: null }), assembleCharacter({ id: "rafe", sheet: input.b.sheet, soul: null, memory: null })];
    const outcome = fixedEngine({ ending: "friends", sides: [outcomeSide(), outcomeSide()] }).decide(input, 1);
    const system = buildTurnMessages(input, outcome, chars, "a_hard_question", pickVenue(1), [], 0).messages[0].content;
    // The purpose-first prompt (David 2026-10-18) keeps the "sheet is a sketch" spirit and the originality nudge;
    // the rest of the rules moved to the critic (lib/quality.ts).
    expect(system).toMatch(/It is a sketch of who you are, not a script/);
    expect(system).toMatch(/Say the truer, odder or funnier thing a real person like you would/);
    expect(system).toMatch(/nobody else on this show would say/);
  });
});

describe("with the database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
    ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as Any).result;
  const book = async (cookie: string, characterId: string, partnerId: string) => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: characterId, partner_id: partnerId }, cookie);
    expect(res.status).toBe(200);
    return res.json();
  };
  const forDate = async (id: string) => {
    const c = (await loadCharacter(t.db, id))!;
    return { id, sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, house: id.startsWith("house-") } };
  };

  it("find_matches never makes a reason out of a fragment of a phrase", async () => {
    const made = (await call("create_character", { ...validCharacter({ name: "Tide Watcher", want: "Someone who knows when it's high water" }), attest: true })).structuredContent;
    const other = newUserCookie();
    await api.createCharacter(validCharacter({ name: "Drinks Water", bio: "Drinks a lot of water and swims in the lido.", open_to_dates: true }), other);
    await api.createCharacter(validCharacter({ name: "Harbour Pilot", bio: "A harbour pilot who lives for high water and fog.", open_to_dates: true }), newUserCookie());
    const matches = (await call("find_matches", { character_id: made.character.id, limit: 10, agent_id: made.agent_id })).structuredContent.matches as Any[];
    const why = (name: string) => matches.find((m) => m.name === name).why.join(" | ");
    expect(why("Drinks Water")).not.toMatch(/"water"/);
    expect(why("Harbour Pilot")).toMatch(/wants "high water" — that's in Harbour Pilot's profile/);
  });

  it("a character's own reflections on its creator's unaired and private dates reach its next date; another creator's don't", async () => {
    const cookie = newUserCookie();
    const userId = userIdOf(cookie);
    const me = (await (await api.createCharacter(validCharacter({ name: "Wren Kestrel" }), cookie)).json()).id as string;
    const waiting = await book(cookie, me, HOUSE_PARTNER_ID);
    const side = (ep: Any) => (ep.characters[0].id === me ? "a" : "b");
    await t.db.query(`update episodes set reflections = jsonb_build_object($2::text, 'Ask the second question, then listen.') where id = $1`, [waiting.id, side(waiting)]);
    const hidden = await book(cookie, me, "house-sable");
    await t.db.query(`update episodes set visibility = 'private', reflections = jsonb_build_object($2::text, 'A private lesson.') where id = $1`, [hidden.id, side(hidden)]);
    const built = await buildDate(t.db, "ep-next", await forDate(me), await forDate("house-teo"), DEFAULT_DATE_REQUEST, undefined, undefined, { creatorId: userId });
    // David (2026-10-18): a private date counts between the characters too, so its lesson comes along.
    expect([...(built.characters[0].memory?.reflections ?? [])].sort()).toEqual(["A private lesson.", "Ask the second question, then listen."]);
    // Booked by someone else, the pending lesson stays out (it's that creator's own unaired date).
    const theirs = await buildDate(t.db, "ep-theirs", await forDate(me), await forDate("house-teo"), DEFAULT_DATE_REQUEST, undefined, undefined, { creatorId: "someone-else" });
    expect(theirs.characters[0].memory?.reflections ?? []).toEqual([]);
  });

  it("guess_dealbreaker shows the four options, takes a guess by number, and keeps creators out", async () => {
    const cookie = newUserCookie();
    const me = (await (await api.createCharacter(validCharacter({ name: "Wren Kestrel", dealbreaker: "People who hum at the cinema" }), cookie)).json()).id as string;
    const ep = await book(cookie, me, HOUSE_PARTNER_ID);
    const agent = (await call("guess_dealbreaker", { episode_id: ep.id })).structuredContent;
    expect(agent.options).toHaveLength(4);
    expect(agent.options.map((o: Any) => o.text)).toContain("People who hum at the cinema");
    expect(agent).toMatchObject({ your_pick: null, revealed: false, next: expect.stringMatching(/its number 1 to 4/) });
    const real = agent.options.find((o: Any) => o.text === "People who hum at the cinema").number;
    const guessed = (await call("guess_dealbreaker", { episode_id: ep.id, pick: String(real), agent_id: agent.agent_id })).structuredContent;
    expect(guessed).toMatchObject({ guess: { pick: "People who hum at the cinema" }, points_if_right: 5 });
    expect((await call("guess_dealbreaker", { episode_id: ep.id, agent_id: agent.agent_id })).structuredContent.your_pick).toBe("People who hum at the cinema");
    expect((await call("guess_dealbreaker", { episode_id: ep.id, pick: "Not an option", agent_id: agent.agent_id })).content[0].text).toMatch(/Not valid — pick: one of the four options/); // 2.8.0: names pick
    expect((await call("guess_dealbreaker", { episode_id: ep.id, pick: "1", agent_id: userIdOf(cookie) })).content[0].text).toMatch(/One of your characters is on this date.*already know/);
  });

  it("get_relationships says when an owner's view counts dates that haven't aired", async () => {
    const cookie = newUserCookie();
    const userId = userIdOf(cookie);
    const me = (await (await api.createCharacter(validCharacter({ name: "Wren Kestrel" }), cookie)).json()).id as string;
    const ep = await book(cookie, me, HOUSE_PARTNER_ID);
    const before = (await call("get_relationships", { character_id: me, agent_id: userId })).structuredContent.relationships[0];
    expect(before).toMatchObject({ unaired_dates: 1, unaired_note: expect.stringMatching(/hasn't aired yet, so the stage and numbers here are provisional/) });
    await api.reveal(ep.id, cookie);
    const after = (await call("get_relationships", { character_id: me, agent_id: userId })).structuredContent.relationships[0];
    expect(after.unaired_dates).toBeUndefined();
  });

  it("a character's next date steps past the venues of its last two, and the worker deals the same one", async () => {
    const cookie = newUserCookie();
    const me = (await (await api.createCharacter(validCharacter({ name: "Wren Kestrel" }), cookie)).json()).id as string;
    const first = await book(cookie, me, HOUSE_PARTNER_ID);
    const second = await book(cookie, me, "house-sable");
    const third = await book(cookie, me, "house-teo");
    const setupOf = async (id: string) => (await t.db.query<{ setup: Any }>(`select setup from episodes where id = $1`, [id])).rows[0].setup;
    const [s1, s2, s3] = [await setupOf(first.id), await setupOf(second.id), await setupOf(third.id)];
    expect(s2.avoid_venues).toEqual([s1.venue]);
    expect(s2.venue).not.toBe(s1.venue);
    expect(new Set(s3.avoid_venues)).toEqual(new Set([s1.venue, s2.venue]));
    expect([s1.venue, s2.venue]).not.toContain(s3.venue);
  });
});
