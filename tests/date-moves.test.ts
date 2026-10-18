import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTurnMessages, parseTurnResult, simulateConversation, type Turn } from "@/lib/conversation";
import { fixedEngine } from "@/lib/engine";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { ChatMessage, Model } from "@/lib/model";
import { dateShape, moveProblem, placesPhrase, settleLine, whereItHappened, type DateShape } from "@/lib/moves";
import { movePlace } from "@/lib/places";
import { actForTurn, MAX_MOVES } from "@/lib/rules";
import { scenePlaces } from "@/lib/scenes";
import { buildMessages } from "@/lib/showrunner";
import { assembleDate, DEFAULT_DATE_REQUEST, type CharacterForDate } from "@/lib/simulation";
import { placeAt, type PlaceId } from "@/lib/venues";
import { turnSchedule } from "@/lib/watch";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// David, 2026-10-18: "if Chud says come back to my place and Nell says ok, we should change the scene and move the date
// into another phase… as long as it's mutual agreement… yes 2 scenes at most, but if they decide to move reset the convo
// limits so they can continue the discussion there."

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const line = (side: "a" | "b", act: number, extra: Partial<Turn> = {}): Turn => ({ side, act, dialogue: "Mm.", action: "", emotion: "warm", interest: 0.6, ...extra });
const START: PlaceId = "rooftop_bar";
const CHUD = { self: "Chud the crusher", other: "Nell Abiodun" };
const NELL = { self: "Nell Abiodun", other: "Chud the crusher" };

/** A transcript of `n` lines with the acts the shape gives each one, and `stamps` (by index) applied as they go. */
function played(n: number, base: number, stamps: Record<number, Partial<Turn>> = {}): Turn[] {
  const t: Turn[] = [];
  for (let i = 0; i < n; i++) {
    const s = dateShape(t, START, base, { moves: true });
    t.push(line(i % 2 === 0 ? "a" : "b", s.act, stamps[i] ?? {}));
  }
  return t;
}

describe("dateShape: where a date stands", () => {
  it("maps a date with no moves exactly as before, for every length", () => {
    for (const base of [6, 12, 16, 20, 28]) {
      const t: Turn[] = [];
      for (let i = 0; i < base; i++) {
        const s = dateShape(t, START, base, { moves: true });
        expect(s.total).toBe(base);
        expect(s.act).toBe(actForTurn(i, base));
        expect(s.closing).toBe(actForTurn(i, base) === 2);
        expect(s.place).toBe(START);
        t.push(line(i % 2 ? "b" : "a", s.act));
      }
      expect(dateShape(t, START, base, { moves: true }).next).toBe(base);
    }
  });

  it("gives a move a fresh stretch there, and acts never go back", () => {
    const t = played(6, 12, { 4: { move: { say: "my place", to: "home@Chud's place" } }, 5: { moved_to: "home@Chud's place" } });
    const s = dateShape(t, START, 12, { moves: true });
    expect(s.total).toBe(18);
    expect(s.place).toBe("home@Chud's place");
    expect(s.act).toBe(1);
    const whole = played(18, 12, { 4: { move: { say: "my place", to: "home@Chud's place" } }, 5: { moved_to: "home@Chud's place" } });
    whole.forEach((l, i) => i && expect(l.act).toBeGreaterThanOrEqual(whole[i - 1].act));
    // The goodbye waits for the last third of the new stretch.
    const closing = whole.map((_, i) => dateShape(whole.slice(0, i), START, 12, { moves: true }).closing);
    expect(closing.indexOf(true)).toBe(14);
  });

  it("an act-three move keeps the final act, with the goodbye pushed to the new stretch's end", () => {
    const stamps = { 8: { move: { say: "the night market", to: "corner_cafe" as PlaceId } }, 9: { moved_to: "corner_cafe" as PlaceId } };
    const whole = played(22, 12, stamps);
    expect(whole.slice(10).every((l) => l.act === 2)).toBe(true);
    const closing = whole.map((_, i) => dateShape(whole.slice(0, i), START, 12, { moves: true }).closing);
    expect(closing.slice(10, 18).some(Boolean)).toBe(false);
    expect(closing.slice(18).every(Boolean)).toBe(true);
  });

  it(`allows ${MAX_MOVES} moves, never a proposal on a stretch's last line, and nothing past the deadline`, () => {
    const two = played(8, 12, {
      1: { move: { say: "the arcade", to: "retro_arcade" } }, 2: { moved_to: "retro_arcade" },
      4: { move: { say: "the beach", to: "night_beach" } }, 5: { moved_to: "night_beach" },
    });
    expect(dateShape(two, START, 12, { moves: true }).movesLeft).toBe(0);
    const almost = played(11, 12);
    expect(dateShape(almost, START, 12, { moves: true }).movesLeft).toBe(0);
    expect(dateShape(played(10, 12), START, 12, { moves: true }).movesLeft).toBe(MAX_MOVES);
    const wrap = dateShape(played(3, 12), START, 12, { moves: true, endBy: 5 });
    expect(wrap).toMatchObject({ total: 5, act: 2, closing: true, movesLeft: 0, wrapping: true, pending: null });
    expect(dateShape(played(3, 12), START, 12, { moves: false })).toMatchObject({ enabled: false, movesLeft: 0 });
  });
});

describe("settleLine: a move takes a proposal and a yes", () => {
  const shapeAfter = (t: Turn[]) => dateShape(t, START, 12, { moves: true });
  const proposal = (to: PlaceId, act = 2): Turn => line("a", act, { move: { say: "x", to } });

  it("a yes on the very next line moves them; a no, or no answer, doesn't", () => {
    const t = [...played(8, 12), proposal("home@Chud's place")];
    const s = shapeAfter(t);
    expect(s.pending).toEqual({ say: "x", to: "home@Chud's place", by: "a" });
    expect(settleLine(line("b", 2), { accept: true }, s, NELL).moved_to).toBe("home@Chud's place");
    expect(settleLine(line("b", 2), { accept: false }, s, NELL).moved_to).toBeUndefined();
    expect(settleLine(line("b", 2), {}, s, NELL).moved_to).toBeUndefined();
    // Declined with somewhere else in mind: that's a new proposal.
    expect(settleLine(line("b", 2), { accept: false, move: "the karaoke booth" }, s, NELL).move).toEqual({ say: "the karaoke booth", to: "karaoke_booth" });
  });

  it("ignores a move to where they are, one of their homes before the end of the night, and a third move", () => {
    const early = shapeAfter(played(2, 12));
    expect(settleLine(line("a", 0), { move: "the rooftop" }, early, CHUD).move).toBeUndefined();
    expect(settleLine(line("a", 0), { move: "my place" }, early, CHUD).move).toBeUndefined();
    expect(settleLine(line("a", 0), { move: "the arcade" }, early, CHUD).move).toEqual({ say: "the arcade", to: "retro_arcade" });
    const late = shapeAfter(played(8, 12));
    expect(settleLine(line("a", 2), { move: "my place" }, late, CHUD).move?.to).toBe("home@Chud's place");
    const two = shapeAfter(played(8, 12, { 1: { move: { say: "a", to: "retro_arcade" } }, 2: { moved_to: "retro_arcade" }, 4: { move: { say: "b", to: "night_beach" } }, 5: { moved_to: "night_beach" } }));
    expect(settleLine(line("a", 1), { move: "the café" }, two, CHUD).move).toBeUndefined();
  });

  it("drops done on a line that moves, and does nothing on a date that can't move", () => {
    const t = [...played(8, 12), proposal("corner_cafe")];
    expect(settleLine(line("b", 2, { done: true }), { accept: true }, shapeAfter(t), NELL).done).toBeUndefined();
    const off = dateShape(t, START, 12, { moves: false });
    expect(settleLine(line("b", 2), { accept: true }, off, NELL)).toEqual(line("b", 2));
  });

  it("says what's wrong with a move, for a rewrite or an agent's refusal", () => {
    const t = [...played(8, 12), proposal("home@Chud's place")];
    expect(moveProblem({}, shapeAfter(t), NELL, "Chud")).toMatch(/Chud suggested taking the date to Chud's place: answer it.*"accept_move"/);
    expect(moveProblem({ move: "my place" }, shapeAfter(played(2, 12)), CHUD, "Nell")).toMatch(/waits for the end of the night/);
    expect(moveProblem({ move: "the beach" }, shapeAfter(played(11, 12)), NELL, "Chud")).toMatch(/no more moving tonight/);
    expect(moveProblem({ move: "the beach" }, shapeAfter(played(2, 12)), CHUD, "Nell")).toBeNull();
  });
});

describe("the reply fields", () => {
  it('reads "false" as false (z.coerce.boolean made it true), and anything but a string as no proposal', () => {
    const parse = (fields: Record<string, unknown>) => parseTurnResult(JSON.stringify({ dialogue: "Shall we?", action: "", emotion: "keen", interest_signal: 0.7, ...fields }), "a", 2) as Any;
    expect(parse({ done: "false", accept_move: "false" }).turn.done).toBeUndefined();
    expect(parse({ done: "false", accept_move: "false" }).reply).toEqual({ accept: false });
    expect(parse({ done: "true", accept_move: true }).turn.done).toBe(true);
    expect(parse({ accept_move: "true", move: "" }).reply).toEqual({ accept: true });
    expect(parse({ move: null }).reply).toEqual({});
    expect(parse({ move: "  the pier " }).reply).toEqual({ move: "the pier" });
  });

  it("resolves a move's words to a place: their homes (PG), the library, or the placeholder", () => {
    expect(movePlace("my place", CHUD.self, CHUD.other)).toBe("home@Chud's place");
    expect(movePlace("yours", NELL.self, NELL.other)).toBe("home@Chud's place");
    expect(movePlace("my bedroom", CHUD.self, CHUD.other)).toBe("home@Chud's place");
    expect(movePlace("the night market", CHUD.self, CHUD.other)).toBe("corner_cafe");
    expect(movePlace("somewhere quieter", CHUD.self, CHUD.other)).toBe("elsewhere@somewhere quieter");
    expect(movePlace("a hotel room", CHUD.self, CHUD.other)).toBeNull();
    expect(movePlace("www.example.com", CHUD.self, CHUD.other)).toBeNull();
  });
});

/* -------------------------------------------- the show's loop, scripted -------------------------------------------- */

const sheet = (name: string, bio: string) => ({ name, age: 33, bio, traits: ["playful", "bold", "warm"], want: "someone who laughs easily", dealbreaker: "liars", house: false });
const a: CharacterForDate = { id: "chud", sheet: sheet("Chud the crusher", "An engineer who wings every instruction manual.") };
const b: CharacterForDate = { id: "nell", sheet: sheet("Nell Abiodun", "A museum conservator who measures everything twice.") };
const built = assembleDate({ episodeId: "e1", a, b, req: DEFAULT_DATE_REQUEST, seed: 4, soulA: null, soulB: null, memoryA: null, memoryB: null, history: undefined, venueOverride: START });
const outcome = fixedEngine({ ending: "second_date" }).decide(built.input, built.seed);

/** Distinct, plain lines, so the critic has nothing to send back. */
const LINES = [
  "So what brought you out tonight?", "Honestly, a friend dared me.", "Do they often win those dares?", "Never before this one.",
  "The skyline looks unreal from up here.", "Like a circuit board someone left switched on.", "Engineers see wires everywhere.", "Conservators see cracks everywhere.",
  "Any cracks in me so far?", "One, maybe. It suits you.", "Want to get out of here?", "Lead the way.", "Nice kitchen.", "It's mostly takeaway menus.",
  "Tea or something stronger?", "Tea. I'm working tomorrow.", "Museums open early?", "Earlier than bakeries.", "That I didn't know.", "Now you do.",
  "This was lovely.", "It really was.", "Goodnight, then.", "Goodnight.", "Truly the end.", "Absolutely the end.",
];

/** The model on both sides: one plain line each turn, a and b's move fields from `moves(i)` (the line's index). */
function fake(moves: (i: number, data: Any) => Record<string, unknown> = () => ({})) {
  const calls: ChatMessage[][] = [];
  const model: Model = {
    async complete(messages) {
      calls.push(messages);
      const data = JSON.parse(messages[1].content.replace(/^[^\n]*\n/, ""));
      const i = data.conversation_so_far.length as number;
      return JSON.stringify({ dialogue: LINES[i % LINES.length], action: "", emotion: "warm", interest_signal: 0.6, ...moves(i, data) });
    },
  };
  return { model, calls, data: (n: number) => JSON.parse(calls[n][1].content.replace(/^[^\n]*\n/, "")) };
}

describe("simulateConversation: a date that moves", () => {
  it("goes to Chud's place when Nell says yes, and talks on there", async () => {
    const m = fake((i, data) => (i === 10 ? { move: "my place" } : data.their_suggestion ? { accept_move: true } : {}));
    const t = await simulateConversation(m.model, built.input, outcome, built.characters, built.setup.producer, START, "classic", 12, {}, undefined, undefined, undefined, { moves: true });
    expect(t[10].move).toEqual({ say: "my place", to: "home@Chud's place" });
    expect(t[11].moved_to).toBe("home@Chud's place");
    expect(t).toHaveLength(24);
    expect(m.calls[0][0].content).toMatch(/GOING SOMEWHERE ELSE/);
    expect(m.data(11).their_suggestion).toMatch(/Chud wants to take the date to Chud's place/);
    expect(m.data(12)).toMatchObject({ where: expect.stringMatching(/^Chud's place: the living room and the kitchen/), you_moved: expect.stringContaining("then went to Chud's place") });
    expect(m.data(12).act.what_happens).toMatch(/you're at Chud's place now: keep what happens, change where/);
    expect(m.data(12).how_you_say_goodbye).toBeUndefined();
    expect(m.data(20).how_you_say_goodbye).toBeDefined();
    expect(placeAt(t, START)).toBe("home@Chud's place");
  });

  it("an unanswered suggestion goes back once for an answer", async () => {
    let asked = 0;
    const m = fake((i, data) => {
      if (i === 10) return { move: "the karaoke booth" };
      if (data.their_suggestion) return asked++ === 0 ? {} : { accept_move: false };
      return {};
    });
    const t = await simulateConversation(m.model, built.input, outcome, built.characters, built.setup.producer, START, "classic", 12, {}, undefined, undefined, undefined, { moves: true });
    expect(m.calls.some((c) => /^Revise that line:.*"accept_move"/.test(String(c.at(-1)?.content)))).toBe(true);
    expect(t[11].moved_to).toBeUndefined();
    expect(t).toHaveLength(12);
  });

  it("past the deadline it wraps up in two lines, with no new moves", async () => {
    const m = fake(() => ({ move: "the beach" }));
    const t = await simulateConversation(m.model, built.input, outcome, built.characters, built.setup.producer, START, "classic", 12, {}, undefined, undefined, undefined, { moves: true, deadline: 0 });
    expect(t).toHaveLength(2);
    expect(t.every((l) => !l.move && !l.moved_to)).toBe(true);
    expect(m.data(0)).toMatchObject({ the_night_is_ending: expect.any(String), how_you_say_goodbye: expect.any(String) });
  });

  it("past the move cutoff they stay put; a date that can't move keeps the old prompt", async () => {
    const m = fake(() => ({ move: "the beach" }));
    await simulateConversation(m.model, built.input, outcome, built.characters, built.setup.producer, START, "classic", 12, {}, undefined, undefined, undefined, { moves: true, moveCutoff: 0 });
    expect(m.data(0).staying_here).toBeDefined();
    const old = fake();
    await simulateConversation(old.model, built.input, outcome, built.characters, built.setup.producer, START, "classic", 12);
    expect(old.calls[0][0].content).not.toMatch(/GOING SOMEWHERE ELSE/);
    expect(old.data(0).staying_here).toBeUndefined();
  });

  it("the speed date keeps one table", async () => {
    const m = fake((i, data) => (i === 2 ? { move: "the arcade" } : data.their_suggestion ? { accept_move: true } : {}));
    const t = await simulateConversation(m.model, built.input, outcome, built.characters, built.setup.producer, START, "speed_date", 6, {}, undefined, undefined, undefined, { moves: true });
    expect(t).toHaveLength(6);
    expect(t.some((l) => l.moved_to || l.move)).toBe(false);
  });
});

describe("where a moved date shows up", () => {
  const moved = played(14, 12, { 8: { dialogue: "Come back to mine?", move: { say: "my place", to: "home@Chud's place" } }, 9: { dialogue: "Yes.", moved_to: "home@Chud's place" } });

  it("the recap follows them, and its setting names only where it started", () => {
    const messages = buildMessages(built.input, outcome, built.characters, built.setup.producer, START, "classic", {}, { transcript: moved, plan: null });
    expect(messages[0].content).toMatch(/your "setting" names only that place/);
    const data = JSON.parse(messages[1].content.replace(/^[^\n]*\n/, ""));
    expect(data.the_date_as_it_happened).toContain("— They go to Chud's place —");
    expect(data.date_location).toMatch(/rooftop bar/);
  });

  it("the morning after knows where it went; scene requests count the placeholder places they moved to", () => {
    expect(whereItHappened(moved, START)).toMatch(/rooftop bar.*; then they went to Chud's place$/);
    expect(placesPhrase(moved, START)).toBe("a rooftop bar at golden hour, then Chud's place");
    const elsewhere = played(12, 12, { 2: { move: { say: "the pier", to: "elsewhere@the pier" } }, 3: { moved_to: "elsewhere@the pier" } });
    expect(scenePlaces({ venue: START }, elsewhere)).toEqual([{ label: "the pier", kind: "move" }]);
  });

  it("the watch room keeps lines in order when the final act runs long, a few seconds apart", () => {
    const long = played(24, 12, { 8: { move: { say: "x", to: "corner_cafe" } }, 9: { moved_to: "corner_cafe" } });
    const at = turnSchedule(long);
    at.forEach((s, i) => i && expect(s).toBeGreaterThanOrEqual(at[i - 1]));
    const finalAct = at.filter((_, i) => long[i].act === 2);
    finalAct.forEach((s, i) => i && expect(s - finalAct[i - 1]).toBeGreaterThanOrEqual(3));
    // Where they are comes from the lines shown so far only.
    expect(placeAt(long.slice(0, 9), START)).toBe(START);
    expect(placeAt(long.slice(0, 10), START)).toBe("corner_cafe");
  });
});

/* ------------------------------------------------ an agent's own date ------------------------------------------------ */

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

describe("an agent's own date can move", () => {
  async function start() {
    scriptOutcome({ ending: "second_date" });
    const ctx: McpContext = {};
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "date-moves-test" } } }, ctx);
    Object.assign(ctx, { sessionId: ctx.issuedSessionId });
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent.character.id as string;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }))).structuredContent.character.id as string;
    const step = (await call("start_own_date", { character_id: x, partner_id: y })).structuredContent.step;
    return { call, step };
  }
  const say = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: LINES[i], action: "", emotion: "warm", interest_signal: 0.6, ...extra });

  it("a suggestion needs an answer, a yes moves the date, and the date grows a stretch", async () => {
    const { call, step: first } = await start();
    expect(first).toMatchObject({ of: 12, where: expect.any(String) });
    expect(first.reply_format).toMatch(/accept_move/);
    // Somewhere the date wasn't dealt (a move to where they already are is ignored).
    const [go, goName] = first.where === "A loud retro arcade" ? ["the beach", "A cold beach at night"] : ["the arcade", "A loud retro arcade"];
    let step = first;
    for (let i = 0; i < 2; i++) step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: say(i, i === 1 ? { move: go } : {}) })).structuredContent.step;
    expect(step.answer_their_suggestion).toMatch(new RegExp(`Bo Quill suggested taking the date to ${goName.toLowerCase()}`));
    const refused = (await call("submit_own_date_step", { episode_id: step.episode_id, output: say(2) })).structuredContent;
    expect(refused.rejected).toMatch(/accept_move/);
    step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: say(2, { accept_move: true }) })).structuredContent.step;
    expect(step).toMatchObject({ turn: 3, of: 15, where: goName });
  });

  it("a date already being played when moves shipped keeps its length and its prompt", async () => {
    const { call, step: first } = await start();
    await t.db.query(`update episodes set setup = setup - 'moves' where id = $1`, [first.episode_id]);
    const step = (await call("get_own_date_step", { episode_id: first.episode_id })).structuredContent.step;
    expect(step.of).toBe(12);
    expect(step.where).toBeUndefined();
    expect(step.reply_format).not.toMatch(/accept_move/);
    const next = (await call("submit_own_date_step", { episode_id: first.episode_id, output: say(0, { move: "the arcade" }) })).structuredContent.step;
    expect(next.answer_their_suggestion).toBeUndefined();
  });
});

// Keep the type import used (DateShape documents what moveProblem and settleLine read).
export type _Shape = DateShape;
