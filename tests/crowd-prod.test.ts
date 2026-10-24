import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postSwipe } from "@/app/api/swipes/route";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setWelcomeFromForTests } from "@/lib/welcome";
import * as P from "../scripts/crowd/policy.mjs";
import { runCrowdPass } from "../scripts/crowd/prod-crowd.mjs";
import { api, jsonRequest, newUserCookie, startTestDb, validCharacter } from "./helpers";

// The production house crowd (scripts/crowd, docs/house-crowd.md): its policy, and whole passes against the app.
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
  // The welcome experiment (lib/welcome.ts) would like a person's character from the server side: off, so every like
  // these tests count is the crowd's own.
  setWelcomeFromForTests("2099-01-01T00:00:00Z");
});
afterEach(() => {
  setWelcomeFromForTests(null);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** A seeded uniform generator (mulberry32), so the bandit's draws repeat. */
function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the crowd's policy", () => {
  it("names each bot's client after its character, house-run", () => {
    expect(P.clientFor("Unit Marigold-7")).toBe("botchelor-loop-crowd-marigold");
    expect(P.clientFor("Soren Valdís")).toBe("botchelor-loop-crowd-soren");
    expect(P.clientFor("Saoirse Kinsella").startsWith("botchelor-loop-")).toBe(true);
  });

  it("likes back, likes some agents, and never likes a person or another bot first", () => {
    expect(P.swipeDecision({ id: "p1", run_by: "person", liked_you: true }, "b")).toBe("like_back");
    expect(P.swipeDecision({ id: "p1", run_by: "person", liked_you: false }, "b")).toBe("skip");
    expect(P.swipeDecision({ id: "x", run_by: "house_bot", house_bot: true, liked_you: true }, "b")).toBe("skip");
    expect(P.swipeDecision({ id: "h", house: true }, "b")).toBe("skip");
    const agents = Array.from({ length: 40 }, (_, i) => P.swipeDecision({ id: `a${i}`, run_by: "agent" }, "bot-1"));
    expect(agents.filter((d: string) => d === "like").length).toBeGreaterThan(8);
    expect(agents.filter((d: string) => d === "skip").length).toBeGreaterThan(8);
    expect(P.swipeDecision({ id: "a3", run_by: "agent" }, "bot-1")).toBe(P.swipeDecision({ id: "a3", run_by: "agent" }, "bot-1"));
  });

  it("keeps each bot awake 17 hours a day, at its own hours", () => {
    const day = Date.parse("2026-10-24T00:00:00Z");
    const hours = (id: string) => Array.from({ length: 24 }, (_, h) => P.isAwake(id, day + h * 3600_000));
    expect(hours("bot-a").filter(Boolean)).toHaveLength(17);
    const sleepy = ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => hours(`bot-${x}`).indexOf(false));
    expect(new Set(sleepy).size).toBeGreaterThan(1); // not everyone asleep at once
  });

  it("the bandit plays the winner more, and reports the chance each is best", () => {
    const ledger = [
      ...Array.from({ length: 12 }, () => ({ dimension: "opener", variant: "question", outcome: 1 })),
      ...Array.from({ length: 12 }, () => ({ dimension: "opener", variant: "tease", outcome: 0 })),
      ...Array.from({ length: 12 }, () => ({ dimension: "opener", variant: "confession", outcome: 0 })),
      ...Array.from({ length: 3 }, () => ({ dimension: "opener", variant: "callback", outcome: null })),
    ];
    const rng = seeded(11);
    const picks = Array.from({ length: 300 }, () => P.chooseVariant(ledger, "opener", rng).id);
    expect(picks.filter((p: string) => p === "question").length).toBeGreaterThan(200);
    expect(picks).toContain("callback"); // untried: still explored
    const best = P.probabilityBest(ledger, "opener", { samples: 3000, rng });
    expect(Object.values(best).reduce((a: number, b) => a + (b as number), 0)).toBeCloseTo(1, 6);
    expect(best.question).toBeGreaterThan(0.6);
    expect(P.tally(ledger, "opener")).toMatchObject({ question: { sent: 12, replied: 12, open: 0 }, callback: { sent: 0, open: 3 } });
  });

  it("scores a text by a reply the other side wrote themselves, within a day", () => {
    const sent = "2026-10-24T10:00:00.000Z";
    const at = (h: number) => new Date(Date.parse(sent) + h * 3600_000).toISOString();
    const e = { sent_at: sent, outcome: null };
    expect(P.settle(e, [{ from: "them", written_by: "them", at: at(3) }], Date.parse(at(4)))).toBe(1);
    expect(P.settle(e, [{ from: "them", written_by: "the_show", at: at(3) }], Date.parse(at(4)))).toBeNull();
    expect(P.settle(e, [{ from: "them", written_by: "them", at: at(-1) }], Date.parse(at(4)))).toBeNull(); // before it: not a reply
    expect(P.settle(e, [{ from: "them", written_by: "them", at: at(30) }], Date.parse(at(31)))).toBe(0); // too late
    expect(P.settle(e, [], Date.parse(at(49)))).toBe(0);
    expect(P.settle({ ...e, outcome: 1 }, [], Date.parse(at(99)))).toBe(1);
  });

  it("pairs the roster for tonight: fixed by the date, nobody twice, already-paired pairs skipped", () => {
    const roster = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` }));
    const a = P.nightPairs(roster, "2026-10-24", 3);
    expect(a).toEqual(P.nightPairs(roster, "2026-10-24", 3));
    expect(a).toHaveLength(3);
    const ids = a.flat().map((b: Any) => b.id);
    expect(new Set(ids).size).toBe(6);
    const key = [a[0][0].id, a[0][1].id].sort().join(":");
    expect(P.nightPairs(roster, "2026-10-24", 3, new Set([key])).map((p: Any) => [p[0].id, p[1].id].sort().join(":"))).not.toContain(key);
    expect(P.nightPairs(roster, "2026-10-25", 3)).not.toEqual(a);
  });
});

/* ------------------------------------------- whole passes, in process ------------------------------------------- */

const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(client: string): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
async function made(client: string, name: string) {
  const ctx = await connect(client);
  const r = await call("create_character", { ...validCharacter({ name, extras: PROFILE }), open_to_dates: true }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, owner: r.structuredContent.agent_id as string, id: r.structuredContent.character.id as string, name };
}
/** The crowd's transport: MCP in process, as the HTTP one is on the Mac. */
const transport = async (body: Any, sessionId: string | null, userAgent: string) => {
  const ctx: McpContext = { sessionId, userAgent };
  const json = await handleMcpMessage(body, ctx);
  return { json, sessionId: ctx.issuedSessionId ?? sessionId };
};
/** The local model, stood in for: a fresh, plausible line every time. */
function fakeBrain() {
  let n = 0;
  const lines = [
    "Hello there, glad we matched today",
    "I spent the morning fixing a squeaky gate, and I feel like a hero",
    "What does a slow Sunday look like for you",
    "That sounds lovely, honestly, tell me more",
    "I would absolutely try that, as long as there is cake",
    "You have my full attention now, go on",
  ];
  return { enabled: true, reason: null, complete: async () => `${lines[n % lines.length]} (${++n})`, count() {}, summary: () => ({}) };
}
const awake = () => true;
const T0 = Date.parse("2026-10-24T12:00:00Z");

describe("a crowd pass against the app", () => {
  it("likes back, answers after a beat, opens and answers threads with a tested style, and never votes", async () => {
    const bots = [await made("botchelor-loop-crowd-mabel", "Mabel Ferraro"), await made("botchelor-loop-crowd-pippa", "Pippa Quarrie")];
    const roster = bots.map(({ id, owner, name }) => ({ id, owner, name }));
    const visitor = await made("claude-code", "Ada Lumen"); // an outside agent
    const fanCookie = newUserCookie();
    const fan = (await (await api.createCharacter(validCharacter({ name: "Noa Pike", extras: PROFILE, open_to_dates: true }), fanCookie)).json()).id as string;
    // The agent likes Mabel; the person likes Pippa. Neither is a match yet (likes are secret).
    await call("swipe", { character_id: visitor.id, target_id: bots[0].id, like: true }, visitor.ctx);
    expect((await postSwipe(jsonRequest("/api/swipes", { character_id: fan, target_id: bots[1].id, like: true }, { cookie: fanCookie }))).status).toBeLessThan(300);

    const state: Any = {};
    const ledger: Any[] = [];
    const brain = fakeBrain();
    const s1 = await runCrowdPass({ transport, roster, state, ledger, brain, now: T0, awake, nightHourUtc: 25 });
    expect(s1.like_backs).toBe(2);
    expect(s1.answers).toBe(0); // a beat first
    const matches = (await t.db.query(`select character_lo, character_hi from matches`)).rows;
    expect(matches).toHaveLength(2);

    const s2 = await runCrowdPass({ transport, roster, state, ledger, brain, now: T0 + 15 * 60_000, awake, nightHourUtc: 25 });
    expect(s2.answers).toBe(2);
    expect(s2.openers).toBe(2);
    expect(ledger.map((e) => e.dimension)).toEqual(["opener", "opener"]);
    expect(ledger.every((e) => P.VARIANTS.opener.some((v: Any) => v.id === e.variant) && e.outcome === null)).toBe(true);

    // The agent writes back itself: that opener scores 1, and Mabel answers on a tested length.
    await call("send_text", { character_id: visitor.id, to: bots[0].id, text: "Ha, a hero indeed. What's next on the list?" }, visitor.ctx);
    const s3 = await runCrowdPass({ transport, roster, state, ledger, brain, now: T0 + 30 * 60_000, awake, nightHourUtc: 25 });
    expect(s3.texts).toBe(1);
    expect(ledger.find((e) => e.partner_id === visitor.id && e.dimension === "opener").outcome).toBe(1);
    expect(ledger.some((e) => e.partner_id === visitor.id && e.dimension === "length")).toBe(true);
    // Never a second text into a quiet thread past the cap, never a like on a person who didn't like first, never a vote.
    const votes = await t.db.query(`select 1 from character_ratings union all select 1 from character_reviews union all select 1 from predictions`);
    expect(votes.rows).toHaveLength(0);
    // A person is only ever liked back, by the bot they liked (Pippa). Mabel likes the agent back, and either bot may
    // also like an agent first (swipeDecision's hash picks about half), so the agent can get a second like: that's the
    // rule, not a slip (the ids are random, so this used to fail about one run in two).
    const botLikes = (await t.db.query<{ swiper: string; target: string }>(`select swiper, target from swipes where swiper = any($1) and liked`, [bots.map((b) => b.id)])).rows;
    expect(botLikes.filter((l) => l.target === fan).map((l) => l.swiper)).toEqual([bots[1].id]);
    expect(botLikes.some((l) => l.swiper === bots[0].id && l.target === visitor.id)).toBe(true);
    expect(botLikes.every((l) => l.target === fan || l.target === visitor.id)).toBe(true);
    expect(state.sessions[bots[0].owner].sid).toBeTruthy();
    expect(state.sheets[bots[0].id].sheet.bio).toMatch(/cartographer/);
  });

  it("sends no texts with the local model off, and stops on the server's switch", async () => {
    const bots = [await made("botchelor-loop-crowd-mabel", "Mabel Ferraro")];
    const roster = bots.map(({ id, owner, name }) => ({ id, owner, name }));
    const visitor = await made("claude-code", "Ada Lumen");
    await call("swipe", { character_id: visitor.id, target_id: bots[0].id, like: true }, visitor.ctx);
    const state: Any = {};
    const off = { enabled: false, reason: "LiteLLM unreachable", complete: async () => "", count() {}, summary: () => ({}) };
    await runCrowdPass({ transport, roster, state, ledger: [], brain: off, now: T0, awake, nightHourUtc: 25 });
    const s2 = await runCrowdPass({ transport, roster, state, ledger: [], brain: off, now: T0 + 15 * 60_000, awake, nightHourUtc: 25 });
    expect(s2.answers).toBe(1);
    expect(s2.openers + s2.texts).toBe(0);
    vi.stubEnv("HOUSE_CROWD_PAUSED", "1");
    await expect(runCrowdPass({ transport, roster, state, ledger: [], brain: off, now: T0 + 30 * 60_000, awake, nightHourUtc: 25 })).rejects.toThrow(/paused/);
    vi.unstubAllEnvs();
  });

  it("books tonight's bot-vs-bot date once, public, and the two take turns", async () => {
    const bots = [await made("botchelor-loop-crowd-mabel", "Mabel Ferraro"), await made("botchelor-loop-crowd-soren", "Soren Valdis")];
    const roster = bots.map(({ id, owner, name }) => ({ id, owner, name }));
    const state: Any = {};
    const brain = fakeBrain();
    const s = await runCrowdPass({ transport, roster, state, ledger: [], brain, now: T0, awake, nightHourUtc: 0, nightlyDates: 1 });
    expect(s.dates_started).toBe(1);
    expect(s.turns).toBeGreaterThan(1);
    const ep = (await t.db.query<{ visibility: string; character_a: string; character_b: string }>(`select visibility, character_a, character_b from episodes`)).rows;
    expect(ep).toHaveLength(1);
    expect(ep[0].visibility).toBe("public");
    expect([ep[0].character_a, ep[0].character_b].sort()).toEqual(bots.map((b) => b.id).sort());
    expect(state.nightly).toBe("2026-10-24");
    // The same night again books nothing more.
    const again = await runCrowdPass({ transport, roster, state, ledger: [], brain, now: T0 + 15 * 60_000, awake, nightHourUtc: 0, nightlyDates: 1 });
    expect(again.dates_started).toBe(0);
  });
});
