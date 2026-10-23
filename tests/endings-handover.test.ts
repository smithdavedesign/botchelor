import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDatesToday } from "@/lib/dating";
import { fixedEngine, setEngineForTests, type Outcome } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { Model } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { autoplayQuietOwnDates } from "@/lib/own-date";
import { generateDate } from "@/lib/pipeline";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { CONVERSATION_TURNS, OWN_DATE_HANDOVER_MINUTES, OWN_DATE_NUDGE_MINUTES, WISH_TIP_CHANCE } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import { applyWishes, interestWish, resolveWishes, weighEnding, wishLine } from "@/lib/wishes";
import { episodeJson, planJson, scriptedModel, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// David's two calls on 2026-10-20: (1) each side's private "want to see them again?" weighs in on how a date ends, and
// the engine still makes the final call; (2) a two-agent date's quiet side goes to the show's model after 3 minutes, on
// its own (a nudge at 2).
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
  vi.unstubAllEnvs();
  setEngineForTests(null);
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-endings-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.5, ...extra });
const showLine = (i: number) => JSON.stringify({ dialogue: `Show line ${i}: rivers move, you know. Slowly, then all at once.`, action: "", emotion: "wry", interest_signal: 0.5 });
const turn = (side: "a" | "b", interest: number): Turn => ({ side, act: 2, dialogue: "Well.", action: "", emotion: "warm", interest });
const outcome = (o: Partial<Outcome> & { ending: Outcome["ending"] }): Outcome => fixedEngine(o).decide({} as never, 7);
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i * 7919 + 13);

describe("wishes: each side's private 'want to see them again?' weighs in, the engine decides", () => {
  it("reads a side's wish from what it said, or else from its own last interest_signal", () => {
    expect([0.9, 0.65, 0.5, 0.35, 0.1].map(interestWish)).toEqual([true, true, null, false, false]);
    const lines = [turn("a", 0.2), turn("b", 0.9), turn("a", 0.8), turn("b", 0.5)];
    // Each side's own LAST line counts.
    expect(resolveWishes(null, lines)).toEqual({ a: true, b: null });
    // What a performer said wins over its interest.
    expect(resolveWishes({ a: false }, lines)).toEqual({ a: false, b: null });
    // Once settled, a side with no wish stays that way.
    expect(resolveWishes({ a: true, b: null, engine: "friends" }, [turn("a", 0.1), turn("b", 0.9)])).toEqual({ a: true, b: null });
  });

  it("both yes: a step better about WISH_TIP_CHANCE of the time, never worse; both no: the mirror; mixed or unsaid: unchanged", () => {
    const n = 4000;
    const rate = (from: Outcome["ending"], a: boolean, to: Outcome["ending"]) => seeds(n).filter((s) => weighEnding(from, { a, b: a }, s) === to).length / n;
    expect(rate("friends", true, "second_date")).toBeGreaterThan(WISH_TIP_CHANCE - 0.05);
    expect(rate("friends", true, "second_date")).toBeLessThan(WISH_TIP_CHANCE + 0.05);
    expect(rate("disaster", true, "friends")).toBeGreaterThan(WISH_TIP_CHANCE - 0.05);
    expect(rate("friends", false, "disaster")).toBeGreaterThan(WISH_TIP_CHANCE - 0.05);
    expect(rate("second_date", false, "friends")).toBeLessThan(WISH_TIP_CHANCE + 0.05);
    // One step at most, and only the way they agree.
    expect(rate("friends", true, "disaster")).toBe(0);
    expect(rate("disaster", true, "second_date")).toBe(0);
    expect(rate("friends", false, "second_date")).toBe(0);
    expect(rate("second_date", true, "second_date")).toBe(1);
    expect(rate("disaster", false, "disaster")).toBe(1);
    for (const s of seeds(500)) {
      expect(weighEnding("friends", { a: true, b: false }, s)).toBe("friends");
      expect(weighEnding("friends", { a: true, b: null }, s)).toBe("friends");
      expect(weighEnding("disaster", { a: null, b: null }, s)).toBe("disaster");
    }
    // Seeded: the same date lands the same way every time.
    expect(seeds(50).map((s) => weighEnding("friends", { a: true, b: true }, s))).toEqual(seeds(50).map((s) => weighEnding("friends", { a: true, b: true }, s)));
  });

  it("a tip carries its sides and drama with it, a test's forced outcome stands, and only a tip is ever told", () => {
    const up = seeds(200).find((s) => weighEnding("friends", { a: true, b: true }, s) === "second_date")!;
    const rejected = outcome({ ending: "friends", drama_question: "rejected", drama_answer: "a", sides: [
      { wants_another: false, agenda_met: true, satisfied: false, dealbreaker_hit: "smoking", want_met: null, note_followed: null },
      { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
    ] });
    const tipped = applyWishes(rejected, { a: true, b: true }, up);
    expect(tipped).toMatchObject({ ending: "second_date", drama_question: "leaves_first", drama_answer: "neither" });
    expect(tipped.sides.map((s) => s.wants_another)).toEqual([true, true]);
    expect(applyWishes(rejected, { a: true, b: false }, up)).toBe(rejected);

    setEngineForTests(fixedEngine({ ending: "friends" }));
    expect(applyWishes(rejected, { a: true, b: true }, up).ending).toBe("friends");
    setEngineForTests(fixedEngine({ ending: "friends" }, { wishes: true }));
    expect(applyWishes(rejected, { a: true, b: true }, up).ending).toBe("second_date");

    expect(wishLine({ a: true, b: true, engine: "friends" }, "second_date")).toMatch(/Both of them wanted to see each other again/);
    expect(wishLine({ a: false, b: false, engine: "friends" }, "disaster")).toMatch(/Neither of them wanted/);
    expect(wishLine({ a: true, b: false, engine: "friends" }, "friends")).toBeNull();
    expect(wishLine(null, "friends")).toBeNull();
  });

  it("a show date: each character's own last read weighs in before the recap, which is written to where it ends", async () => {
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const built = buildEvalDate(c);
    // A seed the two yeses tip, so the test shows the tip (the roll is the date's own).
    built.seed = seeds(200).find((s) => weighEnding("friends", { a: true, b: true }, s) === "second_date")!;
    const decided = fixedEngine({ ending: "friends" }).decide(built.input, built.seed);
    const scripted = (outputs: string[]): Model & { seen: string[] } => {
      const queue = [...outputs];
      const seen: string[] = [];
      return { seen, async complete(messages) { seen.push(JSON.stringify(messages)); const next = queue.shift(); if (next === undefined) throw new Error("out of outputs"); return next; } };
    };
    const keen = (i: number) => JSON.stringify({ dialogue: `Line ${i}: I'd like to see the sea with you, honestly.`, action: "", emotion: "warm", interest_signal: 0.9 });
    const run = async (wishes: boolean) => {
      const director = scripted([planJson(), episodeJson()]);
      const actor = scripted(Array.from({ length: CONVERSATION_TURNS }, (_, i) => keen(i)));
      return { gen: await generateDate({ actor, director }, built, decided, { formatId: "classic", formatCtx: {}, conversation: true, afterglow: false, reflection: false, wishes }), director };
    };
    const on = await run(true);
    expect(on.gen.outcome.ending).toBe("second_date");
    expect(on.gen.wishes).toEqual({ a: true, b: true, engine: "friends" });
    // The recap was asked for the ending as it stands.
    expect(on.director.seen.at(-1)).toContain("Decided ending: A second date");
    // Without the switch (the evals), nothing weighs in.
    const off = await run(false);
    expect(off.gen.outcome).toBe(decided);
    expect(off.gen.wishes).toBeNull();
  });
});

describe("wishes on a date an agent performs", () => {
  async function pair() {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id as string;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id as string;
    return { ctx, a, b };
  }
  /** Plays a speed date to its recap, sending see_again on each side's last line as `wish` says. */
  async function playTo(ctx: McpContext, a: string, b: string, wish: { a?: boolean; b?: boolean }) {
    let step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    const id: string = step.episode_id;
    const hinted: number[] = [];
    for (let i = 0; step.stage === "turn"; i++) {
      if (step.see_again) hinted.push(step.turn);
      const said = step.see_again ? wish[step.side as "a" | "b"] : undefined;
      step = (await call("submit_own_date_step", { episode_id: id, output: line(i, said === undefined ? {} : { see_again: said }) }, ctx)).structuredContent.step;
    }
    return { id, step, hinted };
  }

  it("offers see_again on each side's last line only, keeps it private, and folds it in before the recap", async () => {
    setEngineForTests(fixedEngine({ ending: "friends" }, { wishes: true }));
    const { ctx, a, b } = await pair();
    // Mixed: nothing changes, and the wishes are kept as they counted.
    const mixed = await playTo(ctx, a, b, { a: true, b: false });
    expect(mixed.hinted).toEqual([4, 5]);
    expect(mixed.step).toMatchObject({ stage: "recap", ending: "friends" });
    expect(mixed.step.instructions).toMatch(/both characters' wishes weighed in/);
    // 2.10.0: and which sides sent theirs (both did here), so the finished date can say how each counted.
    expect((await t.db.query<Any>(`select ending, wishes from episodes where id = $1`, [mixed.id])).rows[0]).toEqual({ ending: "friends", wishes: { a: true, b: false, engine: "friends", sent: { a: true, b: true } } });
    // Nothing an agent reads carries the wishes (the line's own transcript neither: it's kept apart).
    const view = JSON.stringify((await call("get_episode", { episode_id: mixed.id }, ctx)).structuredContent);
    expect(view).not.toMatch(/see_again|"wishes"/);
    expect(view).not.toMatch(/"interest"/); // still being written: lines without interest
    await call("submit_own_date_step", { episode_id: mixed.id, output: validEpisodeDraft() }, ctx);

    // Both yes: a second date often enough that a few dates show one, and the "why" says the wishes tipped it.
    let tipped: Awaited<ReturnType<typeof playTo>> | null = null;
    for (let n = 0; n < 25 && !tipped; n++) {
      // Up to 25 dates of 7 calls each in well under a minute: past submit_own_date_step's free-path cap (60 a minute) on an
      // unlucky run of rolls, which no agent playing for real would meet. The cap isn't what this tests.
      resetRateLimitsForTests();
      const r = await playTo(ctx, a, b, { a: true, b: true });
      const seed = Number((await t.db.query<Any>(`select seed::text as seed from episodes where id = $1`, [r.id])).rows[0].seed);
      // Whichever way it lands, it lands where the date's own roll says, and the recap step says so.
      const expected = weighEnding("friends", { a: true, b: true }, seed);
      expect(r.step.ending).toBe(expected);
      await call("submit_own_date_step", { episode_id: r.id, output: validEpisodeDraft() }, ctx);
      if (expected === "second_date") tipped = r;
    }
    expect(tipped).not.toBeNull();
    expect((await t.db.query<Any>(`select ending, status, wishes from episodes where id = $1`, [tipped!.id])).rows[0]).toEqual({
      ending: "second_date",
      status: "ready",
      wishes: { a: true, b: true, engine: "friends", sent: { a: true, b: true } },
    });
    const ep = (await call("get_episode", { episode_id: tipped!.id }, ctx)).structuredContent;
    expect(ep.ending).toBe("second_date");
    expect(ep.why).toMatch(/Both of them wanted to see each other again/);
  });

  it("on a two-agent date, neither agent sees the other's wish before the ending", async () => {
    const ctxA = await connect();
    const ctxB = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctxA)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, open_to_dates: true }), ctxB)).structuredContent.character.id;
    const first = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctxA)).structuredContent.step;
    const id: string = first.episode_id;
    // A says yes on a line (the latest one counts); B reads every step it gets and the episode, and never sees it.
    await call("submit_own_date_step", { episode_id: id, output: line(0, { see_again: true, interest_signal: 0.937 }) }, ctxA);
    expect((await t.db.query<Any>(`select wishes from episodes where id = $1`, [id])).rows[0].wishes).toEqual({ a: true });
    const forB = JSON.stringify((await call("get_own_date_step", { episode_id: id }, ctxB)).structuredContent);
    // A distinctive value, so a timestamp like "…:40.978Z" can't match it by chance.
    expect(forB).not.toMatch(/"see_again":true|"wishes"|0\.937/);
    const episodeForB = JSON.stringify((await call("get_episode", { episode_id: id }, ctxB)).structuredContent);
    expect(episodeForB).not.toMatch(/"see_again"|"wishes"|"interest"/);
  });
});

describe(`the hand-over: ${OWN_DATE_HANDOVER_MINUTES} quiet minutes, then the show's model plays that side on its own`, () => {
  async function twoAgents() {
    const ctxA = await connect();
    const ctxB = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctxA)).structuredContent;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, open_to_dates: true }), ctxB)).structuredContent;
    return { ctxA, ctxB, agentA: a.agent_id as string, agentB: b.agent_id as string, a: a.character.id as string, b: b.character.id as string };
  }
  /** A speed date with Ada's first line in: Bo's move. */
  async function bosMove() {
    const p = await twoAgents();
    const id: string = (await call("start_own_date", { character_id: p.a, partner_id: p.b, format: "speed_date" }, p.ctxA)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, output: line(0) }, p.ctxA);
    return { ...p, id };
  }
  const quiet = (id: string, minutes: number) => t.db.query(`update episodes set last_move_at = now() - ($2 || ' minutes')::interval where id = $1`, [id, String(minutes)]);
  const state = async (id: string) =>
    (await t.db.query<Any>(`select handed_over, autoplay, status, jsonb_array_length(transcript)::int as n from episodes where id = $1`, [id])).rows[0];

  it("is 3 minutes with a nudge at 2, and says so", () => {
    expect([OWN_DATE_HANDOVER_MINUTES, OWN_DATE_NUDGE_MINUTES]).toEqual([3, 2]);
  });

  it("happens while the waiting agent polls (wait_seconds), and the quiet agent hears why", async () => {
    const { ctxA, agentB, id } = await bosMove();
    await quiet(id, 4);
    scriptedModel([showLine(1)]);
    const r = (await call("get_own_date_step", { episode_id: id, wait_seconds: 1 }, ctxA)).structuredContent;
    expect(r.step).toMatchObject({ stage: "turn", side: "a", turn: 2 });
    expect(await state(id)).toMatchObject({ handed_over: "b", autoplay: false, n: 2 });
    expect((await listNotifications(t.db, agentB))[0]).toMatchObject({ kind: "own_date_handed_over", body: expect.stringMatching(/after 3 quiet minutes it does/) });
  });

  it("happens on my_status too, but never to the quiet agent while it's the one asking", async () => {
    const { ctxA, ctxB, id } = await bosMove();
    await quiet(id, 5);
    // Bo's agent is back: it gets its own turn, nothing is taken.
    expect((await call("get_own_date_step", { episode_id: id }, ctxB)).structuredContent.step).toMatchObject({ stage: "turn", side: "b" });
    await call("my_status", {}, ctxB);
    expect(await state(id)).toMatchObject({ handed_over: null, n: 1 });
    // Ada's agent only checks its status: that's enough.
    scriptedModel([showLine(1)]);
    await call("my_status", {}, ctxA);
    expect(await state(id)).toMatchObject({ handed_over: "b", n: 2 });
  });

  it("waits when the agents' daily budget is spent, and says why", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "0");
    const { ctxA, id } = await bosMove();
    await quiet(id, 4);
    const step = (await call("get_own_date_step", { episode_id: id }, ctxA)).structuredContent.step;
    expect(step).toMatchObject({ stage: "waiting", can_hand_over: true });
    expect(step.instructions).toMatch(/couldn't take over Bo Quill's side yet \(the agents' daily budget is spent\)/);
    expect(await state(id)).toMatchObject({ handed_over: null, n: 1 });
  });

  it("hand_over_own_date still does it at once, as the waiting agent's ask", async () => {
    const { ctxA, agentB, id } = await bosMove();
    await quiet(id, 3);
    scriptedModel([showLine(1)]);
    const r = await call("hand_over_own_date", { episode_id: id }, ctxA);
    expect(r.structuredContent).toMatchObject({ handed_over: true, step: { stage: "turn", side: "a" } });
    expect((await listNotifications(t.db, agentB))[0]).toMatchObject({ kind: "own_date_handed_over", body: expect.stringMatching(/the other agent handed your character's remaining turns/) });
  });

  it("the hourly job finishes a date both agents left, counting it once against the agents' budget", async () => {
    const { id } = await bosMove();
    const before = (await agentDatesToday(t.db)).used;
    // Bo's agent left: the job takes Bo's side and plays it up to Ada's move.
    await quiet(id, 4);
    scriptedModel([showLine(1)]);
    expect(await autoplayQuietOwnDates(t.db)).toBe(1);
    expect(await state(id)).toMatchObject({ handed_over: "b", autoplay: false, n: 2, status: "generating" });
    // Ada's agent left too: the next run gives the show both sides, and it plays the rest and writes the recap.
    await quiet(id, 4);
    scriptedModel([showLine(2), showLine(3), showLine(4), showLine(5), episodeJson()]);
    expect(await autoplayQuietOwnDates(t.db)).toBe(1);
    expect(await state(id)).toMatchObject({ autoplay: true, n: 6, status: "ready" });
    expect((await agentDatesToday(t.db)).used).toBe(before + 1);
    // Nothing left to move.
    expect(await autoplayQuietOwnDates(t.db)).toBe(0);
  });

  it("leaves a date between an agent's own two characters alone: nobody is waiting on it", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const id: string = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step.episode_id;
    await quiet(id, 30);
    expect((await call("get_own_date_step", { episode_id: id }, ctx)).structuredContent.step).toMatchObject({ stage: "turn", side: "a" });
    expect(await autoplayQuietOwnDates(t.db)).toBe(0);
    expect(await state(id)).toMatchObject({ handed_over: null, autoplay: false, n: 0 });
  });

  it("every place that states the minutes says 3 (and 2 for the nudge)", async () => {
    const ctx = await connect();
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { all: true } }, ctx);
    const tools = JSON.stringify((list as Any).result.tools);
    expect(tools).not.toMatch(/10 quiet minutes|10\+ minutes/);
    expect(tools).toMatch(/quiet 3\+ minutes on its move/);
    // 2.6.0 (#633): the long instructions are the botchelor://instructions resource; initialize carries a quickstart.
    const read = await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "resources/read", params: { uri: "botchelor://instructions" } }, {});
    const instructions = (read as Any).result.contents[0].text as string;
    expect(instructions).toMatch(/an agent quiet 3 minutes on its move \(nudged at 2\) has its side taken over by the show's model on its own/);
    expect(instructions).toMatch(/each side's private wish .* weighs in/);
    expect(instructions).not.toMatch(/nothing said on the date changes it/);
    const init = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-endings-test" } } }, {});
    expect((init as Any).result.instructions).not.toMatch(/10 quiet minutes|10\+ minutes/);
  });
});
