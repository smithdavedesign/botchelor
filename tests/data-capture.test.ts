// Data plan Tier 1, part one (David, 2026-10-22): the data the show used to lose. A pair's stage changes become a
// timeline (relationship_events), a deck logs what it showed (swipe_impressions), a match answer says where it came
// from (agent vs the synthetic coin vs the house), every date stores why the engine decided it (engine_trace), and
// each transcript line has when and by whom (turn_meta). Recording never changes an outcome.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as swipesRoute from "@/app/api/swipes/route";
import { exportAccount } from "@/lib/account";
import { decideTraced, deterministicEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type SideSetup } from "@/lib/engine";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { refreshRelationship } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { answerMatch, deckFor, logImpressions, swipe } from "@/lib/swipes";
import { setEngineForTests } from "@/lib/engine";
import { setModelForTests } from "@/lib/model";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

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
  it("a web deck logs every card it served, ranked 1..N, one serve id, with scores", async () => {
    const me = await person("Wren Kestrel");
    await person("Pim Alder");
    const res = await swipesRoute.GET(new Request(`${BASE_URL}/api/swipes?character_id=${me.id}`, { headers: { cookie: me.cookie } }));
    const body = await res.json();
    expect(body.scores).toBeUndefined(); // the scores never leave the server
    const rows = await impressions(me.id);
    expect(rows.map((r) => r.card)).toEqual(body.cards.map((c: Any) => c.id));
    expect(rows.map((r) => r.rank)).toEqual(body.cards.map((_: unknown, i: number) => i + 1));
    expect(new Set(rows.map((r) => r.serve_id)).size).toBe(1);
    expect(rows.every((r) => r.served_via === "web" && typeof r.score === "number")).toBe(true);
  });

  it("a link prefetch isn't a person looking: nothing is logged", async () => {
    const me = await person("Wren Kestrel");
    await swipesRoute.GET(new Request(`${BASE_URL}/api/swipes?character_id=${me.id}`, { headers: { cookie: me.cookie, "next-router-prefetch": "1" } }));
    expect(await impressions(me.id)).toHaveLength(0);
  });

  it("an MCP deck logs only the cards left after the agent's filter", async () => {
    const a = await agent("Ira Fenn");
    await person("Pim Alder");
    const ctx: McpContext = {};
    const all = (await rpc("swipe_deck", { agent_id: a.userId, character_id: a.id }, ctx)).structuredContent;
    expect((await impressions(a.id)).filter((r) => r.served_via === "mcp").map((r) => r.card)).toEqual(all.cards.map((c: Any) => c.id));
  });

  it("a failed log never costs anyone their deck", async () => {
    const me = await person("Wren Kestrel");
    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    const broken = { ...t.db, query: async () => Promise.reject(new Error("db down")) } as typeof t.db;
    await expect(logImpressions(broken, me.id, deck.cards, deck.scores, "web")).resolves.toBeUndefined();
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
});
