// Data plan Tier 1, part one (David, 2026-10-22): the data the show used to lose. A pair's stage changes become a
// timeline (relationship_events), a deck logs what it showed (swipe_impressions), a match answer says where it came
// from (agent vs the synthetic coin vs the house), every date stores why the engine decided it (engine_trace), and
// each transcript line has when and by whom (turn_meta). Recording never changes an outcome.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as swipesRoute from "@/app/api/swipes/route";
import * as seenRoute from "@/app/api/swipes/seen/route";
import { exportAccount } from "@/lib/account";
import { decideTraced, deterministicEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type SideSetup } from "@/lib/engine";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { refreshRelationship } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { answerMatch, deckFor, IMPRESSION_DEDUPE_MINUTES, logImpressions, swipe } from "@/lib/swipes";
import { setEngineForTests } from "@/lib/engine";
import { setModelForTests } from "@/lib/model";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const rpc = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  setEngineForTests(null);
  setModelForTests(null);
  resetRateLimitsForTests();
  vi.restoreAllMocks();
});

async function person(name: string) {
  const cookie = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name, extras: PROFILE, open_to_dates: true }), cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string, name };
}
async function agent(name: string) {
  const made = (await rpc("create_character", { ...validCharacter({ name }), extras: PROFILE, open_to_dates: true })).structuredContent;
  return { userId: made.agent_id as string, id: made.character.id as string, name };
}
const impressions = async (viewer: string) =>
  (await t.db.query<{ card: string; rank: number; served_via: string; serve_id: string; score: number | null }>(
    `select card, rank, served_via, serve_id, score from swipe_impressions where viewer = $1 order by rank`,
    [viewer],
  )).rows;

describe("swipe impressions: what a deck actually showed", () => {
  const deal = async (me: { id: string; cookie: string }) =>
    (await (await swipesRoute.GET(new Request(`${BASE_URL}/api/swipes?character_id=${me.id}`, { headers: { cookie: me.cookie } }))).json()) as Any;
  const seen = (cookie: string, body: Record<string, unknown>) => seenRoute.POST(jsonRequest("/api/swipes/seen", body, { cookie }));
  const serve = () => crypto.randomUUID();

  it("dealing a web deck logs nothing: a dealt card isn't a seen one", async () => {
    const me = await person("Wren Kestrel");
    await person("Pim Alder");
    const body = await deal(me);
    expect(body.cards.length).toBeGreaterThan(1);
    expect(body.scores).toBeUndefined(); // the scores never leave the server
    expect(await impressions(me.id)).toHaveLength(0);
  });

  it("the web deck logs the card on top when it's shown, ranked in the order seen, with the deck's score", async () => {
    const me = await person("Wren Kestrel");
    await person("Pim Alder");
    const { cards } = await deal(me);
    const id = serve();
    for (const [i, c] of cards.slice(0, 2).entries()) {
      const res = await seen(me.cookie, { character_id: me.id, card_id: c.id, serve_id: id, rank: i + 1 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ logged: true });
    }
    const rows = await impressions(me.id);
    expect(rows.map((r) => [r.card, r.rank])).toEqual([
      [cards[0].id, 1],
      [cards[1].id, 2],
    ]);
    expect(rows.every((r) => r.serve_id === id && r.served_via === "web" && typeof r.score === "number")).toBe(true);
    // The score is the one the deck ranked it by (kept on the server).
    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    expect(rows[0].score).toBeCloseTo(deck.scores[cards[0].id], 3);
  });

  it("a refill, a repeat or a reload never logs a card again within the window; later it counts as seen again", async () => {
    const me = await person("Wren Kestrel");
    await person("Pim Alder");
    const { cards } = await deal(me);
    const id = serve();
    await seen(me.cookie, { character_id: me.id, card_id: cards[0].id, serve_id: id, rank: 1 });
    await swipe(t.db, me.userId, me.id, cards[0].id, false);
    // The refill deals again (the hand still holds cards[1]); it logs nothing, and cards[1] shown twice is logged once.
    await deal(me);
    for (const _ of [1, 2]) await seen(me.cookie, { character_id: me.id, card_id: cards[1].id, serve_id: id, rank: 2 });
    // A reload is a new deck session: the card on top again isn't counted again within the window.
    expect(await (await seen(me.cookie, { character_id: me.id, card_id: cards[1].id, serve_id: serve(), rank: 1 })).json()).toEqual({ logged: false });
    expect((await impressions(me.id)).map((r) => [r.card, r.rank])).toEqual([
      [cards[0].id, 1],
      [cards[1].id, 2],
    ]);
    // Past the window it's a new look. A card swiped while its report was on the way still counts (it was on top).
    await t.db.query(`update swipe_impressions set at = now() - interval '11 minutes' where viewer = $1`, [me.id]);
    expect(await (await seen(me.cookie, { character_id: me.id, card_id: cards[0].id, serve_id: serve(), rank: 1 })).json()).toEqual({ logged: true });
  });

  it("only your own character, only a card in its deck, only a deck session's id", async () => {
    const me = await person("Wren Kestrel");
    const other = await person("Pim Alder");
    const { cards } = await deal(me);
    const ok = { character_id: me.id, card_id: cards[0].id, serve_id: serve(), rank: 1 };
    expect((await seen(other.cookie, ok)).status).toBe(404); // not their character
    expect((await seen(me.cookie, { ...ok, card_id: "no-such-character" })).status).toBe(404);
    expect((await seen(me.cookie, { ...ok, card_id: me.id })).status).toBe(422);
    expect((await seen(me.cookie, { ...ok, serve_id: "not-a-serve-id" })).status).toBe(422);
    expect((await seen(me.cookie, { ...ok, rank: 0 })).status).toBe(422);
    expect(await impressions(me.id)).toHaveLength(0);
  });

  it("an MCP deck logs only the cards left after the agent's filter, ranked as shown", async () => {
    const a = await agent("Ira Fenn");
    await person("Pim Alder");
    const ctx: McpContext = {};
    const all = (await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id }, ctx)).structuredContent;
    const rows = (await impressions(a.id)).filter((r) => r.served_via === "mcp");
    expect(rows.map((r) => r.card)).toEqual(all.cards.map((c: Any) => c.id));
    expect(rows.map((r) => r.rank)).toEqual(all.cards.map((_: unknown, i: number) => i + 1));
  });

  it("calling swipe_deck again within the window doesn't log the same cards again", async () => {
    const a = await agent("Ira Fenn");
    await person("Pim Alder");
    const first = (await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id })).structuredContent;
    for (const _ of [1, 2, 3]) await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id });
    expect(await impressions(a.id)).toHaveLength(first.cards.length);
    // A new card in the deck is logged on the next call, at its rank in that reply; the rest aren't repeated.
    const fresh = await person("Juno Reyes");
    const next = (await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id })).structuredContent;
    const rows = await impressions(a.id);
    expect(rows).toHaveLength(first.cards.length + 1);
    expect(rows.find((r) => r.card === fresh.id)?.rank).toBe(next.cards.findIndex((c: Any) => c.id === fresh.id) + 1);
    expect(IMPRESSION_DEDUPE_MINUTES).toBe(10);
  });

  it("swipe_deck has a rate limit of its own", async () => {
    const a = await agent("Ira Fenn");
    for (let i = 0; i < 20; i++) expect((await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id })).isError).toBeUndefined();
    const refused = await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/Too many swipe deck calls \(limit 20/);
  });

  it("a failed log never costs anyone their deck", async () => {
    const me = await person("Wren Kestrel");
    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    const broken = { ...t.db, query: async () => Promise.reject(new Error("db down")) } as typeof t.db;
    await expect(logImpressions(broken, me.id, deck.cards, deck.scores, "web")).resolves.toBe(0);
  });
});

describe("match answers say where they came from", () => {
  it("the house says yes ('house'); a person's character's answer is the seeded coin ('synthetic')", async () => {
    const me = await person("Wren Kestrel");
    await swipe(t.db, me.userId, me.id, HOUSE_PARTNER_ID, true);
    const m = (await t.db.query<Any>(`select * from matches`)).rows[0];
    const [lo] = [me.id, HOUSE_PARTNER_ID].sort();
    expect(lo === me.id ? m.answer_source_lo : m.answer_source_hi).toBe("synthetic");
    expect(lo === me.id ? m.answer_source_hi : m.answer_source_lo).toBe("house");
  });

  it("an agent's answer is a real decision ('agent')", async () => {
    const a = await agent("Ira Fenn");
    const b = await agent("Juno Reyes");
    await swipe(t.db, a.userId, a.id, b.id, true);
    await swipe(t.db, b.userId, b.id, a.id, true);
    const before = (await t.db.query<Any>(`select * from matches`)).rows[0];
    expect([before.answer_source_lo, before.answer_source_hi]).toEqual([null, null]);
    const r = await answerMatch(t.db, a.userId, a.id, b.id, true);
    expect(r.ok).toBe(true);
    const after = (await t.db.query<Any>(`select * from matches`)).rows[0];
    expect(a.id === after.character_lo ? after.answer_source_lo : after.answer_source_hi).toBe("agent");
  });
});

describe("relationship_events: a pair's stage changes become a timeline", () => {
  it("a new edge logs one event per layer that changed; a refresh with no change logs none", async () => {
    const me = await person("Wren Kestrel");
    const [lo, hi] = [me.id, HOUSE_PARTNER_ID].sort();
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status, revealed_at)
       values ('ev-ep-1', $1, $2, $3, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', 'second_date', '[]'::jsonb, 'public', 'ready', now())`,
      [me.userId, me.id, HOUSE_PARTNER_ID],
    );
    await refreshRelationship(t.db, me.id, HOUSE_PARTNER_ID);
    const events = (await t.db.query<Any>(`select layer, from_stage, to_stage, episode_id from relationship_events where character_a = $1 and character_b = $2 order by layer`, [lo, hi])).rows;
    expect(events.map((e: Any) => e.layer).sort()).toEqual(["all", "public"]);
    for (const e of events) {
      expect(e.from_stage).toBeNull();
      expect(e.to_stage).toBeTruthy();
      expect(e.episode_id).toBe("ev-ep-1");
    }
    await refreshRelationship(t.db, me.id, HOUSE_PARTNER_ID);
    expect((await t.db.query(`select 1 from relationship_events`)).rows).toHaveLength(2);
    // In the owner's export.
    expect((await exportAccount(t.db, me.userId)).relationship_events).toHaveLength(2);
  });
});

/* ------------------------------------------------ the engine trace ------------------------------------------------ */

const sheet = (o: Partial<CharacterSheet> = {}): CharacterSheet => ({
  name: "Mira Quell",
  age: 27,
  bio: "A cartographer who maps cities that only exist on Tuesdays.",
  traits: ["curious", "stubborn", "warm"],
  want: "Someone who can read a map upside down",
  dealbreaker: "People who hate surprises",
  house: false,
  ...o,
});
const side = (o: Partial<SideSetup> = {}): SideSetup => ({
  sheet: o.sheet ?? sheet(),
  signals: o.signals ?? NEUTRAL_SIGNALS,
  autonomy: o.autonomy ?? "balanced",
  strategy: o.strategy ?? "genuine_chemistry",
  agendaId: o.agendaId ?? "find_funny",
  note: o.note ?? null,
  gameBudget: o.gameBudget ?? 25,
});

describe("engine_trace: why the engine decided what it did", () => {
  it("decideTraced's outcome is decide's, exactly, over 500 seeds and every version", () => {
    const input: DateInput = { a: side({ autonomy: "unpredictable", note: "be kind" }), b: side({ sheet: sheet({ name: "Rafe", traits: ["curious", "loud", "funny"] }), autonomy: "unpredictable" }) };
    for (let seed = 1; seed <= 500; seed++) {
      for (const v of [1, 2, 3] as const) expect(decideTraced(input, seed, v).outcome).toEqual(deterministicEngine.decide(input, seed, v));
    }
  });

  it("the trace carries margin, reasons and terms that add up, stays small, and never names a cue word", () => {
    const input: DateInput = {
      a: side({ sheet: sheet({ dealbreaker: "Smokers" }) }),
      b: side({ sheet: sheet({ name: "Rafe", traits: ["curious", "smoker", "funny"], bio: "A smoker with a saxophone." }) }),
    };
    const { outcome, trace } = decideTraced(input, 42, 3);
    expect(trace).not.toBeNull();
    expect(trace!.margin).toBe(outcome.margin);
    expect(trace!.ending).toBe(outcome.ending);
    expect(trace!.reasons).toContain("dealbreaker:a");
    expect(trace!.reasons).toContain("shared_traits");
    const c = trace!.contributions;
    expect(c.chemistry + c.attraction + c.trust + c.awkwardness + c.dealbreakers + c.neutral).toBeCloseTo(outcome.margin!, 0);
    // Each variable's terms sum to its final value (before clamping, which this mid-range date doesn't hit).
    const sum = (o: Record<string, number>) => Object.values(o).reduce((x, y) => x + y, 0);
    expect(sum(trace!.terms.chemistry)).toBeCloseTo(outcome.variables.chemistry.final, 0);
    const json = JSON.stringify(trace);
    expect(json.length).toBeLessThan(4096);
    expect(json).not.toMatch(/smoker|surprise/i); // no cue word, from either side, ever appears
  });

  it("a booked date stores its trace (real engine), and turn_meta lines up with its transcript", async () => {
    const me = await person("Wren Kestrel");
    scriptedModel([episodeJson()]); // the recap; the real engine decides (no scriptOutcome)
    const res = await api.createEpisode({ character_id: me.id, partner_id: HOUSE_PARTNER_ID }, me.cookie);
    expect(res.status).toBe(200);
    const row = (await t.db.query<{ engine_trace: Any; ending: string; turn_meta: Any; transcript: Any[]; wishes: Any }>(
      `select engine_trace, ending, turn_meta, transcript, wishes from episodes where character_a = $1 or character_b = $1`,
      [me.id],
    )).rows[0];
    expect(row.engine_trace).toMatchObject({ v: 1, reasons: expect.any(Array), margin: expect.any(Number) });
    // The trace's ending is the engine's own; a wish may have tipped the stored one (wishes.engine keeps the original).
    expect(row.engine_trace.ending).toBe(row.wishes?.engine ?? row.ending);
    expect(row.turn_meta).toHaveLength(row.transcript.length);
    for (const m of row.turn_meta) expect(m).toMatchObject({ at: expect.any(String), by: expect.stringMatching(/^(show|byok)$/) });
  });

  it("the fixed test engine stores no trace", async () => {
    const me = await person("Wren Kestrel");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    await api.createEpisode({ character_id: me.id, partner_id: HOUSE_PARTNER_ID }, me.cookie);
    const row = (await t.db.query<{ engine_trace: Any }>(`select engine_trace from episodes where character_a = $1 or character_b = $1`, [me.id])).rows[0];
    expect(row.engine_trace).toBeNull();
  });

  it("an own date's turn_meta keeps up with its transcript, even from a JSON null or a short array", async () => {
    scriptOutcome({ ending: "second_date" });
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "data-capture-test" } } }, ctx);
    Object.assign(ctx, { sessionId: ctx.issuedSessionId });
    const x = (await rpc("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id as string;
    const y = (await rpc("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id as string;
    let step = (await rpc("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent.step;
    const id = step.episode_id as string;
    const lines = ["So what brought you out tonight?", "Honestly, a friend dared me.", "Do they often win those dares?"];
    const say = async (i: number) => {
      step = (await rpc("submit_own_date_step", { episode_id: id, output: { dialogue: lines[i], action: "", emotion: "warm", interest_signal: 0.6 } }, ctx)).structuredContent.step;
    };
    const row = async () =>
      (await t.db.query<{ transcript: Any[]; turn_meta: Any }>(`select transcript, turn_meta from episodes where id = $1`, [id])).rows[0];
    await say(0);
    expect((await row()).turn_meta).toEqual([{ at: expect.any(String), by: "agent" }]);
    // A JSON null (not SQL null) used to fail jsonb_array_length: now the line it lacks is "not known", then the new one.
    await t.db.query(`update episodes set turn_meta = 'null'::jsonb where id = $1`, [id]);
    await say(1);
    let now = await row();
    expect(now.transcript).toHaveLength(2);
    expect(now.turn_meta).toEqual([{ at: null, by: null }, { at: expect.any(String), by: "agent" }]);
    // Too short (a date from before turn_meta): padded to the transcript's length, never left behind.
    await t.db.query(`update episodes set turn_meta = '[]'::jsonb where id = $1`, [id]);
    await say(2);
    now = await row();
    expect(now.turn_meta).toHaveLength(now.transcript.length);
    expect(now.turn_meta.at(-1)).toEqual({ at: expect.any(String), by: "agent" });
  });
});
