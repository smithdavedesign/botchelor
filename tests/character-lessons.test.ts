// Learning, weekly (lib/character-lessons.ts, lib/character-lessons-job.ts; the drama wave's part 6): who qualifies, that
// the writer only ever sees the character's own side, the caps and the PG checks, the free-then-paid-then-template
// order with its cost, where the lessons go (the date prompt, the owner's companion prompt, the memory page's forget,
// the Sunday recap, one text a week) and where they never go (the other side's prompt, the engine), and the switch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteForget, POST as postForget } from "@/app/api/characters/[id]/memory/forget/route";
import { registerAccount } from "@/lib/auth";
import { assembleCharacter, LESSON_USE_NOTE, type Character } from "@/lib/character";
import { characterWeekNotice, weekOf, weekSentence } from "@/lib/character-life";
import {
  characterLessonsOn,
  checkLesson,
  checkLessons,
  ensureCharacterLessons,
  isVirtueList,
  LESSON_LINE_MAX,
  LESSONS_MAX,
  lessonCandidates,
  lessonCost,
  lessonFacts,
  lessonMessages,
  lessonsForPrompt,
  lessonWeek,
  loadLessons,
  outOfCharacterFlags,
  parseLessons,
  setCharacterLessonsForTests,
  templateLessons,
  type LessonFacts,
} from "@/lib/character-lessons";
import { lessonText, lessonTextLines, runCharacterLessons } from "@/lib/character-lessons-job";
import { companionMessages } from "@/lib/companion-prompt";
import { buildTurnMessages } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLineVote } from "@/lib/line-feedback";
import { describeForgets } from "@/lib/memory";
import { ModelError, type ChatMessage, type Model, type Usage } from "@/lib/model";
import { assembleDate, type DateRequest } from "@/lib/simulation";
import { pickVenue } from "@/lib/venues";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from admins");
  setCharacterLessonsForTests(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setCharacterLessonsForTests(false);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const NOW = new Date("2026-11-18T16:20:00Z"); // a Wednesday
const HOUSE = HOUSE_CHARACTERS[0].id;
const HOUSE_2 = HOUSE_CHARACTERS[1].id;
const daysAgo = (n: number, from = NOW) => new Date(from.getTime() - n * 86_400_000).toISOString();

let n = 0;
async function character(owner: string, name = `Juno Vale ${++n}`, o: { house?: boolean } = {}): Promise<string> {
  const id = `les-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, voice, visibility)
     values ($1, $2, $3, $4, 31, 'A night-shift baker who names her sourdough starters.', '["dry","stubborn","curious"]'::jsonb, 'Someone who asks a second question.', 'People who check their phone mid-sentence.', 'Short sentences. Deadpan. Never gushes.', 'public')`,
    [id, o.house ? null : owner, Boolean(o.house), name],
  );
  return id;
}

type EpOpts = {
  ending?: "second_date" | "friends" | "disaster";
  aired?: string | null;
  visibility?: string;
  afterDark?: boolean;
  mineIsB?: boolean;
  note?: string | null;
  followed?: boolean | null;
  creator?: string;
  lines?: { side: "a" | "b"; dialogue: string }[];
  roleplay?: boolean;
};
const LINES: { side: "a" | "b"; dialogue: string }[] = [
  { side: "a", dialogue: "You're late. I ordered for the table and the table is winning." },
  { side: "b", dialogue: "I was early. I just stood outside deciding who to be." },
  { side: "a", dialogue: "And who did you pick?" },
  { side: "b", dialogue: "The one who orders dessert first." },
];

/**
 * An aired public date between `mine` and `other`, with both sides' private material marked so a leak shows: MINE-… is
 * the character's own side, OTHER-… is the other's.
 */
async function date(mine: string, other: string, o: EpOpts = {}): Promise<string> {
  const id = `les-ep-${++n}`;
  const [a, b] = o.mineIsB ? [other, mine] : [mine, other];
  const me: "a" | "b" = o.mineIsB ? "b" : "a";
  const them: "a" | "b" = me === "a" ? "b" : "a";
  const lines = o.lines ?? LINES;
  const side = (wants: boolean, followed: boolean | null): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: followed });
  const sides = me === "a" ? [side(true, o.followed ?? null), side(false, null)] : [side(false, null), side(true, o.followed ?? null)];
  const inner = {
    v: 1,
    lines: lines.map((l, i) => ({ feeling: "curious", strength: 0.4 + i * 0.1, thought: `${l.side === me ? "MINE" : "OTHER"}-THOUGHT ${id} line ${i} about the bread.` })),
    choices: {
      [me]: { see_again: "no", reason: `MINE-REASON ${id}: I liked the argument more than the person.` },
      [them]: { see_again: "yes", reason: `OTHER-REASON ${id}: they made me laugh twice.` },
    },
  };
  const aired = o.aired === undefined ? daysAgo(2) : o.aired;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status,
                           revealed_at, created_at, setup, reflections, sides, box_score, inner_life, note)
     values ($1, $2, $3, $4, 'A bakery after hours.', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6::jsonb, $7, 'ready',
             $8::timestamptz, coalesce($8::timestamptz, now()) - interval '1 hour', $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14)`,
    [
      id,
      o.creator ?? "creator-x",
      a,
      b,
      o.ending ?? "friends",
      JSON.stringify(lines.map((l, i) => ({ ...l, act: i < 2 ? 0 : 1, action: "", emotion: "dry", interest: 0.5 }))),
      o.visibility ?? "public",
      aired,
      JSON.stringify({ venue: "rooftop_cafe", strategy: "genuine_chemistry", engine_version: 5, ...(o.afterDark ? { after_dark: true } : {}), ...(o.roleplay ? { roleplay: { id: "heist" } } : {}) }),
      JSON.stringify({ [me]: `MINE-REFLECTION ${id}: I went quiet the moment they asked about my work.`, [them]: `OTHER-REFLECTION ${id}: they never asked me anything.` }),
      JSON.stringify(sides),
      JSON.stringify({ chemistry: { start: 50, final: 58 }, attraction: { start: 50, final: 55 }, trust: { start: 50, final: 44 }, awkwardness: { start: 40, final: 52 } }),
      JSON.stringify(inner),
      me === "a" ? (o.note ?? null) : null,
    ],
  );
  return id;
}

/** A model that returns (or throws) scripted outputs and reports a usage for each call. */
function scripted(outputs: Array<string | Error>, usage: Partial<Usage> = {}): { model: Model; calls: ChatMessage[][] } {
  const queue = [...outputs];
  const calls: ChatMessage[][] = [];
  return {
    calls,
    model: {
      async complete(messages, options) {
        calls.push(messages);
        const next = queue.shift();
        if (next === undefined) throw new ModelError("out of outputs");
        if (next instanceof Error) throw next;
        options?.onUsage?.({ model: "gemini-3.5-flash-lite", input: 1300, cachedInput: 0, output: 150, thinking: 0, ...usage });
        return next;
      },
    },
  };
}
const userText = (messages: ChatMessage[]) => messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
const GOOD = JSON.stringify({
  lessons: ["I leave when people audit my stories.", "I get funnier the less I like someone, and they can tell.", "I order for the table so nobody can ask what I want."],
  trying_next: "Next time I let them pick the bread.",
});
const stored = async (id: string) =>
  (await t.db.query<{ week: string; lines: string[]; trying_next: string | null; source: string; model: string | null; cost_usd: string | null; input_tokens: number | null; episodes: { episode_id: string }[] }>(
    `select week, lines, trying_next, source, model, cost_usd, input_tokens, episodes from character_lessons where character_id = $1 order by created_at`,
    [id],
  )).rows;

describe("who qualifies", () => {
  it("needs two aired public dates since its last lessons: unaired, private, unlisted and After Dark dates don't count", async () => {
    const owner = userIdOf(newUserCookie());
    const two = await character(owner);
    const one = await character(owner);
    const hidden = await character(owner);
    await date(two, HOUSE);
    await date(two, HOUSE_2, { mineIsB: true });
    await date(one, HOUSE);
    await date(hidden, HOUSE);
    await date(hidden, HOUSE, { aired: null });
    await date(hidden, HOUSE, { visibility: "private" });
    await date(hidden, HOUSE, { visibility: "unlisted" });
    await date(hidden, HOUSE, { afterDark: true });
    const ids = (await lessonCandidates(t.db, NOW)).map((c) => c.id);
    expect(ids).toContain(two);
    expect(ids).not.toContain(one);
    expect(ids).not.toContain(hidden);
    // The cast dates daily: the house character on those dates has more than two, so it qualifies too.
    expect(ids).toContain(HOUSE);
    expect(await ensureCharacterLessons(t.db, one, NOW, { models: [] })).toMatchObject({ skipped: "too_few_dates" });
  });

  it("writes once a week, and again only after two more dates have aired", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner);
    await date(c, HOUSE);
    await date(c, HOUSE_2);
    expect(await ensureCharacterLessons(t.db, c, NOW, { models: [scripted([GOOD]).model] })).toMatchObject({ source: "model", lines: 3 });
    expect(await ensureCharacterLessons(t.db, c, NOW, { models: [scripted([GOOD]).model] })).toMatchObject({ skipped: "too_few_dates" });
    expect((await lessonCandidates(t.db, NOW)).map((x) => x.id)).not.toContain(c);
    // Next week, one new date: not yet. A second: it qualifies again, and only the new dates are read.
    const next = new Date(NOW.getTime() + 7 * 86_400_000);
    await date(c, HOUSE, { aired: daysAgo(1, next) });
    expect((await lessonCandidates(t.db, next)).map((x) => x.id)).not.toContain(c);
    const fresh = await date(c, HOUSE_2, { aired: daysAgo(0.5, next) });
    expect((await lessonCandidates(t.db, next)).map((x) => x.id)).toContain(c);
    const facts = (await lessonFacts(t.db, c, next))!;
    expect(facts.dates).toHaveLength(2);
    expect(facts.dates[1].episode_id).toBe(fresh);
    expect(facts.before).toContain("I leave when people audit my stories.");
    expect(lessonWeek(next)).not.toBe(lessonWeek(NOW));
  });

  it("never a step-in persona or a deleted account's tombstone, and a week belongs to its Monday", async () => {
    const persona = await character("you:abc");
    const gone = await character("deleted");
    for (const c of [persona, gone]) {
      await date(c, HOUSE);
      await date(c, HOUSE_2);
    }
    const ids = (await lessonCandidates(t.db, NOW)).map((c) => c.id);
    expect(ids).not.toContain(persona);
    expect(ids).not.toContain(gone);
    // A date with a step-in persona isn't one the cast learns from either.
    const cast = await character("", "Cast Member", { house: true });
    await date(cast, persona);
    await date(cast, persona);
    expect((await lessonCandidates(t.db, NOW)).map((c) => c.id)).not.toContain(cast);
    expect(lessonWeek(new Date("2026-11-15T23:59:00Z"))).toBe("2026-11-09"); // Sunday belongs to the week that began Monday the 9th
    expect(lessonWeek(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11-16");
  });
});

describe("what the writer is given: its own side only", () => {
  it("carries its own reflection, thoughts, answer and advice, and nothing private of the other side's", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner);
    const first = await date(c, HOUSE, { note: "Ask about their work before you talk about bread.", followed: false, ending: "disaster", aired: daysAgo(3) });
    const second = await date(c, HOUSE_2, { mineIsB: true, ending: "second_date" });
    const unaired = await date(c, HOUSE, { aired: null });
    const facts = (await lessonFacts(t.db, c, NOW))!;
    const text = userText(lessonMessages(facts));
    for (const ep of [first, second]) {
      expect(text).toContain(`MINE-REFLECTION ${ep}`);
      expect(text).toContain(`MINE-THOUGHT ${ep}`);
      expect(text).toContain(`MINE-REASON ${ep}`);
      expect(text).not.toContain(`OTHER-REFLECTION ${ep}`);
      expect(text).not.toContain(`OTHER-THOUGHT ${ep}`);
      expect(text).not.toContain(`OTHER-REASON ${ep}`);
    }
    // Nothing of a date that hasn't aired, from either side.
    expect(text).not.toContain(unaired);
    // Its owner's advice and whether it took it; the public why line; how each night ended.
    expect(text).toContain("Ask about their work before you talk about bread.");
    expect(text).toContain('"you":"ignored it"');
    expect(facts.dates[0].why).toMatch(/^A disaster:/);
    expect(facts.dates[0].why).not.toMatch(/By the numbers/);
    expect(text).toContain("A second date");
    // Its sheet's voice is there to write in; its dealbreaker and want are not the writer's business.
    expect(text).toContain("Deadpan");
    expect(text).not.toContain("check their phone");
  });

  it("keeps a roleplay's thoughts out (a role's, not its own), a dare's note out (the audience's), and a forgotten reflection out", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner);
    const role = await date(c, HOUSE, { roleplay: true });
    const dared = await date(c, HOUSE_2, { note: "Order for both of you without asking.", followed: true });
    await t.db.query(`insert into dare_nights (day, character_id, dare_id, votes, total, episode_id) values ('2026-11-16', $1, 'order', 3, 4, $2)`, [c, dared]);
    await t.db.query(`insert into memory_forgets (character_id, kind, item) values ($1, 'reflection', $2)`, [c, dared]);
    const text = userText(lessonMessages((await lessonFacts(t.db, c, NOW))!));
    expect(text).not.toContain(`MINE-THOUGHT ${role}`);
    expect(text).toContain(`MINE-REFLECTION ${role}`);
    expect(text).not.toContain("Order for both of you");
    expect(text).not.toContain(`MINE-REFLECTION ${dared}`);
  });
});

describe("the checks", () => {
  it("takes a specific first-person line, and drops anything too long, not about itself, or not PG", () => {
    expect(checkLesson('  "I leave when people audit my stories."  ')).toBe("I leave when people audit my stories.");
    expect(checkLesson("1. I talk about bread when I'm scared of the question.")).toBe("I talk about bread when I'm scared of the question.");
    expect(checkLesson(`I ${"really ".repeat(20)}do go on.`)).toBeNull(); // over the cap
    expect(`I ${"really ".repeat(20)}do go on.`.length).toBeGreaterThan(LESSON_LINE_MAX);
    expect(checkLesson("I flirt.")).toBeNull(); // says nothing
    expect(checkLesson("People who ask questions are the best company.")).toBeNull(); // not about itself
    expect(checkLesson("You should always ask a second question.")).toBeNull(); // advice to someone else
    expect(checkLesson("I'd rather take them to bed than to dinner, and it shows.")).toBeNull(); // not PG
    expect(checkLesson("I talk to them like they're a 15 year old and it lands badly.")).toBeNull(); // a minor, even in passing
    expect(checkLesson(42)).toBeNull();
  });

  it("drops therapy-speak, lists of virtues and talk of the show's machinery", () => {
    for (const line of [
      "I need to set better boundaries with people I like.",
      "I'm on a healing journey and my dates are part of it.",
      "I'm learning to be vulnerable and authentic with people.",
      "I deserve better than someone who checks their phone.",
      "I'm kind, loyal and honest.",
      "I am a warm and genuine person.",
      "I lose points when I talk over people, and my score shows it.",
      "I play to the viewers instead of the person across from me.",
      "My creator told me to slow down and I didn't.",
      "I stall when trust 44 is all we've got.",
    ]) {
      expect(checkLesson(line), line).toBeNull();
    }
    expect(isVirtueList("I'm funny when I'm nervous, and it isn't a compliment.")).toBe(false);
    expect(checkLesson("I'm funny when I'm nervous, and it isn't a compliment.")).not.toBeNull();
    // Ordinary words that only look like the machinery's.
    expect(checkLesson("I get defensive when someone points out a habit of mine.")).not.toBeNull();
  });

  it("keeps at most three, drops repeats of each other, of what it knew and of what it was told to forget", () => {
    const f = { before: ["I interrupt when I'm losing an argument."], forgotten: ["I leave when people audit my stories."] };
    const set = checkLessons(
      {
        lessons: [
          "I leave when people audit my stories.", // forgotten
          "I leave when people audit my stories, honestly.", // the same forgotten thing in other words
          "I interrupt when I am losing an argument.", // what it already knew
          "I name the bread so I don't have to name the feeling.",
          "I name the bread so I don't have to name the feeling!", // a repeat
          "I ask a second question only when I already like them.",
          "I tip too much when a date goes badly.",
          "I laugh at my own joke before they can decide not to.",
        ],
        trying_next: "Next time I let the silence sit for a second.",
      },
      f,
    )!;
    expect(set.lines).toEqual(["I name the bread so I don't have to name the feeling.", "I ask a second question only when I already like them.", "I tip too much when a date goes badly."]);
    expect(set.lines.length).toBeLessThanOrEqual(LESSONS_MAX);
    expect(set.trying_next).toBe("Next time I let the silence sit for a second.");
    expect(checkLessons({ lessons: ["I'm kind and loyal."] }, { before: [], forgotten: [] })).toBeNull();
    expect(parseLessons("```json\n" + GOOD + "\n```", { before: [], forgotten: [] })?.lines).toHaveLength(3);
    expect(parseLessons("not json", { before: [], forgotten: [] })).toBeNull();
  });
});

describe("the writer: the free model, the paid fallback, then the template", () => {
  async function ready() {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner, "Juno Vale");
    const a = await date(c, HOUSE, { ending: "disaster", note: "Ask about their work first.", followed: false });
    const b = await date(c, HOUSE_2, { ending: "disaster" });
    return { owner, c, episodes: [a, b] };
  }

  it("stores the first model's checked lines with the dates behind them, its model and what the call cost", async () => {
    const { c, episodes } = await ready();
    const free = scripted([GOOD]);
    const paid = scripted([GOOD]);
    const r = await ensureCharacterLessons(t.db, c, NOW, { models: [free.model, paid.model] });
    expect(r).toMatchObject({ source: "model", lines: 3, week: "2026-11-16" });
    expect(paid.calls).toHaveLength(0);
    const [row] = await stored(c);
    expect(row).toMatchObject({ source: "model", model: "gemini-3.5-flash-lite", trying_next: "Next time I let them pick the bread.", input_tokens: 1300 });
    expect(row.lines).toHaveLength(3);
    expect(row.episodes.map((e) => e.episode_id).sort()).toEqual([...episodes].sort());
    // 1,300 in and 150 out at flash-lite list price: under the 0.2¢ target.
    expect(Number(row.cost_usd)).toBeCloseTo((1300 * 0.3 + 150 * 2.5) / 1e6, 8);
    expect(Number(row.cost_usd)).toBeLessThan(0.002);
  });

  it("falls to the paid model when the free one fails or writes nothing usable, and counts both calls", async () => {
    const { c } = await ready();
    const free = scripted([JSON.stringify({ lessons: ["I'm kind, loyal and honest.", "I need better boundaries."] })]);
    const paid = scripted([GOOD], { model: "anthropic/claude-haiku-5.5", cost: 0.0019 });
    expect(await ensureCharacterLessons(t.db, c, NOW, { models: [free.model, paid.model] })).toMatchObject({ source: "model" });
    const [row] = await stored(c);
    expect(row.model).toBe("anthropic/claude-haiku-5.5");
    expect(row.input_tokens).toBe(2600);
    // The provider's own figure for the paid call, list price for the free one.
    expect(Number(row.cost_usd)).toBeCloseTo(0.0019 + (1300 * 0.3 + 150 * 2.5) / 1e6, 8);
    expect(lessonCost([{ model: "some-unpriced-model", input: 10, cachedInput: 0, output: 5, thinking: 0 }]).cost_usd).toBeNull();
  });

  it("falls to the template when every model fails: true, specific, checked, and free", async () => {
    const { c } = await ready();
    const down = scripted([new ModelError("429"), new ModelError("down")]);
    expect(await ensureCharacterLessons(t.db, c, NOW, { models: [down.model, down.model] })).toMatchObject({ source: "template" });
    const [row] = await stored(c);
    expect(row).toMatchObject({ source: "template", model: null, cost_usd: null });
    expect(row.lines.length).toBeGreaterThan(0);
    expect(row.lines.length).toBeLessThanOrEqual(LESSONS_MAX);
    for (const l of [...row.lines, row.trying_next!]) expect(checkLesson(l), l).toBe(l);
    // It ignored advice on a night that went badly, and two nights went wrong: the record says so.
    expect(row.lines.join(" ")).toMatch(/ignored good advice/);
    expect(row.lines.join(" ")).toMatch(/Two nights went wrong/);
    // No model at all (a deployment with none configured) is the template too.
    const other = await character(userIdOf(newUserCookie()));
    await date(other, HOUSE, { ending: "second_date" });
    await date(other, HOUSE_2, { ending: "second_date" });
    expect(await ensureCharacterLessons(t.db, other, NOW, { models: [] })).toMatchObject({ source: "template" });
  });

  it("the template never says anything the facts don't: every kind of week gives checked lines", () => {
    const base: LessonFacts = {
      character: { id: "c", name: "Juno Vale", age: 31, bio: "A baker.", traits: [], voice: null, pronouns: null, examples: [], never_says: [] },
      dates: [],
      flagged: [],
      before: [],
      forgotten: [],
    };
    const d = (withName: string, ending: "second_date" | "friends" | "disaster", extra: Partial<LessonFacts["dates"][number]> = {}): LessonFacts["dates"][number] => ({
      episode_id: `e-${withName}`, with: withName, at: NOW.toISOString(), venue: null, ending, date_number: 1, why: null, reflection: null, thoughts: [], choice: null, wanted_more: null, advice: null, ...extra,
    });
    const weeks: LessonFacts[] = [
      { ...base, dates: [d("Nell Hart", "second_date"), d("Dex Moreno", "second_date")] },
      { ...base, dates: [d("Nell Hart", "friends"), d("Dex Moreno", "friends")] },
      { ...base, dates: [d("Nell Hart", "second_date"), d("Dex Moreno", "disaster", { wanted_more: true })] },
      { ...base, dates: [d("Nell Hart", "friends", { thoughts: ["He keeps saying 'honestly' right before the part that isn't."] }), d("Dex Moreno", "friends")], flagged: ["Gosh, what a simply delightful evening this has been!"] },
      { ...base, dates: [d("The Duke", "friends", { advice: { text: "Be nicer.", followed: true } }), d("Dex Moreno", "second_date")] },
    ];
    for (const f of weeks) {
      const set = templateLessons(f)!;
      expect(set.lines.length).toBeGreaterThan(0);
      for (const l of [...set.lines, set.trying_next!]) {
        expect(l.length).toBeLessThanOrEqual(LESSON_LINE_MAX);
        expect(checkLesson(l), l).toBe(l);
      }
    }
    expect(templateLessons(weeks[3])!.lines[0]).toMatch(/didn't sound like me/);
    expect(templateLessons({ ...base, dates: [] })).toBeNull();
  });

  it("two passes can't both write a week: the second finds it claimed", async () => {
    const { c } = await ready();
    await t.db.query(`insert into character_lessons (character_id, week, source, created_at) values ($1, $2, 'pending', $3)`, [c, lessonWeek(NOW), NOW.toISOString()]);
    const free = scripted([GOOD]);
    expect(await ensureCharacterLessons(t.db, c, NOW, { models: [free.model] })).toMatchObject({ skipped: "already" });
    expect(free.calls).toHaveLength(0);
    // A claim nobody finished (a crash mid-call) is taken over after an hour.
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    expect(await ensureCharacterLessons(t.db, c, later, { models: [free.model] })).toMatchObject({ source: "model" });
  });
});

/* ---------------------------------------------- where the lessons go ---------------------------------------------- */

const sheetA: CharacterSheet = { name: "Juno Vale", age: 31, bio: "a baker", traits: ["dry", "stubborn"], want: "a second question", dealbreaker: "phones at dinner", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a sailor", traits: ["dramatic", "kind"], want: "an honest critic", dealbreaker: "liars", house: true };
const sideSetup = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: sideSetup(sheetA), b: sideSetup(sheetB) };
const so = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = fixedEngine({ ending: "friends", sides: [so(true), so(false)] }).decide(INPUT, 1);
const LESSONS = { lines: ["I leave when people audit my stories.", "I get funnier the less I like someone."], trying_next: "Next time I let them pick the bread." };

describe("the date prompt", () => {
  const withLessons = (): [Character, Character] => {
    const a = assembleCharacter({ id: "juno", sheet: sheetA, soul: null, memory: null });
    a.lessons = LESSONS;
    return [a, assembleCharacter({ id: "rafe", sheet: sheetB, soul: null, memory: null })];
  };

  it("puts the lessons in the character's own self view, with how to use them, and never in the other side's prompt", () => {
    const chars = withLessons();
    const mine = JSON.parse(userText(buildTurnMessages(INPUT, OUTCOME, chars, "a_hard_question", pickVenue(1), [], 0).messages).replace(/^[^{]*/, ""));
    const block = mine.you.private.memory.what_you_have_learned_about_yourself;
    expect(block.lessons).toEqual(LESSONS.lines);
    expect(block.what_you_are_trying_next).toBe(LESSONS.trying_next);
    expect(block.how_it_shows).toBe(LESSON_USE_NOTE);
    expect(LESSON_USE_NOTE).toMatch(/never in announcing it/);
    const theirs = JSON.stringify(buildTurnMessages(INPUT, OUTCOME, chars, "a_hard_question", pickVenue(1), [{ side: "a", act: 0, dialogue: "Hi.", action: "", emotion: "dry", interest: 0.5 }], 1).messages);
    for (const l of [...LESSONS.lines, LESSONS.trying_next]) expect(theirs).not.toContain(l);
    expect(theirs).not.toContain("what_you_have_learned_about_yourself");
  });

  it("takes the arc's place rather than adding to it, and a character without lessons reads exactly as before", () => {
    const memory = { dates: 3, second_dates: 1, friends: 1, disasters: 1, likes: ["bread"], turnoffs: [], signal_delta: {}, memorable_lines: [], reflections: [], arc: "3 dates in; warms to “bread”." };
    const plain = assembleCharacter({ id: "juno", sheet: sheetA, soul: null, memory });
    const before = JSON.stringify(buildTurnMessages(INPUT, OUTCOME, [plain, withLessons()[1]], "a_hard_question", pickVenue(1), [], 0).messages);
    expect(before).toContain("who_you_have_become");
    expect(before).not.toContain("what_you_have_learned_about_yourself");
    const learned = assembleCharacter({ id: "juno", sheet: sheetA, soul: null, memory });
    learned.lessons = LESSONS;
    const after = JSON.stringify(buildTurnMessages(INPUT, OUTCOME, [learned, withLessons()[1]], "a_hard_question", pickVenue(1), [], 0).messages);
    expect(after).toContain("what_you_have_learned_about_yourself");
    expect(after).not.toContain("who_you_have_become");
    expect(after).toContain("what_you_tend_to_like");
  });

  it("behaviour only: the engine's input is the same with and without lessons, and the engine never reads them", () => {
    const req: DateRequest = { setting: "cafe", autonomy: "balanced", strategy: "genuine_chemistry", note: null, gameBudget: 25, format: "classic" } as unknown as DateRequest;
    const parts = { episodeId: "ep-x", a: { id: "juno", sheet: sheetA }, b: { id: "rafe", sheet: sheetB }, req, seed: 7, soulA: null, soulB: null, memoryA: null, memoryB: null };
    const without = assembleDate(parts as unknown as Parameters<typeof assembleDate>[0]);
    const withThem = assembleDate({ ...parts, lessonsA: LESSONS, lessonsB: LESSONS } as unknown as Parameters<typeof assembleDate>[0]);
    expect(withThem.characters[0].lessons).toEqual(LESSONS);
    expect(withThem.input).toEqual(without.input);
    expect(withThem.setup).toEqual(without.setup);
    const engine = readFileSync(join(__dirname, "..", "lib", "engine.ts"), "utf8");
    expect(engine).not.toMatch(/lessons|character-lessons/i);
  });

  it("a date being built reads the stored lessons, minus what was forgotten, and none with the switch off", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner);
    await date(c, HOUSE);
    await date(c, HOUSE_2);
    await ensureCharacterLessons(t.db, c, NOW, { models: [scripted([GOOD]).model] });
    expect(await lessonsForPrompt(t.db, c)).toEqual({ lines: JSON.parse(GOOD).lessons, trying_next: "Next time I let them pick the bread." });
    await t.db.query(`insert into memory_forgets (character_id, kind, item) values ($1, 'lesson', 'I leave when people audit my stories.')`, [c]);
    expect((await lessonsForPrompt(t.db, c))!.lines).not.toContain("I leave when people audit my stories.");
    setCharacterLessonsForTests(false);
    expect(await lessonsForPrompt(t.db, c)).toBeNull();
  });
});

describe("the companion prompt", () => {
  const c = assembleCharacter({ id: "juno", sheet: sheetA, soul: null, memory: null });
  const base = { character: c, turns: [], facts: [], summary: null, length: "normal" as const, avoid: [] };
  it("carries the lessons for the person who made the character, and for nobody else", () => {
    const yours = companionMessages({ ...base, yours: true, lessons: LESSONS })[0].content;
    expect(yours).toContain("What your dates have taught you about yourself lately");
    for (const l of LESSONS.lines) expect(yours).toContain(l);
    expect(yours).toContain(`What you're trying next: ${LESSONS.trying_next}`);
    const stranger = companionMessages({ ...base, yours: false, lessons: LESSONS })[0].content;
    for (const l of [...LESSONS.lines, LESSONS.trying_next]) expect(stranger).not.toContain(l);
    expect(companionMessages({ ...base, yours: true })[0].content).not.toContain("taught you about yourself");
  });
});

describe("the memory page's forget", () => {
  const forget = (id: string, cookie: string, body: unknown, method: "POST" | "DELETE" = "POST") =>
    (method === "POST" ? postForget : deleteForget)(
      new Request(`${BASE_URL}/api/characters/${id}/memory/forget`, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) },
    );

  it("forgets a lesson by its words, for its owner only; it leaves every prompt and is never written again", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const c = await character(owner);
    await date(c, HOUSE);
    await date(c, HOUSE_2);
    await ensureCharacterLessons(t.db, c, NOW, { models: [scripted([GOOD]).model] });
    const line = "I leave when people audit my stories.";
    expect((await forget(c, newUserCookie(), { kind: "lesson", item: line })).status).toBe(404); // not theirs
    expect((await forget(c, cookie, { kind: "lesson", item: "I never said this." })).status).toBe(404); // not something it holds
    expect((await forget(c, cookie, { kind: "lesson", item: line })).status).toBe(200);
    expect((await loadLessons(t.db, c))!.lines).toEqual(["I get funnier the less I like someone, and they can tell.", "I order for the table so nobody can ask what I want."]);
    expect(await describeForgets(t.db, c, [{ kind: "lesson", item: line }])).toEqual([{ kind: "lesson", item: line, label: `What it learned: “${line}”` }]);
    // The trying-next line is forgettable the same way.
    expect((await forget(c, cookie, { kind: "lesson", item: "Next time I let them pick the bread." })).status).toBe(200);
    expect((await loadLessons(t.db, c))!.trying_next).toBeNull();
    // The writer is told to let it go, and a model that writes it anyway is overruled.
    const facts = (await lessonFacts(t.db, c, new Date(NOW.getTime() + 60_000), null))!;
    expect(facts.forgotten).toContain(line);
    expect(userText(lessonMessages(facts))).toContain('"let_go":["I leave when people audit my stories."');
    expect(facts.before).not.toContain(line);
    // (Everything else in that reply it already knows, so nothing of it is new.)
    expect(parseLessons(GOOD, facts)).toBeNull();
    expect(parseLessons(JSON.stringify({ lessons: [line, "I leave when someone audits my stories.", "I tip too much when a date goes badly."] }), facts)?.lines).toEqual(["I tip too much when a date goes badly."]);
    // Remember it again: it's back.
    expect((await forget(c, cookie, { kind: "lesson", item: line }, "DELETE")).status).toBe(200);
    expect((await loadLessons(t.db, c))!.lines).toContain(line);
  });
});

describe("the Sunday recap", () => {
  it("says one line of what the character took from the week, when lessons landed in it", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner, "Juno Vale");
    await date(c, HOUSE);
    await date(c, HOUSE_2);
    const quiet = await weekOf(t.db, owner, NOW);
    expect(quiet[0].lessons).toBeUndefined();
    await ensureCharacterLessons(t.db, c, new Date(NOW.getTime() - 60_000), { models: [scripted([GOOD]).model] });
    const [week] = await weekOf(t.db, owner, NOW);
    expect(week.lessons).toEqual(JSON.parse(GOOD).lessons);
    expect(week.events).toBe(quiet[0].events + 1);
    expect(weekSentence(week)).toMatch(/What Juno took from it: “I leave when people audit my stories\.”$/);
    expect(characterWeekNotice([week])!.body).toContain("I leave when people audit my stories.");
    // A forgotten lesson isn't recapped; with the switch off nothing is.
    await t.db.query(`insert into memory_forgets (character_id, kind, item) values ($1, 'lesson', 'I leave when people audit my stories.')`, [c]);
    expect((await weekOf(t.db, owner, NOW))[0].lessons?.[0]).toBe("I get funnier the less I like someone, and they can tell.");
    setCharacterLessonsForTests(false);
    expect((await weekOf(t.db, owner, NOW))[0].lessons).toBeUndefined();
  });
});

describe("the daily step and the one weekly text", () => {
  async function optedIn(name = "Juno Vale") {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner, name);
    await date(c, HOUSE);
    await date(c, HOUSE_2);
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive) values ($1, $2, $3, false)`, [`th-${c}`, owner, c]);
    return { owner, c, thread: `th-${c}` };
  }
  const texts = async (thread: string) =>
    (await t.db.query<{ text: string; action: string }>(`select text, action from companion_messages where thread_id = $1 and role = 'character' order by created_at, id`, [thread])).rows;
  const anyModel = () => scripted(Array.from({ length: 40 }, () => GOOD)).model;

  it("writes for everyone who qualifies, texts an opted-in owner once, and never twice in a week", async () => {
    const { c, thread } = await optedIn();
    const silent = userIdOf(newUserCookie());
    const quiet = await character(silent);
    await date(quiet, HOUSE);
    await date(quiet, HOUSE_2);
    const run = await runCharacterLessons(t.db, NOW, { models: [anyModel()] });
    // Both people's characters and the two house characters they dated.
    expect(run).toMatchObject({ written: 4, by_model: 4, by_template: 0, texts: 1, ours: 0, stopped: "done" });
    expect(run.cost_per_character_usd).toBeCloseTo((1300 * 0.3 + 150 * 2.5) / 1e6, 8);
    const sent = await texts(thread);
    expect(sent.map((m) => m.text)).toEqual(["I've been thinking.", "I leave when people audit my stories.", "Next time I let them pick the bread."]);
    expect(new Set(sent.map((m) => m.action))).toEqual(new Set([`lessons:${lessonWeek(NOW)}`]));
    const told = (await t.db.query(`select 1 from notifications where user_id = (select user_id from companion_threads where id = $1) and kind = 'character_texted_you'`, [thread])).rows;
    expect(told).toHaveLength(1);
    // A second run the same day writes nothing and texts nobody.
    expect(await runCharacterLessons(t.db, NOW, { models: [anyModel()] })).toMatchObject({ written: 0, texts: 0 });
    expect(await texts(thread)).toHaveLength(3);
    // New lessons five days later (a new week's row): still inside a week of the last text, so no second one.
    const monday = new Date("2026-11-23T16:20:00Z");
    await date(c, HOUSE, { aired: daysAgo(1, monday) });
    await date(c, HOUSE_2, { aired: daysAgo(0.5, monday) });
    const again = await runCharacterLessons(t.db, monday, { models: [anyModel()] });
    expect(again.written).toBeGreaterThan(0);
    expect(again.texts).toBe(0);
    expect(await texts(thread)).toHaveLength(3);
    // The week after that, it may text again.
    const l = (await loadLessons(t.db, c))!;
    expect(await lessonText(t.db, c, { ...l, week: "2026-11-30" }, new Date("2026-12-01T16:20:00Z"))).toBe(true);
    expect(await texts(thread)).toHaveLength(6);
  });

  it("texts nobody who didn't opt in, whose thread is paused, or who is one of us; ours are written last and counted apart", async () => {
    const muted = await optedIn();
    await t.db.query(`update companion_threads set muted_proactive = true where id = $1`, [muted.thread]);
    const paused = await optedIn();
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [paused.thread]);
    // A test-named character: its owner is one of our own identities (lib/our-traffic.ts OUR_TEST_NAMES).
    const ours = await optedIn("Mira Quell");
    const run = await runCharacterLessons(t.db, NOW, { models: [anyModel()] });
    expect(run.texts).toBe(0);
    expect(run.ours).toBe(1);
    for (const x of [muted, paused, ours]) expect(await texts(x.thread)).toHaveLength(0);
    expect((await stored(ours.c))[0].lines).toHaveLength(3);
    expect(lessonTextLines({ lines: ["I talk too much."], trying_next: null })).toEqual(["I've been thinking.", "I talk too much.", "Does that sound like me to you?"]);
  });

  it("our own characters never reach the paid fallback: the free model, then the template", async () => {
    const mine = await optedIn();
    const ours = await optedIn("Mira Quell");
    const free = scripted([]); // out of outputs: every call fails
    const paid = scripted(Array.from({ length: 10 }, () => GOOD), { model: "anthropic/claude-haiku-5.5", cost: 0.002 });
    const run = await runCharacterLessons(t.db, NOW, { models: [free.model, paid.model] });
    expect(run).toMatchObject({ written: 4, by_model: 3, by_template: 1, ours: 1 });
    expect((await stored(mine.c))[0]).toMatchObject({ source: "model", model: "anthropic/claude-haiku-5.5" });
    expect((await stored(ours.c))[0]).toMatchObject({ source: "template", model: null });
    expect(paid.calls).toHaveLength(3); // the person's character and the two house characters
    expect(run.cost_usd).toBeCloseTo(0.006, 6);
  });

  it("stops at the day's cap, people's characters first, and picks the rest up the next day", async () => {
    const mine = await optedIn();
    const ours = await optedIn("Mira Quell");
    const first = await runCharacterLessons(t.db, NOW, { models: [anyModel()], limit: 1 });
    expect(first).toMatchObject({ written: 1, stopped: "day_cap", ours: 0 });
    expect(await stored(mine.c)).toHaveLength(1);
    expect(await stored(ours.c)).toHaveLength(0);
    // The same day again: the cap is already spent.
    expect(await runCharacterLessons(t.db, NOW, { models: [anyModel()], limit: 1 })).toMatchObject({ written: 0, stopped: "day_cap" });
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect((await runCharacterLessons(t.db, tomorrow, { models: [anyModel()] })).written).toBe(3); // the two house characters, then ours
    expect(await stored(ours.c)).toHaveLength(1);
  });

  it("CHARACTER_LESSONS=0 turns all of it off: nothing written, read or sent", async () => {
    const { c, thread } = await optedIn();
    await ensureCharacterLessons(t.db, c, new Date(NOW.getTime() - 60_000), { models: [scripted([GOOD]).model] });
    setCharacterLessonsForTests(null);
    expect(characterLessonsOn({})).toBe(true);
    expect(characterLessonsOn({ CHARACTER_LESSONS: "1" })).toBe(true);
    expect(characterLessonsOn({ CHARACTER_LESSONS: "0" })).toBe(false);
    vi.stubEnv("CHARACTER_LESSONS", "0");
    expect(await runCharacterLessons(t.db, NOW, { models: [anyModel()] })).toMatchObject({ written: 0, stopped: "off" });
    expect(await ensureCharacterLessons(t.db, HOUSE, NOW, { models: [anyModel()] })).toMatchObject({ skipped: "off" });
    expect(await loadLessons(t.db, c)).toBeNull();
    expect(await lessonText(t.db, c, { lines: ["I talk too much, honestly."], trying_next: null, week: "2026-11-16" }, NOW)).toBe(false);
    expect(await texts(thread)).toHaveLength(0);
    // The rows stay, and come back with the switch.
    vi.stubEnv("CHARACTER_LESSONS", "1");
    expect((await loadLessons(t.db, c))!.lines).toHaveLength(3);
  });
});

describe("viewers' \"Not them\" flags reach the character's own lessons", () => {
  async function signedIn(): Promise<string> {
    const user = userIdOf(newUserCookie());
    await registerAccount(t.db, user, `les${++n}${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
    return user;
  }
  const flag = (user: string, ep: string, line: number, tag: "out_of_character" | null = "out_of_character") => setLineVote(t.db, { userId: user, kind: "episode", refId: ep, lineIndex: line, vote: -1, tag });

  it("counts a line at two distinct signed-in viewers, or its owner alone; never anonymous viewers, a plain 👎, or the other side's line", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner);
    const ep = await date(c, HOUSE); // the character is side a: lines 0 and 2 are its own
    const [v1, v2] = [await signedIn(), await signedIn()];
    const [anon1, anon2] = [userIdOf(newUserCookie()), userIdOf(newUserCookie())];
    await flag(v1, ep, 0);
    expect(await outOfCharacterFlags(t.db, c, NOW)).toEqual([]); // one viewer isn't enough
    await flag(anon1, ep, 0);
    await flag(anon2, ep, 0);
    expect(await outOfCharacterFlags(t.db, c, NOW)).toEqual([]); // anonymous sessions never count
    await flag(v2, ep, 0, null); // a plain thumbs-down says nothing about character
    expect(await outOfCharacterFlags(t.db, c, NOW)).toEqual([]);
    await flag(v2, ep, 0);
    expect(await outOfCharacterFlags(t.db, c, NOW)).toEqual([{ episode_id: ep, line_index: 0, text: LINES[0].dialogue, people: 2, owner: false }]);
    // The other side's line, flagged by the same two: that's the house character's to hear, not this one's.
    await flag(v1, ep, 1);
    await flag(v2, ep, 1);
    expect((await outOfCharacterFlags(t.db, c, NOW)).map((f) => f.line_index)).toEqual([0]);
    expect((await outOfCharacterFlags(t.db, HOUSE, NOW)).map((f) => f.text)).toEqual([LINES[1].dialogue]);
    // Its owner alone is enough, signed in or not.
    await flag(owner, ep, 2);
    expect((await outOfCharacterFlags(t.db, c, NOW)).map((f) => f.line_index).sort()).toEqual([0, 2]);
  });

  it("only on aired public dates, and the writer is shown the lines", async () => {
    const owner = userIdOf(newUserCookie());
    const c = await character(owner);
    const aired = await date(c, HOUSE);
    await date(c, HOUSE_2);
    const unaired = await date(c, HOUSE, { aired: null });
    const priv = await date(c, HOUSE, { visibility: "private" });
    for (const ep of [aired, unaired, priv]) await flag(owner, ep, 2);
    expect((await outOfCharacterFlags(t.db, c, NOW)).map((f) => f.episode_id)).toEqual([aired]);
    const facts = (await lessonFacts(t.db, c, NOW))!;
    expect(facts.flagged).toEqual([LINES[2].dialogue]);
    const text = userText(lessonMessages(facts));
    expect(text).toContain("people_said_these_lines_did_not_sound_like_you");
    expect(text).toContain(LINES[2].dialogue);
    // Without a model, the template says so in the character's own first person.
    await ensureCharacterLessons(t.db, c, NOW, { models: [] });
    expect((await stored(c))[0].lines[0]).toMatch(/^People said “And who did you pick\?” didn't sound like me\./);
  });
});
