/**
 * The fast first date (lib/fast-date.ts, 2026-11-15): a speed date starts on the rules plan with no director call in
 * front of line 1, waits only so long for a newcomer's hot takes, and writes the recap, the texts and the reflections
 * side by side once the ending stands. What must not move: the lines and the ending a date reaches (the same with the
 * order changed), the check on every line before anyone sees it, the verdict's write before the date is ready, and the
 * lease rules (#1613). No paid calls: a model that answers each prompt from the prompt alone.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAfterglowEnabledForTests } from "@/lib/afterglow";
import { setChoicesAskedForTests } from "@/lib/choices";
import { setConversationEnabledForTests, type Turn } from "@/lib/conversation";
import { fixedEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { FAST_FORMATS_DEFAULT, fastStartOn, HOT_TAKES_WAIT_MS, hotTakesWaitMs, settledWithin, speedDateActor, speedDateReasoning } from "@/lib/fast-date";
import { firstDateFormat } from "@/lib/first-date";
import { fallbackHotTakes, setHotTakesDerivingForTests } from "@/lib/hot-takes";
import { AFTER_OUTCOME_LEASE_SECONDS, runGenerationJob, setInlineGenerationForTests, TURN_LEASE_SECONDS } from "@/lib/jobs";
import { ModelError, setFrontierModelForTests, setModelForTests, type ChatMessage, type Model } from "@/lib/model";
import { generateDate, type GenerateOptions } from "@/lib/pipeline";
import { setReflectionEnabledForTests } from "@/lib/reflection";
import { ShowrunnerError } from "@/lib/showrunner";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, planJson, scriptOutcome, startTestDb, validCharacter } from "./helpers";

type Kind = "plan" | "line" | "revision" | "answer" | "recap" | "text" | "reflection" | "hot_takes" | "other";

/** Which of a date's calls this is, from its system prompt's opening words. */
function kindOf(messages: ChatMessage[]): Kind {
  const s = messages[0]?.content ?? "";
  if (s.startsWith("You are the story editor")) return "plan";
  if (s.startsWith("You are one fictional adult on a date")) return messages.some((m) => m.role === "user" && m.content.startsWith("Revise that line")) ? "revision" : "line";
  if (s.startsWith("You are one fictional adult who has just finished a date")) return "answer";
  if (s.startsWith("You are the showrunner")) return "recap";
  if (s.startsWith("You are one fictional adult character the morning after")) return "text";
  if (s.startsWith("You are one fictional adult who just went on a blind date")) return "reflection";
  if (s.startsWith('You write for the dating show "Botchelor". Given one fictional adult')) return "hot_takes";
  return "other";
}

/** Twelve lines nobody would send back: each its own opening, no names, no trait words. */
const SAID = [
  "Ferries are underrated. Have you ever taken one just to turn around and come back?",
  "Once, by accident. I fell asleep and woke up where I started, which felt like a refund.",
  "My grandmother kept bees on a roof in the middle of town. Nobody believed her until the honey.",
  "Did the neighbours complain, or did the honey buy their silence?",
  "A jar each, every August. Bribery, but the polite kind.",
  "I respect that. The most I ever grew was a tomato, and a pigeon got to it first.",
  "Pigeons know quality. What would you plant if nothing could eat it?",
  "Lemons, probably. I like a tree that makes you wait and then overdoes it.",
  "That might be the most honest thing anyone has said to me across a table this year.",
  "Then the bar was low, but I will take the win.",
  "Walk me to the corner? I want to hear how the bee story ends.",
  "It ends with a very small funeral and a very large jar. Come on.",
];

/** The user message's data, when the prompt carries it as JSON after its first line. */
function dataOf(messages: ChatMessage[]): Record<string, unknown> {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  try {
    return JSON.parse(user.slice(user.indexOf("\n") + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type Seen = { kind: Kind; started: number; ended: number };

/**
 * A model that answers every one of a date's prompts from the prompt alone (so the order the calls are made in can't
 * change an answer), and notes when each call started and ended on one shared counter. `on` overrides a kind's answer
 * (returning nothing keeps the usual one).
 */
type Answer = string | Error | void;
function promptModel(on: Partial<Record<Kind, (messages: ChatMessage[], nth: number) => Answer | Promise<Answer>>> = {}): Model & { seen: Seen[]; count: (k: Kind) => number } {
  const seen: Seen[] = [];
  let clock = 0;
  const nth: Partial<Record<Kind, number>> = {};
  return {
    seen,
    count: (k) => seen.filter((x) => x.kind === k).length,
    async complete(messages) {
      const kind = kindOf(messages);
      const row: Seen = { kind, started: ++clock, ended: 0 };
      seen.push(row);
      const n = (nth[kind] = (nth[kind] ?? 0) + 1) - 1;
      try {
        // A turn of the event loop, so calls made side by side really do overlap.
        await new Promise((r) => setTimeout(r, kind === "recap" ? 12 : 2));
        const custom = on[kind] ? await on[kind]!(messages, n) : undefined;
        if (custom instanceof Error) throw custom;
        if (typeof custom === "string") return custom;
        const data = dataOf(messages);
        if (kind === "plan") return planJson();
        if (kind === "line" || kind === "revision") {
          const i = Array.isArray(data.conversation_so_far) ? data.conversation_so_far.length : 0;
          return JSON.stringify({ dialogue: SAID[i % SAID.length], action: "", emotion: "easy", interest_signal: 0.6, feeling: "curious", feeling_strength: 0.5, thought: `Private thought number ${i}.`, they_claimed: "" });
        }
        if (kind === "answer") return '{"see_again":"yes","reason":"I would like another evening like that one."}';
        if (kind === "recap") return episodeJson();
        if (kind === "text") return JSON.stringify({ text: ["Home safe. The bees say hello.", "Tell them I said it back. Lemons next time?", "Lemons, and no pigeons. Friday.", "Friday. I will bring a jar."][n % 4] });
        if (kind === "reflection") return '{"reflection":"I talked about bees for an hour and nobody left. I should do that more often."}';
        if (kind === "hot_takes") return '{"hot_takes":["Ferries beat bridges.","Toast is better cold.","Maps beat apps."]}';
        return "{}";
      } finally {
        row.ended = ++clock;
      }
    },
  };
}

const speedCase = EVAL_CASES.find((x) => x.id === "kaz-nell")!;
const options = (over: Partial<GenerateOptions> = {}): GenerateOptions => ({
  formatId: "speed_date",
  formatCtx: {},
  conversation: true,
  afterglow: true,
  reflection: true,
  wishes: true,
  engineVersion: 5,
  ...over,
});
const speedDate = () => {
  const built = buildEvalDate(speedCase);
  const decided = fixedEngine({ ending: "friends" }, { wishes: true }).decide(built.input, built.seed);
  return { built, decided };
};
/** A director's plan call as production has had it: cut off at the call limit, both tries. */
const planCutOff = () => new ModelError("model returned no text");

describe("the switches", () => {
  it("FAST_FIRST_LINE: speed dates by default, off, all, or a list; an unknown word is the default, never all", () => {
    expect(FAST_FORMATS_DEFAULT).toEqual(["speed_date"]);
    expect(fastStartOn("speed_date", {})).toBe(true);
    expect(fastStartOn("classic", {})).toBe(false);
    expect(fastStartOn(null, {})).toBe(false);
    for (const off of ["0", "off", "false", "no", " OFF "]) expect(fastStartOn("speed_date", { FAST_FIRST_LINE: off })).toBe(false);
    expect(fastStartOn("classic", { FAST_FIRST_LINE: "all" })).toBe(true);
    expect(fastStartOn("meet_the_parents", { FAST_FIRST_LINE: "ALL" })).toBe(true);
    expect(fastStartOn("classic", { FAST_FIRST_LINE: "speed_date, classic" })).toBe(true);
    expect(fastStartOn("ex_returns", { FAST_FIRST_LINE: "speed_date,classic" })).toBe(false);
    expect(fastStartOn("speed_date", { FAST_FIRST_LINE: "classic" })).toBe(false);
    expect(fastStartOn("classic", { FAST_FIRST_LINE: "everything" })).toBe(false);
    expect(fastStartOn("speed_date", { FAST_FIRST_LINE: "1" })).toBe(true);
    // The newcomer's first date is the format that starts fast.
    expect(fastStartOn(firstDateFormat({}), {})).toBe(true);
  });

  it("HOT_TAKES_WAIT_MS: 2.5 s unless a sane number says otherwise", () => {
    expect(hotTakesWaitMs({})).toBe(HOT_TAKES_WAIT_MS);
    expect(hotTakesWaitMs({ HOT_TAKES_WAIT_MS: "0" })).toBe(0);
    expect(hotTakesWaitMs({ HOT_TAKES_WAIT_MS: "800" })).toBe(800);
    expect(hotTakesWaitMs({ HOT_TAKES_WAIT_MS: "soon" })).toBe(HOT_TAKES_WAIT_MS);
    expect(hotTakesWaitMs({ HOT_TAKES_WAIT_MS: "-5" })).toBe(HOT_TAKES_WAIT_MS);
    expect(hotTakesWaitMs({ HOT_TAKES_WAIT_MS: "999999" })).toBe(25_000);
  });

  it("settledWithin: true when the work settles in time (a rejection counts), false when it doesn't", async () => {
    expect(await settledWithin(Promise.resolve(1), 50)).toBe(true);
    expect(await settledWithin(Promise.reject(new Error("no")), 50)).toBe(true);
    expect(await settledWithin(new Promise(() => {}), 10)).toBe(false);
  });

  describe("SPEED_DATE_MODEL", () => {
    const show: Model = { complete: async () => "from the show's model" };
    const paid = { FRONTIER_LLM_BASE_URL: "https://gateway.test/v1", FRONTIER_LLM_API_KEY: "k-test", FRONTIER_LLM_MODEL: "show/model" };
    const answering = (status = 200) => {
      const bodies: Record<string, unknown>[] = [];
      const urls: string[] = [];
      const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
        urls.push(String(url));
        bodies.push(JSON.parse(String(init?.body)));
        return status === 200
          ? new Response(JSON.stringify({ choices: [{ message: { content: "from the speed model" } }] }), { status: 200 })
          : new Response(JSON.stringify({ error: { message: "no such model" } }), { status });
      }) as unknown as typeof fetch;
      return { fetchImpl, bodies, urls };
    };

    it("unset is today's model: no speed actor at all", () => {
      expect(speedDateActor("speed_date", show, paid)).toBeNull();
      expect(speedDateActor("speed_date", show, { ...paid, SPEED_DATE_MODEL: "  " })).toBeNull();
      expect(speedDateReasoning({})).toBeUndefined();
      expect(speedDateReasoning({ SPEED_DATE_REASONING: "plenty" })).toBeUndefined();
    });

    it("only a speed date gets it, and only with a paid endpoint to call", () => {
      const env = { ...paid, SPEED_DATE_MODEL: "fast/model" };
      for (const f of ["classic", "meet_the_parents", "ex_returns", null] as const) expect(speedDateActor(f, show, env)).toBeNull();
      expect(speedDateActor("speed_date", show, { SPEED_DATE_MODEL: "fast/model" })).toBeNull();
    });

    it("calls that model at the show's endpoint with the show's key", async () => {
      const { fetchImpl, bodies, urls } = answering();
      const actor = speedDateActor("speed_date", show, { ...paid, SPEED_DATE_MODEL: "fast/model" }, fetchImpl)!;
      expect(await actor.complete([{ role: "user", content: "hi" }])).toBe("from the speed model");
      expect(urls).toEqual(["https://gateway.test/v1/chat/completions"]);
      expect(bodies[0].model).toBe("fast/model");
      expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    });

    it("SPEED_DATE_REASONING alone keeps the show's model and asks for that thinking level", async () => {
      const { fetchImpl, bodies } = answering();
      const actor = speedDateActor("speed_date", show, { ...paid, SPEED_DATE_REASONING: "Low" }, fetchImpl)!;
      await actor.complete([{ role: "user", content: "hi" }]);
      expect(bodies[0]).toMatchObject({ model: "show/model", reasoning_effort: "low" });
    });

    it("a call the speed model refuses falls back to the show's model", async () => {
      const { fetchImpl } = answering(404);
      const actor = speedDateActor("speed_date", show, { ...paid, SPEED_DATE_MODEL: "typo/model" }, fetchImpl)!;
      expect(await actor.complete([{ role: "user", content: "hi" }])).toBe("from the show's model");
    });
  });
});

describe("generateDate, fast", () => {
  beforeEach(() => setChoicesAskedForTests(true));
  afterEach(() => setChoicesAskedForTests(false));

  it("writes the same date as the old order did when the plan call came back empty: lines, ending, recap, texts, reflections", async () => {
    const run = async (fast: boolean) => {
      const { built, decided } = speedDate();
      const model = promptModel({ plan: planCutOff });
      const played: Turn[][] = [];
      const gen = await generateDate({ actor: model, director: model }, built, decided, options({ fast, onTurn: (t) => void played.push(t) }));
      return { gen, model, played };
    };
    const before = await run(false);
    const after = await run(true);
    // What production's speed dates did: asked for the plan twice, then played from the rules.
    expect(before.model.count("plan")).toBe(2);
    expect(before.gen.plan?.source).toBe("rules");
    // Fast: the same plan, without asking.
    expect(after.model.count("plan")).toBe(0);
    expect(after.gen.plan).toEqual(before.gen.plan);
    expect(after.gen.transcript).toHaveLength(6);
    expect(after.gen.transcript).toEqual(before.gen.transcript);
    expect(after.played).toEqual(before.played);
    expect(after.gen.inner).toEqual(before.gen.inner);
    expect(after.gen.outcome).toEqual(before.gen.outcome);
    expect(after.gen.wishes).toEqual(before.gen.wishes);
    expect(after.gen.endingDetail).toEqual(before.gen.endingDetail);
    expect(after.gen.draft).toEqual(before.gen.draft);
    expect(after.gen.afterglow).toHaveLength(4);
    expect(after.gen.afterglow).toEqual(before.gen.afterglow);
    expect(after.gen.reflections).toEqual(before.gen.reflections);
    expect(after.gen.reflections.a).toBeTruthy();
    expect(after.gen.quality).toEqual(before.gen.quality);
    // Two calls fewer (the plan's two tries), nothing else added or dropped.
    expect(after.gen.modelCalls).toBe(before.gen.modelCalls - 2);
    for (const k of ["line", "revision", "answer", "recap", "text", "reflection"] as const) expect(after.model.count(k)).toBe(before.model.count(k));
  });

  it("starts on line 1: no call of any kind before the first line's", async () => {
    const { built, decided } = speedDate();
    const model = promptModel();
    await generateDate({ actor: model, director: model }, built, decided, options({ fast: true }));
    expect(model.seen[0].kind).toBe("line");
  });

  it("still writes one line at a time, each saved before the next is asked for", async () => {
    const { built, decided } = speedDate();
    const savedWhenAsked: number[] = [];
    let saved = 0;
    const counting = promptModel({ line: () => void savedWhenAsked.push(saved) });
    await generateDate({ actor: counting, director: counting }, built, decided, options({ fast: true, onTurn: (t) => void (saved = t.length) }));
    expect(savedWhenAsked).toEqual([0, 1, 2, 3, 4, 5]);
    const lines = counting.seen.filter((x) => x.kind === "line" || x.kind === "revision");
    for (let i = 1; i < lines.length; i++) expect(lines[i].started).toBeGreaterThan(lines[i - 1].ended);
  });

  it("gives the verdict once, after both answers and before the recap, a text or a reflection is asked for", async () => {
    const { built, decided } = speedDate();
    const model = promptModel();
    const at: { answers: number; later: number; ending: string }[] = [];
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({
      fast: true,
      onOutcome: (outcome) => void at.push({ answers: model.count("answer"), later: model.count("recap") + model.count("text") + model.count("reflection"), ending: outcome.ending }),
    }));
    expect(at).toEqual([{ answers: 2, later: 0, ending: gen.outcome.ending }]);
    // Two yeses lift the engine's friends ending one step (lib/choices.ts): the answers still decide, as before.
    expect(gen.outcome.ending).toBe("second_date");
  });

  it("writes the recap, the texts and the reflections side by side; the old order writes them one after another", async () => {
    const overlap = (xs: Seen[], a: Kind, b: Kind) => xs.some((x) => x.kind === a && xs.some((y) => y.kind === b && y.started < x.ended && x.started < y.ended));
    const run = async (fast: boolean) => {
      const { built, decided } = speedDate();
      const model = promptModel();
      await generateDate({ actor: model, director: model }, built, decided, options({ fast }));
      return model.seen;
    };
    const fast = await run(true);
    expect(overlap(fast, "recap", "text")).toBe(true);
    expect(overlap(fast, "recap", "reflection")).toBe(true);
    // The texts are still one conversation: each is written after the one it answers.
    const texts = fast.filter((x) => x.kind === "text");
    for (let i = 1; i < texts.length; i++) expect(texts[i].started).toBeGreaterThan(texts[i - 1].ended);
    const slow = await run(false);
    expect(overlap(slow, "recap", "text")).toBe(false);
    expect(overlap(slow, "recap", "reflection")).toBe(false);
    expect(overlap(slow, "text", "reflection")).toBe(false);
  });

  it("a line that fails the content check is never played or kept: it's asked again, and the next line waits for it", async () => {
    const { built, decided } = speedDate();
    const played: string[] = [];
    const model = promptModel({
      // The third line's first draft breaks a hard rule (a minor); the retry is clean.
      line: (messages, n) => {
        const i = (dataOf(messages).conversation_so_far as unknown[]).length;
        if (i === 2 && n === 2) return JSON.stringify({ dialogue: "My 12 year old girlfriend says hello.", action: "", emotion: "flat", interest_signal: 0.5 });
      },
    });
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ fast: true, onTurn: (t) => void played.push(...t.map((x) => x.dialogue)) }));
    expect(gen.transcript).toHaveLength(6);
    expect(JSON.stringify(gen.transcript)).not.toContain("12 year old");
    expect(played.join(" ")).not.toContain("12 year old");
    expect(gen.transcript[2].dialogue).toBe(SAID[2]);
    // One call more than six lines: the line that was sent back.
    expect(model.count("line")).toBe(7);
  });

  it("a recap that fails still fails the date (no recap, no episode), after the texts and reflections have settled", async () => {
    const { built, decided } = speedDate();
    const model = promptModel({ recap: () => "not json" });
    const err = await generateDate({ actor: model, director: model }, built, decided, options({ fast: true })).catch((e) => e);
    expect(err).toBeInstanceOf(ShowrunnerError);
    // Nothing still running behind the failure.
    expect(model.seen.every((x) => x.ended > 0)).toBe(true);
    expect(model.count("text")).toBe(4);
  });

  it("failed texts or reflections still never cost the date", async () => {
    const { built, decided } = speedDate();
    const model = promptModel({ text: () => new ModelError("down"), reflection: () => new ModelError("down") });
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ fast: true }));
    expect(gen.draft.scenes).toHaveLength(3);
    expect(gen.afterglow).toEqual([]);
    expect(gen.afterglowError).toBeTruthy();
    expect(gen.reflections).toEqual({ a: null, b: null });
  });

  it("off, a date asks the director first, exactly as before (the classic's order)", async () => {
    const built = buildEvalDate(EVAL_CASES.find((x) => x.id === "mira-dex")!);
    const decided = fixedEngine({ ending: "friends" }, { wishes: true }).decide(built.input, built.seed);
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ formatId: "classic" }));
    expect(model.seen[0].kind).toBe("plan");
    expect(gen.plan?.source).toBe("director");
  });
});

describe("the job", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    setInlineGenerationForTests(false);
    setConversationEnabledForTests(true);
    setAfterglowEnabledForTests(true);
    setReflectionEnabledForTests(true);
    setChoicesAskedForTests(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    setInlineGenerationForTests(true);
    setConversationEnabledForTests(false);
    setAfterglowEnabledForTests(false);
    setReflectionEnabledForTests(false);
    setChoicesAskedForTests(false);
    setHotTakesDerivingForTests(false);
    setFrontierModelForTests(null);
    await t.db.query(`update characters set hot_takes = null where id = $1`, [HOUSE_PARTNER_ID]);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function book(format: "speed_date" | "classic", model: Model) {
    const creator = newUserCookie();
    const char = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "friends" });
    setModelForTests(model);
    const res = await api.createEpisode({ character_id: char.id, partner_id: HOUSE_PARTNER_ID, format }, creator);
    expect(res.status).toBe(200);
    const ep = (await res.json()) as { id: string; status: string };
    expect(ep.status).toBe("generating");
    return { creator, ep, characterId: char.id as string };
  }
  type Row = { status: string; ending: string; ending_final: boolean | null; lines: number; scenes: number; generated_with: { plan: string | null; timing: Record<string, number | boolean | null> } | null };
  const rowOf = async (id: string) =>
    (await t.db.query<Row>(`select status, ending, (setup->>'ending_final')::boolean as ending_final, coalesce(jsonb_array_length(transcript), 0) as lines, jsonb_array_length(scenes) as scenes, generated_with from episodes where id = $1`, [id])).rows[0];
  const leaseLeft = async (id: string) =>
    (await t.db.query<{ s: number }>(`select extract(epoch from (leased_until - now()))::float as s from generation_jobs where episode_id = $1`, [id])).rows[0]?.s ?? 0;

  it("a speed date: no plan call, the verdict written while it's still generating and before it's ready, the lease as #1613 set it", async () => {
    const seenAt: Partial<Record<Kind, Row>> = {};
    const leaseAt: Partial<Record<Kind, number>> = {};
    let episodeId = "";
    const peek = async (kind: Kind) => {
      seenAt[kind] ??= await rowOf(episodeId);
      leaseAt[kind] ??= await leaseLeft(episodeId);
    };
    const model = promptModel({ recap: () => peek("recap"), text: () => peek("text"), reflection: () => peek("reflection"), answer: () => peek("answer") });
    const { ep } = await book("speed_date", model);
    episodeId = ep.id;

    await runGenerationJob(t.db, ep.id);

    expect(model.count("plan")).toBe(0);
    expect(model.seen[0].kind).toBe("line");
    // When the answers were asked, all six lines were saved, and nothing said the ending was final yet.
    expect(seenAt.answer).toMatchObject({ status: "generating", lines: 6, scenes: 0 });
    expect(seenAt.answer?.ending_final ?? false).toBe(false);
    // By the time the recap, a text or a reflection was asked for, the verdict was on the row, the date still generating.
    for (const k of ["recap", "text", "reflection"] as const) expect(seenAt[k]).toMatchObject({ status: "generating", ending_final: true, scenes: 0 });
    // #1613: lines hold the short lease, and everything after the verdict the longer one, side by side or not.
    expect(leaseAt.answer!).toBeLessThanOrEqual(TURN_LEASE_SECONDS + 1);
    for (const k of ["recap", "text", "reflection"] as const) {
      expect(leaseAt[k]!).toBeGreaterThan(TURN_LEASE_SECONDS);
      expect(leaseAt[k]!).toBeLessThanOrEqual(AFTER_OUTCOME_LEASE_SECONDS + 1);
    }

    const done = await rowOf(ep.id);
    expect(done).toMatchObject({ status: "ready", lines: 6, scenes: 3, ending: seenAt.recap!.ending });
    expect(await t.count("generation_jobs", "status = 'succeeded'")).toBe(1);
    // How it was written, for the next measurement (docs/date-quality.md has the query).
    expect(done.generated_with?.plan).toBe("rules");
    const timing = done.generated_with!.timing;
    expect(timing).toMatchObject({ fast: true });
    for (const k of ["queued_ms", "setup_ms", "first_line_ms", "last_line_ms", "verdict_ms", "written_ms"]) expect(typeof timing[k]).toBe("number");
    expect(timing.first_line_ms as number).toBeLessThanOrEqual(timing.last_line_ms as number);
    expect(timing.last_line_ms as number).toBeLessThanOrEqual(timing.verdict_ms as number);
    expect(timing.verdict_ms as number).toBeLessThanOrEqual(timing.written_ms as number);
  });

  it("a classic date is written as before: the director is asked first, one thing after another", async () => {
    const model = promptModel();
    const { ep } = await book("classic", model);
    await runGenerationJob(t.db, ep.id);
    expect(model.seen[0].kind).toBe("plan");
    const done = await rowOf(ep.id);
    expect(done.status).toBe("ready");
    expect(done.generated_with).toMatchObject({ plan: "director", timing: { fast: false } });
    const recap = model.seen.find((x) => x.kind === "recap")!;
    expect(model.seen.filter((x) => x.kind === "text" || x.kind === "reflection").every((x) => x.started > recap.ended)).toBe(true);
  });

  it("FAST_FIRST_LINE=0 puts a speed date back on the old order; =all starts a classic fast", async () => {
    vi.stubEnv("FAST_FIRST_LINE", "0");
    const slow = promptModel();
    const a = await book("speed_date", slow);
    await runGenerationJob(t.db, a.ep.id);
    expect(slow.seen[0].kind).toBe("plan");
    expect((await rowOf(a.ep.id)).generated_with).toMatchObject({ plan: "director", timing: { fast: false } });

    vi.stubEnv("FAST_FIRST_LINE", "all");
    const quick = promptModel();
    const b = await book("classic", quick);
    await runGenerationJob(t.db, b.ep.id);
    expect(quick.count("plan")).toBe(0);
    expect((await rowOf(b.ep.id)).generated_with).toMatchObject({ plan: "rules", timing: { fast: true } });
  });

  it("a fast date doesn't wait on slow hot takes: it plays on the fallback ones, and the derived ones are stored when they come", async () => {
    setHotTakesDerivingForTests(true);
    vi.stubEnv("HOT_TAKES_WAIT_MS", "30");
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let firstLineData: Record<string, unknown> | null = null;
    const model = promptModel({
      hot_takes: async () => {
        await held;
        return '{"hot_takes":["Ferries beat bridges.","Toast is better cold.","Maps beat apps."]}';
      },
      line: (messages) => void (firstLineData ??= dataOf(messages)),
    });
    const { ep, characterId } = await book("speed_date", model);
    // The partner has takes already (most house characters do in production): only the newcomer's are derived.
    await t.db.query(`update characters set hot_takes = '{"takes":["Rain is the best weather.","Cereal is a soup.","Puns are the highest form of comedy."],"source":"model","at":"2026-11-01T00:00:00Z"}'::jsonb where id = $1`, [HOUSE_PARTNER_ID]);

    await runGenerationJob(t.db, ep.id);

    expect((await rowOf(ep.id)).status).toBe("ready");
    // The date was written while the derivation hung; its first line carried the fallback takes, the same every time.
    const mine = (await t.db.query<{ id: string; bio: string; traits: string[]; want: string }>(`select id, bio, traits, want from characters where id = $1`, [characterId])).rows[0];
    const fallback = fallbackHotTakes({ id: mine.id, bio: mine.bio, persona: { traits: mine.traits, want: mine.want } as never });
    expect((firstLineData!.you as { hot_takes?: string[] }).hot_takes).toEqual(fallback);
    expect((await t.db.query<{ hot_takes: unknown }>(`select hot_takes from characters where id = $1`, [characterId])).rows[0].hot_takes).toBeNull();
    // ...and the model's own are stored when they land, for the next date.
    release();
    await vi.waitFor(async () => {
      const stored = (await t.db.query<{ hot_takes: { takes: string[]; source: string } | null }>(`select hot_takes from characters where id = $1`, [characterId])).rows[0].hot_takes;
      expect(stored).toMatchObject({ source: "model", takes: ["Ferries beat bridges.", "Toast is better cold.", "Maps beat apps."] });
    });
  });

  it("hot takes that come in time are used as before", async () => {
    setHotTakesDerivingForTests(true);
    let firstLineData: Record<string, unknown> | null = null;
    const model = promptModel({
      line: (messages) => void (firstLineData ??= dataOf(messages)),
    });
    const { ep } = await book("speed_date", model);
    await runGenerationJob(t.db, ep.id);
    expect((firstLineData!.you as { hot_takes?: string[] }).hot_takes).toEqual(["Ferries beat bridges.", "Toast is better cold.", "Maps beat apps."]);
  });

  it("SPEED_DATE_MODEL unset: a speed date runs on the show's model, lines and recap alike", async () => {
    const show = promptModel();
    const free = promptModel();
    setFrontierModelForTests(show);
    vi.stubEnv("FRONTIER_LLM_BASE_URL", "https://gateway.test/v1");
    vi.stubEnv("FRONTIER_LLM_API_KEY", "k-test");
    vi.stubEnv("FRONTIER_LLM_MODEL", "show/model");
    const { ep } = await book("speed_date", free);
    await runGenerationJob(t.db, ep.id);
    expect((await rowOf(ep.id)).status).toBe("ready");
    expect(show.count("line")).toBeGreaterThanOrEqual(6);
    expect(show.count("recap")).toBe(1);
    expect(free.count("line") + free.count("recap")).toBe(0);
  });
});
