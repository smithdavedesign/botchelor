/**
 * Living dates (David 2026-11-01, docs/date-quality.md "Round: living dates"): hot takes, feelings that carry, notes on
 * what the other claimed, thoughts kept for after airing, each side's own "see them again?" deciding the ending within a
 * step of the engine's (v5), and a cast member's own secrets guarded or let slip. No paid calls: scripted models only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetTouchesForTests } from "@/lib/activity";
import { castSecrets, ensureCastSecrets, recordSlips, secretsForDate, slipped } from "@/lib/cast-secrets";
import { assembleCharacter, type Character } from "@/lib/character";
import { applyChoices, askChoices, CHOICE_NEAR, choiceEnding, choiceLine, parseChoice, readChoice, setChoicesAskedForTests } from "@/lib/choices";
import { buildTurnMessages, simulateConversation, type Turn } from "@/lib/conversation";
import { buildDirectorMessages, dateFacts } from "@/lib/beats";
import { CURRENT_ENGINE_VERSION, deterministicEngine, fixedEngine, marks, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { collidingTakes, ensureHotTakes, fallbackHotTakes, hotTakesOf, setHotTakesDerivingForTests, type StoredHotTakes } from "@/lib/hot-takes";
import { claimsSoFar, feelingName, feelingSoFar, innerForViewer, innerOf, outerLine, readInner, trustStance, type LineInner, type SeeAgain } from "@/lib/inner-life";
import type { ChatMessage, Model } from "@/lib/model";
import { generateDate } from "@/lib/pipeline";
import { CONVERSATION_TURNS, ENDINGS, type Ending } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonIdOf } from "@/lib/season-window";
import type { StoredSoul } from "@/lib/souls";
import { pickVenue } from "@/lib/venues";
import { mixOf, sampleDates } from "./engine-sample";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, planJson, setupEpisode, startTestDb, validCharacter } from "./helpers";

const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const side = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: side(sheetA), b: side(sheetB) };
const soul = (): StoredSoul => ({ values: "honesty", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const sideOutcome = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = fixedEngine({ ending: "friends", sides: [sideOutcome(true), sideOutcome(false)] }).decide(INPUT, 1);
const VENUE = pickVenue(1);

const TAKE_A = "Brunch is just a late breakfast with a markup.";
const TAKE_B = "Brunch is the best meal of the week, fight me.";
const SECRET_A = "Can't whistle, and has faked it for years";
const SECRET_B = "Has never actually seen the sea";

function chars(): [Character, Character] {
  const a = assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: soul(), memory: null });
  const b = assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(), memory: null });
  a.hotTakes = [TAKE_A];
  b.hotTakes = [TAKE_B];
  a.secrets = [{ season_id: "2026-11", idx: 0, secret: SECRET_A }];
  b.secrets = [{ season_id: "2026-11", idx: 1, secret: SECRET_B }];
  return [a, b];
}

const userText = (messages: ChatMessage[]) => messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
const line = (dialogue: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ dialogue, action: "asks", emotion: "curious", interest_signal: 0.6, feeling: "curious", feeling_strength: 0.5, thought: "Let's see where this goes.", they_claimed: "", let_slip: 0, ...extra });
function scripted(outputs: string[]): Model & { seen: ChatMessage[][] } {
  const queue = [...outputs];
  const seen: ChatMessage[][] = [];
  return { seen, async complete(messages) { seen.push(messages); const next = queue.shift(); if (next === undefined) throw new Error("out of outputs"); return next; } };
}
const turn = (s: "a" | "b", inner?: LineInner, interest = 0.5): Turn & { inner?: LineInner } => ({ side: s, act: 1, dialogue: "Well.", action: "", emotion: "warm", interest, ...(inner ? { inner } : {}) });

describe("engine v5: the same numbers as v4, the answers decide within a step", () => {
  it("new dates are v5, and v5 decides exactly what v4 does", () => {
    expect(CURRENT_ENGINE_VERSION).toBe(5);
    for (const { input, seed } of sampleDates(1500, 1101)) {
      expect(deterministicEngine.decide(input, seed, 5)).toEqual(deterministicEngine.decide(input, seed, 4));
    }
  });

  it("the answer table: up needs both yes, down needs a no, one step at most", () => {
    // No score (a test's forced outcome): the table alone.
    expect(choiceEnding("friends", "yes", "yes")).toBe("second_date");
    expect(choiceEnding("disaster", "yes", "yes")).toBe("friends");
    expect(choiceEnding("disaster", "yes", "maybe")).toBe("disaster");
    expect(choiceEnding("disaster", "maybe", "maybe")).toBe("disaster");
    expect(choiceEnding("friends", "no", "no")).toBe("disaster");
    expect(choiceEnding("friends", "maybe", "no")).toBe("disaster");
    expect(choiceEnding("friends", "yes", "no")).toBe("friends"); // one-sided: not a better or worse ending
    expect(choiceEnding("friends", "yes", "maybe")).toBe("friends");
    expect(choiceEnding("second_date", "no", "no")).toBe("friends");
    expect(choiceEnding("second_date", "yes", "no")).toBe("friends");
    expect(choiceEnding("second_date", "maybe", "maybe")).toBe("friends");
    expect(choiceEnding("second_date", "yes", "maybe")).toBe("second_date");
    for (const e of ENDINGS) for (const a of ["yes", "maybe", "no"] as const) for (const b of ["yes", "maybe", "no"] as const) {
      expect(Math.abs(ENDINGS.indexOf(choiceEnding(e, a, b)) - ENDINGS.indexOf(e))).toBeLessThanOrEqual(1);
    }
  });

  it("the answers settle a close call, never a clear one (within CHOICE_NEAR of the mark)", () => {
    const { friendsAt, secondDateAt } = marks(5);
    expect(choiceEnding("friends", "yes", "yes", secondDateAt - 1)).toBe("second_date");
    expect(choiceEnding("friends", "yes", "yes", secondDateAt - CHOICE_NEAR - 1)).toBe("friends");
    expect(choiceEnding("disaster", "yes", "yes", friendsAt - 2)).toBe("friends");
    expect(choiceEnding("disaster", "yes", "yes", friendsAt - CHOICE_NEAR - 5)).toBe("disaster");
    expect(choiceEnding("second_date", "no", "no", secondDateAt + 1)).toBe("friends");
    expect(choiceEnding("second_date", "no", "no", secondDateAt + CHOICE_NEAR + 2)).toBe("second_date");
    expect(choiceEnding("friends", "no", "no", friendsAt + 1)).toBe("disaster");
    expect(choiceEnding("friends", "no", "no", friendsAt + CHOICE_NEAR + 1)).toBe("friends");
  });

  it("keeps the engine's mix at defaults within a few points, with the answers the eval got (2026-11-01)", () => {
    const sample = sampleDates(3000, 1102);
    const decide = (input: DateInput, seed: number) => deterministicEngine.decide(input, seed, 5);
    const engine = mixOf(sample, (i, s) => decide(i, s).ending);
    // Answers that agree with the engine change nothing.
    const agree: Record<Ending, [SeeAgain, SeeAgain]> = { second_date: ["yes", "yes"], friends: ["yes", "maybe"], disaster: ["no", "no"] };
    expect(mixOf(sample, (i, s) => { const o = decide(i, s); return choiceEnding(o.ending, ...agree[o.ending], o.margin); })).toEqual(engine);
    // The answers the measured run got (scratchpad living-eval rechoose-after-v2), per engine ending, dealt in turn.
    const seen: Record<Ending, [SeeAgain, SeeAgain][]> = {
      second_date: [["yes", "yes"], ["yes", "maybe"], ["yes", "yes"]],
      friends: [["yes", "maybe"], ["yes", "maybe"], ["maybe", "yes"], ["yes", "maybe"], ["maybe", "maybe"]],
      disaster: [["yes", "no"], ["yes", "maybe"], ["no", "maybe"], ["no", "maybe"], ["yes", "yes"], ["maybe", "yes"], ["maybe", "maybe"], ["no", "maybe"], ["no", "yes"], ["yes", "maybe"], ["yes", "maybe"], ["maybe", "maybe"]],
    };
    let k = 0;
    const answered = mixOf(sample, (i, s) => { const o = decide(i, s); const l = seen[o.ending]; return choiceEnding(o.ending, ...l[k++ % l.length], o.margin); });
    for (const e of ENDINGS) expect(Math.abs(answered[e] - engine[e])).toBeLessThan(0.05);
    // Even if every answer were yes, the guardrail holds second dates under two thirds.
    expect(mixOf(sample, (i, s) => { const o = decide(i, s); return choiceEnding(o.ending, "yes", "yes", o.margin); }).second_date).toBeLessThan(0.67);
  });

  it("applyChoices: wants follow the answers, and a second date isn't anyone's rejection", () => {
    const rejected: Outcome = { ...OUTCOME, drama_question: "rejected", drama_answer: "a" };
    const up = applyChoices(rejected, { a: { see_again: "yes", reason: "x" }, b: { see_again: "yes", reason: "y" } });
    expect(up.ending).toBe("second_date");
    expect(up.sides.map((s) => s.wants_another)).toEqual([true, true]);
    expect(up).toMatchObject({ drama_question: "leaves_first", drama_answer: "neither" });
    const down = applyChoices(OUTCOME, { a: { see_again: "no", reason: "x" }, b: { see_again: "maybe", reason: "y" } });
    expect(down.ending).toBe("disaster");
    expect(down.sides.map((s) => s.wants_another)).toEqual([false, false]);
    expect(choiceLine({ a: "yes", b: "yes" }, "friends", "second_date", ["Mira Vale", "Rafe Holt"])).toMatch(/Mira said yes and Rafe said yes.*better/);
    expect(choiceLine({ a: "maybe", b: "maybe" }, "friends", "friends", ["Mira", "Rafe"])).toBeNull();
  });

  it("parses an answer, and reads one from the date when the model gives none", () => {
    expect(parseChoice('{"see_again":"Maybe","reason":"Fun, but no spark."}')).toEqual({ see_again: "maybe", reason: "Fun, but no spark." });
    expect(parseChoice("```json\n{\"see_again\":\"yes\",\"reason\":\"I laughed all night.\"}\n```")?.see_again).toBe("yes");
    expect(parseChoice('{"see_again":"definitely","reason":"x"}')).toBeNull();
    expect(parseChoice("no json")).toBeNull();
    expect(readChoice([turn("a", { feeling: "smitten" }, 0.9)], "a")).toMatchObject({ see_again: "yes", read: true });
    expect(readChoice([turn("a", { feeling: "irritated" }, 0.2)], "a").see_again).toBe("no");
    expect(readChoice([turn("a", { feeling: "unsure" }, 0.5)], "a").see_again).toBe("maybe");
  });

  it("asks each side privately, on its own model, with only its own inner life", async () => {
    setChoicesAskedForTests(true);
    try {
      const transcript = [turn("a", { feeling: "charmed", thought: "MIRA-THOUGHT" }), turn("b", { feeling: "wary", thought: "RAFE-THOUGHT" })];
      const a = scripted(['{"see_again":"yes","reason":"She made me laugh."}']);
      const b = scripted(['{"see_again":"no","reason":"Too many questions."}']);
      const got = await askChoices(scripted([]), chars(), transcript, (s) => (s === "a" ? a : b));
      expect(got).toEqual({ a: { see_again: "yes", reason: "She made me laugh." }, b: { see_again: "no", reason: "Too many questions." } });
      expect(userText(a.seen[0])).toContain("MIRA-THOUGHT");
      expect(userText(a.seen[0])).not.toContain("RAFE-THOUGHT");
      expect(userText(b.seen[0])).toContain("RAFE-THOUGHT");
      expect(userText(b.seen[0])).not.toContain("MIRA-THOUGHT");
      expect(userText(a.seen[0])).not.toContain(SECRET_B);
    } finally {
      setChoicesAskedForTests(false);
    }
  });
});

describe("inner life: feelings that carry, claims noted, kept private", () => {
  it("reads a line's private fields, cleaned", () => {
    expect(feelingName("Intrigued!")).toBe("curious");
    expect(feelingName("flabbergasted")).toBe("unsure");
    expect(feelingName("")).toBeNull();
    expect(readInner({ feeling: "annoyed", feeling_strength: 3, thought: "  He's lying about the boat.  ", they_claimed: "none", let_slip: 2 })).toEqual({ feeling: "irritated", strength: 1, thought: "He's lying about the boat.", slip: 2 });
    expect(readInner({ thought: "x".repeat(400) }).thought!.length).toBeLessThanOrEqual(140);
    expect(readInner({ let_slip: 0, they_claimed: "Says they ran a marathon" })).toEqual({ claim: "Says they ran a marathon" });
  });

  it("each side's feeling and notes are its own", () => {
    const lines = [turn("a", { feeling: "curious" }), turn("b", { feeling: "wary", claim: "B-NOTE" }), turn("a", { feeling: "charmed", strength: 0.9, claim: "A-NOTE" }), turn("b", { feeling: "wary" })];
    expect(feelingSoFar(lines, "a")).toEqual({ right_now: "charmed (strongly)", how_it_moved: "curious → charmed" });
    expect(feelingSoFar(lines, "b")).toEqual({ right_now: "wary" });
    expect(claimsSoFar(lines, "a")).toEqual(["A-NOTE"]);
    expect(claimsSoFar(lines, "b")).toEqual(["B-NOTE"]);
    expect(trustStance({ guardedness: 0.8, warmth: 0.5 })).toMatch(/slow to trust/);
    expect(trustStance({ guardedness: 0.1, warmth: 0.5 })).toMatch(/at their word/);
  });

  it("a turn's prompt carries its own hot takes, secrets, feeling and notes, never the other's; the director gets no secrets", () => {
    const c = chars();
    const transcript: Turn[] = [
      { ...turn("a", { feeling: "smitten", thought: "MIRA-THOUGHT", claim: "MIRA-NOTE" }), dialogue: "I map coastlines." },
      { ...turn("b", { feeling: "wary", thought: "RAFE-THOUGHT", claim: "RAFE-NOTE" }), dialogue: "I bake at dawn." },
    ];
    const forA = userText(buildTurnMessages(INPUT, OUTCOME, c, "a_hard_question", VENUE, transcript, 2).messages);
    expect(forA).toContain(TAKE_A);
    expect(forA).toContain(SECRET_A);
    expect(forA).toContain("smitten");
    expect(forA).toContain("MIRA-NOTE");
    for (const leak of [TAKE_B, SECRET_B, "RAFE-THOUGHT", "RAFE-NOTE", "MIRA-THOUGHT"]) expect(forA).not.toContain(leak);
    const forB = userText(buildTurnMessages(INPUT, OUTCOME, c, "a_hard_question", VENUE, transcript, 3).messages);
    expect(forB).toContain(SECRET_B);
    for (const leak of [TAKE_A, SECRET_A, "MIRA-THOUGHT", "MIRA-NOTE", "smitten"]) expect(forB).not.toContain(leak);
    const director = JSON.stringify(buildDirectorMessages(INPUT, OUTCOME, c, "a_hard_question", VENUE, "classic", {}));
    expect(director).not.toContain(SECRET_A);
    expect(director).not.toContain(SECRET_B);
    expect(director).toContain(TAKE_A); // the director plans the friction from both sides' takes
  });

  it("two colliding hot takes become friction for the director", () => {
    expect(collidingTakes([TAKE_A], [TAKE_B])).toEqual([TAKE_A, TAKE_B]);
    expect(collidingTakes(["Rain is the best weather."], [TAKE_B])).toBeNull();
    expect(dateFacts(INPUT, OUTCOME, chars()).join("\n")).toMatch(/opinions collide/);
  });

  it("a conversation keeps each line's inner life on the line, and a slip only when the line gives the secret away", async () => {
    const model = scripted([
      line("Hi. I'm Mira. I brought a compass, just in case."),
      line("Rafe. I brought bread, which is more useful.", { let_slip: 1 }), // claims a slip, says nothing of the sea
      line("Fine, confession: I can't whistle. I've faked it for years.", { let_slip: 1, feeling: "amused" }),
      ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => line(`Line ${i}: something friendly to say about the room.`)),
    ]);
    const t = await simulateConversation(model, INPUT, OUTCOME, chars(), "a_hard_question", VENUE);
    expect(t[0].inner).toMatchObject({ feeling: "curious", thought: "Let's see where this goes." });
    expect(t[1].inner?.secret).toBeUndefined();
    expect(t[2].inner?.secret).toEqual({ season_id: "2026-11", idx: 0 });
    expect(t.filter((x) => x.inner?.secret)).toHaveLength(1);
    const stored = t.map(outerLine);
    expect(stored.some((x) => "inner" in x)).toBe(false);
    expect(innerOf(t)?.lines[2]?.feeling).toBe("amused");
    expect(slipped("I've never seen the sea, not once.", SECRET_B)).toBe(true);
    expect(slipped("The sea air is nice tonight.", SECRET_B)).toBe(false);
  });
});

describe("a show date under v5: inner life kept apart, the answers asked", () => {
  afterEach(() => setChoicesAskedForTests(false));

  it("strips inner life from what's stored and played, and the two yeses lift a friends date", async () => {
    setChoicesAskedForTests(true);
    const built = buildEvalDate(EVAL_CASES.find((x) => x.id === "mira-dex")!);
    const decided = fixedEngine({ ending: "friends" }, { wishes: true }).decide(built.input, built.seed);
    const director = scripted([planJson(), episodeJson()]);
    const lines = Array.from({ length: CONVERSATION_TURNS }, (_, i) => line(`Line ${i}: I'd like to see the sea with you, honestly.`, { thought: `THOUGHT-${i}` }));
    const actor: Model = {
      async complete(messages) {
        if (messages[0].content.includes("Would you see them again?")) return '{"see_again":"yes","reason":"I want more of this."}';
        const next = lines.shift();
        if (!next) throw new Error("out of lines");
        return next;
      },
    };
    const played: Turn[][] = [];
    const gen = await generateDate({ actor, director }, built, decided, {
      formatId: "classic", formatCtx: {}, conversation: true, afterglow: false, reflection: false, wishes: true, engineVersion: 5,
      onTurn: (t) => void played.push(t),
    });
    expect(gen.transcript.length).toBe(CONVERSATION_TURNS);
    expect(JSON.stringify(gen.transcript)).not.toContain("THOUGHT-");
    expect(JSON.stringify(played)).not.toContain("THOUGHT-");
    expect(gen.inner?.lines[0]?.thought).toBe("THOUGHT-0");
    expect(gen.inner?.choices).toEqual({ a: { see_again: "yes", reason: "I want more of this." }, b: { see_again: "yes", reason: "I want more of this." } });
    expect(gen.outcome.ending).toBe("second_date");
    expect(gen.wishes).toMatchObject({ a: true, b: true, engine: "friends", choices: { a: "yes", b: "yes" } });
    expect(gen.slips).toEqual([]);
  });
});

describe("after airing only", () => {
  it("innerForViewer shows nothing before the date airs, and only the sides it may", () => {
    const inner = { v: 1 as const, lines: [{ thought: "A-T" }, { thought: "B-T" }], choices: { a: { see_again: "yes" as const, reason: "A-R" }, b: { see_again: "no" as const, reason: "B-R" } } };
    const tr = [{ side: "a" as const }, { side: "b" as const }];
    expect(innerForViewer(inner, false, [true, true], tr)).toBeNull();
    expect(innerForViewer(inner, true, [false, true], tr)).toEqual({
      thoughts: [null, "B-T"],
      choices: [{ side: "a", see_again: "yes", reason: null }, { side: "b", see_again: "no", reason: "B-R" }],
    });
  });
});

describe("with a database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    forgetTouchesForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setHotTakesDerivingForTests(false);
    setSeasonCastForTests(null);
  });

  it("derives a character's hot takes once, keeps its creator's, and falls back the same way every time", async () => {
    setHotTakesDerivingForTests(true);
    const cookie = newUserCookie();
    const one = await (await api.createCharacter(validCharacter({ name: "Ada Lumen" }), cookie)).json();
    const two = await (await api.createCharacter(validCharacter({ name: "Bo Quill" }), cookie)).json();
    await t.db.query(`update characters set extras = coalesce(extras, '{}'::jsonb) || '{"hot_takes":["Rain is the best weather."]}'::jsonb where id = $1`, [two.id]);
    let calls = 0;
    const model: Model = { complete: async () => (calls++, '{"hot_takes":["Socks with sandals are fine.","Toast is better cold.","Maps beat apps."]}') };
    await ensureHotTakes(t.db, [one.id, two.id], model);
    await ensureHotTakes(t.db, [one.id, two.id], model);
    expect(calls).toBe(1);
    const rows = (await t.db.query<{ id: string; hot_takes: StoredHotTakes | null; extras: { hot_takes?: string[] } | null }>(`select id, hot_takes, extras from characters where id = any($1)`, [[one.id, two.id]])).rows;
    const r1 = rows.find((r) => r.id === one.id)!;
    const r2 = rows.find((r) => r.id === two.id)!;
    expect(r1.hot_takes).toMatchObject({ source: "model", takes: ["Socks with sandals are fine.", "Toast is better cold.", "Maps beat apps."] });
    expect(r2.hot_takes).toBeNull();
    expect(hotTakesOf(r2.extras, r2.hot_takes)).toEqual(["Rain is the best weather."]);
    // No model: the fallback, from its own traits, the same every time.
    const c = { id: "x-1", bio: "a grumpy baker", persona: { traits: ["blunt"], want: "" } };
    expect(fallbackHotTakes(c)).toEqual(fallbackHotTakes(c));
    expect(fallbackHotTakes(c)).toHaveLength(3);
  });

  it("a cast member's secret let slip on an aired public date counts as out, once", async () => {
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    const { episode } = await setupEpisode("friends");
    // Only stored secrets can slip (a slip is recorded against a row): none before they're written.
    expect(await secretsForDate(t.db, HOUSE_PARTNER_ID)).toEqual([]);
    await ensureCastSecrets(t.db, new Date(), { complete: async () => "no json" });
    const hidden = await secretsForDate(t.db, HOUSE_PARTNER_ID);
    expect(hidden).toHaveLength(3);
    const one = hidden[1];
    await recordSlips(t.db, episode.id, [{ character_id: HOUSE_PARTNER_ID, season_id: one.season_id, idx: one.idx, line: 3 }]);
    // Not out until the date airs, in public.
    expect((await castSecrets(t.db, HOUSE_PARTNER_ID))!.out).toHaveLength(0);
    expect((await secretsForDate(t.db, HOUSE_PARTNER_ID)).map((s) => s.idx)).not.toContain(one.idx);
    await t.db.query(`update episodes set revealed_at = now() - interval '1 minute', visibility = 'public' where id = $1`, [episode.id]);
    const out = (await castSecrets(t.db, HOUSE_PARTNER_ID))!.out;
    expect(out.map((o) => o.secret)).toEqual([one.secret]);
    // A second slip of the same one keeps the first date.
    await recordSlips(t.db, "another-episode", [{ character_id: HOUSE_PARTNER_ID, season_id: one.season_id, idx: one.idx, line: 1 }]);
    expect((await t.db.query(`select revealed_episode from cast_secrets where character_id = $1 and idx = $2 and season_id = $3`, [HOUSE_PARTNER_ID, one.idx, seasonIdOf(new Date())])).rows[0].revealed_episode).toBe(episode.id);
  });

  it("the episode page shows thoughts and answers only once it airs, per side", async () => {
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    const { creator, episode } = await setupEpisode("friends");
    const transcript = [turn("a"), turn("b")].map(outerLine);
    const inner = { v: 1, lines: [{ thought: "OWNER-SIDE" }, { thought: "HOUSE-SIDE" }], choices: { a: { see_again: "maybe", reason: "A-REASON" }, b: { see_again: "yes", reason: "B-REASON" } } };
    await t.db.query(`update episodes set transcript = $2::jsonb, inner_life = $3::jsonb where id = $1`, [episode.id, JSON.stringify(transcript), JSON.stringify(inner)]);
    const view = async (cookie?: string) => (await (await api.getEpisode(episode.id, cookie)).json()).inner;
    expect(await view()).toBeUndefined();
    expect(await view(creator)).toBeUndefined(); // not even its creator before it airs
    await t.db.query(`update episodes set revealed_at = now() - interval '1 minute', visibility = 'public' where id = $1`, [episode.id]);
    const anyone = await view();
    expect(anyone.thoughts).toEqual([null, "HOUSE-SIDE"]);
    expect(anyone.choices.map((c: { reason: string | null }) => c.reason)).toEqual([null, "B-REASON"]);
    const owner = await view(creator);
    expect(owner.thoughts).toEqual(["OWNER-SIDE", "HOUSE-SIDE"]);
  });
});
