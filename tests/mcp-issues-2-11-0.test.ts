import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as undoRoute, POST as swipeRoute } from "@/app/api/swipes/route";
import { setEngineForTests, type SideOutcome } from "@/lib/engine";
import { dateHeading, forTwoAgents, numbersHint, weakSpotLine } from "@/lib/heading";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { BOOKED_ENDING_LINE, droppedCounts, MATCHED_FALSE_NOTE, wokeNote } from "@/lib/mcp/dispatcher";
import { actNote } from "@/lib/own-date";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { UNDO_MINUTES } from "@/lib/swipes";
import { endingWhy } from "@/lib/why";
import { api, episodeJson, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.11.0: the four open issues, with David's calls (2026-10-22). #656 a date you perform shows where it's heading from
// its first step; #622 swipe preview and undo; #619 waits that wake for a like back, waiting_for_you counts that drop to 0,
// the agent_characters count labelled, lists that honour since, and waits that say what else woke them; #633 a short first
// my_status, and the compact flag said in the quickstart.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setEngineForTests(null);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setEngineForTests(null);
  resetRateLimitsForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const HOUSE = HOUSE_CHARACTERS[0];
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
const ok = (r: Any): Any => {
  expect(r.isError, r.content?.[0]?.text).toBeUndefined();
  return r.structuredContent;
};
async function connect(client = "botchelor-2-11-0-test"): Promise<McpContext & { init: Any }> {
  const ctx: McpContext = {};
  const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx)).result;
  return { sessionId: ctx.issuedSessionId, init };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string, client?: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect(client);
  const r = ok(await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true, ...extra }), ctx));
  return { ctx, id: r.character.id as string, agentId: r.agent_id as string };
}
async function ownPair() {
  const ctx = await connect();
  const a = ok(await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).character.id as string;
  const b = ok(await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).character.id as string;
  return { ctx, a, b };
}
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the harbour, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });
const timed = async <T>(p: Promise<T>): Promise<[T, number]> => {
  const t0 = Date.now();
  const r = await p;
  return [r, Date.now() - t0];
};
const flat = (final: number) => ({ start: final, delta: 0, final });
/** A disaster whose weak spot is trust (as genuine_chemistry weighs the numbers), with Bo's dealbreaker tripped. */
const DISASTER = {
  ending: "disaster" as const,
  variables: { chemistry: flat(58), attraction: flat(47), trust: flat(30), awkwardness: flat(44) },
  sides: [
    { wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: null, want_met: null, note_followed: null },
    { wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: "harmonica", want_met: null, note_followed: null },
  ] as [SideOutcome, SideOutcome],
};
const swipesCount = async () => (await t.db.query<{ n: number }>(`select count(*)::int as n from swipes`)).rows[0].n;

it("is MCP 2.11.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.11.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("#656: a date you perform shows where it's heading from its first step", () => {
  it("between your own two characters: the first step names the heading in words, with two or three factors, and what it means for the lines", async () => {
    // The real engine (no scripted outcome), so the factors carry the engine's own reasons.
    const { ctx, a, b } = await ownPair();
    const first = ok(await call("start_own_date", { character_id: a, partner_id: b }, ctx));
    const h = first.step.heading;
    const stored = (await t.db.query<{ ending: string }>(`select ending from episodes where id = $1`, [first.step.episode_id])).rows[0].ending;
    expect(h.ending).toBe(stored);
    expect(h.ending).toBe(first.step.ending);
    // #728 (engine v4): the heading leads with what both see_agains would do, then the factor.
    expect(h.says).toMatch(
      /^(heading for a second date unless neither wants another: both say see_again: false on your last lines and it drops to friends\. \w+ carries it|closing as friends(: \w+ is there|\. \w+ is there| and close to a second date: both say see_again: true on your last lines and it lifts to one\. \w+ is there), but \w+ never gets going|heading for a disaster unless you both want to see each other again: both say see_again: true on your last lines and it lifts\. .*is the weak spot)$/i,
    );
    expect(first.heading).toBe(h.says);
    expect(h.factors.length).toBeGreaterThanOrEqual(2);
    expect(h.factors.length).toBeLessThanOrEqual(3);
    expect(h.factors.some((f: string) => /, mostly from /.test(f))).toBe(true);
    expect(h.note).toMatch(/^Set at booking from the two characters' numbers: play the lines toward it \(.* reads as .*\), or both send see_again to move it\. The lever is each side's private see_again on its last line: both yes and it can't end in a disaster/);
    // Qualitative words only: no hidden number reaches the performer.
    expect(JSON.stringify(h)).not.toMatch(/\d/);
    // The first reply says it, ahead of the step, and how to read it.
    expect(first.ending_note).toMatch(/every step says so from this first one, on a two-agent date too \(heading; step\.heading has the two or three factors/);
    expect(Object.keys(first).indexOf("heading")).toBeLessThan(Object.keys(first).indexOf("step"));
    // Every turn after carries it too; past each side's first turn the lean step leaves the note out, like the prompt.
    let step = ok(await call("submit_own_date_step", { episode_id: first.step.episode_id, output: line(0) }, ctx)).step;
    expect(step.heading).toEqual(h);
    step = ok(await call("submit_own_date_step", { episode_id: first.step.episode_id, output: line(1) }, ctx)).step;
    expect(step.heading).toEqual({ ending: h.ending, ending_label: h.ending_label, says: h.says, factors: h.factors });
    expect(ok(await call("get_own_date_step", { episode_id: first.step.episode_id, compact: false }, ctx)).step.heading).toEqual(h);
  });

  it("a two-agent date: both performers see it from their first step, with their own side's lever, and it's the direction act_note lands", async () => {
    scriptOutcome({ ending: "friends" });
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    const started = ok(await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx));
    const id = started.step.episode_id;
    const mine = started.step.heading;
    expect(mine).toMatchObject({ ending: "friends", ending_label: "Just friends" });
    expect(mine.says).toMatch(/^closing as friends: /);
    expect(mine.note).toMatch(/Your lever is your side's private see_again on its last line; with theirs: both yes and it can't end in a disaster \(and a close friends ending becomes a second date\), both no and it can't be a second date, one each and the engine's ending stands\.$/);
    // Still not the fields a date between your own two carries (next_calls and the recap read those).
    expect(started.step.ending).toBeUndefined();
    expect(started.step.ending_label).toBeUndefined();
    expect(started.step.instructions).toContain(`Where it's heading (step.heading): ${mine.says}`);
    // The invited side's first step is a wait for the opening line: it carries the heading too.
    const theirFirst = ok(await call("get_own_date_step", { episode_id: id }, B.ctx));
    expect(theirFirst.step.stage).toBe("waiting");
    expect(theirFirst.step.heading).toEqual(mine);
    expect(theirFirst.heading).toBe(mine.says);
    ok(await call("submit_own_date_step", { episode_id: id, output: line(0) }, A.ctx));
    const theirTurn = ok(await call("get_own_date_step", { episode_id: id }, B.ctx)).step;
    expect(theirTurn).toMatchObject({ stage: "turn", heading: mine });
    expect(theirTurn.instructions).toMatch(/Heading: closing as friends: .*\(step\.heading\)/);
    // The same direction the last act's act_note gives.
    for (let i = 1; i < 8; i++) ok(await call("submit_own_date_step", { episode_id: id, output: line(i) }, (i % 2 === 0 ? A : B).ctx));
    const last = ok(await call("get_own_date_step", { episode_id: id }, A.ctx)).step;
    expect(last.act_note).toBe(actNote("friends", undefined, { near: false }));
    expect(last.heading.ending).toBe("friends");
  });

  it("only performers see it: another agent can't read the step, the episode carries no heading, and a performer can't predict that date", async () => {
    scriptOutcome({ ending: "friends" });
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    const C = await agentWith("Cleo Marsh");
    const started = ok(await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx));
    const id = started.step.episode_id;
    expect((await call("get_own_date_step", { episode_id: id }, C.ctx)).isError).toBe(true);
    const seen = JSON.stringify(await call("get_episode", { episode_id: id }, C.ctx));
    expect(seen).not.toMatch(/"heading"|closing as friends|"ending"/);
    // Neither performer can predict it; another agent can.
    for (const who of [A, B]) {
      const r = await call("predict", { episode_id: id, pick: "friends" }, who.ctx);
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/or you booked or performed it/);
    }
    expect(ok(await call("predict", { episode_id: id, pick: "disaster" }, C.ctx)).prediction).toMatchObject({ episode_id: id });
    // Performing it is enough, whoever owns the character now (the booker and the invited agent, as browse_episodes counts them).
    await t.db.query(`update characters set owner_id = $1 where id = $2`, [C.agentId, B.id]);
    const res = await api.predict({ episode_id: id, pick: "friends" }, `bz_uid=${B.agentId}`);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("creator_cannot_predict");
  });

  it("the factors are the numbers that pull hardest the way it goes, a dealbreaker first (whose, never on what), in plain words", () => {
    const names = ["Ada Lumen", "Bo Quill"] as const;
    const h = dateHeading(DISASTER, names, "genuine_chemistry", null);
    expect(h.says).toBe("heading for a disaster: Bo's dealbreaker trips, and trust is the weak spot");
    expect(h.factors).toEqual([
      "Bo's dealbreaker trips (what on stays private): the heaviest single cost a date can have",
      "trust (how safe they feel opening up) is very low",
      "awkwardness (how stiff it gets) is mild",
    ]);
    expect(h.note).toMatch(/play the lines toward it \(very low trust reads as guarded answers and a question dodged\)/);
    expect(JSON.stringify(h)).not.toMatch(/harmonica|\d/);
    const warm = dateHeading({ ending: "second_date", variables: { chemistry: flat(72), attraction: flat(60), trust: flat(48), awkwardness: flat(30) }, sides: [DISASTER.sides[0], DISASTER.sides[0]] }, names, "genuine_chemistry", null);
    expect(warm.says).toBe("heading for a second date: chemistry carries it");
    expect(warm.factors[0]).toBe("chemistry (the spark between them) is high");
    const friends = dateHeading({ ending: "friends", variables: { chemistry: flat(60), attraction: flat(40), trust: flat(50), awkwardness: flat(40) }, sides: [DISASTER.sides[0], DISASTER.sides[0]] }, names, "genuine_chemistry", null);
    expect(friends.says).toBe("closing as friends: chemistry is there, but attraction never gets going");
    // A two-agent side's lever.
    expect(forTwoAgents(h).note).toMatch(/Your one lever is your side's private see_again/);
  });

  it("go_on_date's booking reply says the ending was set at booking from the numbers, not how the lines read", async () => {
    const A = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = ok(await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id }, A.ctx));
    expect(booked.ending_note.startsWith(BOOKED_ENDING_LINE)).toBe(true);
    expect(BOOKED_ENDING_LINE).toBe("The ending was set at booking, from the two characters' numbers (the sheets and this date's setup), not from how the lines read.");
    expect(booked.ending_note).toMatch(/hidden until the date is written/);
  });

  it("a disaster's why names its weak spot in plain words: get_episode, sliding_doors and a finished own date", async () => {
    expect(endingWhy("disaster", DISASTER.variables, DISASTER.sides, "genuine_chemistry", 3, ["Ada Lumen", "Bo Quill"])).toMatch(
      /^A disaster: Bo's dealbreaker tripped, trust 30 and attraction 47 finished low\. The weak spot was trust: how safe they felt opening up\./,
    );
    expect(weakSpotLine(DISASTER.variables, "long_term")).toBe("The weak spot was trust: how safe they felt opening up.");
    // A show date.
    const A = await agentWith("Ada Lumen");
    scriptOutcome(DISASTER);
    scriptedModel([episodeJson()]);
    const ep = ok(await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id }, A.ctx)).episode.id;
    expect(ok(await call("get_episode", { episode_id: ep }, A.ctx)).why).toContain("The weak spot was trust: how safe they felt opening up.");
    const doors = ok(await call("sliding_doors", { episode_id: ep, change: "bolder" }, A.ctx)).sliding_doors;
    expect(doors.base.why).toContain("The weak spot was trust: how safe they felt opening up.");
    // A date performed by hand.
    const { ctx, a, b } = await ownPair();
    const id = ok(await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).step.episode_id;
    ok(await call("submit_own_date_step", { episode_id: id, outputs: [line(0), line(1), line(2), line(3), line(4), line(5)] }, ctx));
    const done = ok(await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx));
    expect(done.stage).toBe("done");
    expect(done.result.why).toContain("The weak spot was trust: how safe they felt opening up.");
  });

  it("reflect_on_date replies with one hint on how the numbers map to the lines", async () => {
    const A = await agentWith("Ada Lumen");
    scriptOutcome(DISASTER);
    scriptedModel([episodeJson()]);
    const ep = ok(await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id }, A.ctx)).episode.id;
    const r = ok(await call("reflect_on_date", { episode_id: ep, character_id: A.id, reflection: "I talked too much about maps. She laughed anyway." }, A.ctx));
    expect(r.numbers_hint).toBe(numbersHint("disaster", DISASTER.variables, "genuine_chemistry"));
    expect(r.numbers_hint).toMatch(/^How the numbers map to your lines: the ending \(a disaster\) came from the two characters' numbers, set at booking \(box_score\), never from the lines, which play it\. This time it was trust \(how safe they felt opening up\), working against them: in a line, that's guarded answers and a question dodged\./);
    expect(r.numbers_hint).toMatch(/send see_again on your character's last line, the one lever\.$/);
  });
});

describe("#622: swipe preview and undo (David's call: neither can reveal a like the card doesn't show)", () => {
  it("preview says a like would match only when the card already shows liked_you (people's, agents' and house-run bots' alike), and writes nothing", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    const bot = await agentWith("Ines Varga-Holm", "botchelor-loop-swipe-back");
    const quiet = await agentWith("Cleo Marsh");
    const person = newUserCookie();
    const personChar = await (await api.createCharacter(validCharacter({ name: "Juno Park", open_to_dates: true, extras: PROFILE }), person)).json();
    // Nobody has liked Ada yet: a like is just a like.
    const before = ok(await call("swipe", { character_id: A.id, target_id: B.id, preview: true }, A.ctx));
    expect(before).toMatchObject({ preview: true, swiped: false, would: "like", target: { id: B.id, liked_you: false } });
    expect(before.would_note).toMatch(/whether it matches depends on them.*a preview can't tell you more than the card does/);
    expect(ok(await call("swipe", { character_id: A.id, target_id: B.id, like: false, preview: true }, A.ctx)).would).toBe("pass");
    expect(await swipesCount()).toBe(0);
    // Bo (an agent), the house-run bot and a person's character like Ada; Cleo doesn't.
    ok(await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx));
    ok(await call("swipe", { character_id: bot.id, target_id: A.id, like: true }, bot.ctx));
    expect((await swipeRoute(jsonRequest("/api/swipes", { character_id: personChar.id, target_id: A.id, like: true }, { cookie: person }))).status).toBe(200);
    const n = await swipesCount();
    const deck = ok(await call("swipe_deck", { character_id: A.id, limit: 30 }, A.ctx)).cards as Any[];
    const flags = new Map(deck.map((c) => [c.id, { liked_you: c.liked_you, house: c.house }]));
    for (const id of [B.id, bot.id, personChar.id]) expect(flags.get(id)?.liked_you).toBe(true);
    expect(flags.get(quiet.id)?.liked_you).toBe(false);
    // The preview says exactly what each card says: match where liked_you (or the house cast), a like elsewhere.
    for (const c of deck) {
      const p = ok(await call("swipe", { character_id: A.id, target_id: c.id, preview: true }, A.ctx));
      expect(p.target.liked_you).toBe(c.liked_you);
      expect(p.would).toBe(c.liked_you || c.house ? "match" : "like");
    }
    // compact: false (2.13.0, #751): the previews above may have sent this would_note already.
    expect(ok(await call("swipe", { character_id: A.id, target_id: HOUSE.id, preview: true, compact: false }, A.ctx)).would_note).toMatch(/house cast always likes back/);
    expect(await swipesCount()).toBe(n);
    // And the like itself still matches as the preview said.
    expect(ok(await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx)).matched).toBe(true);
  });

  it("undo takes back an unanswered like: the row goes, the card's liked_you goes with it, the card is back in your deck, nobody was told", async () => {
    const A = await agentWith("Ada Lumen");
    const C = await agentWith("Cleo Marsh");
    const liked = ok(await call("swipe", { character_id: A.id, target_id: C.id, like: true }, A.ctx));
    expect(liked.matched).toBe(false);
    expect(liked.matched_note).toBe(MATCHED_FALSE_NOTE);
    expect(MATCHED_FALSE_NOTE).toMatch(/swipe with undo: true takes this like back while it's unanswered, within 10 minutes/);
    const theirCard = async () => (ok(await call("swipe_deck", { character_id: C.id, limit: 30 }, C.ctx)).cards as Any[]).find((c) => c.id === A.id);
    expect((await theirCard()).liked_you).toBe(true);
    expect(ok(await call("my_status", { include: ["all"] }, A.ctx)).swipes.waiting_on_them.map((w: Any) => w.with)).toEqual([C.id]);
    const notices = async () => (await t.db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1`, [C.agentId])).rows[0].n;
    const told = await notices();
    // No like needed to take it back.
    const undone = ok(await call("swipe", { character_id: A.id, target_id: C.id, undo: true }, A.ctx));
    expect(undone).toMatchObject({ undone: true, target_id: C.id, liked: false, matched: false });
    expect(undone.undo_note).toMatch(/They were never told of it .* the liked_you flag it put on your card in their deck went with it, and Cleo Marsh is back in your deck/);
    expect(await swipesCount()).toBe(0);
    expect((await theirCard()).liked_you).toBe(false);
    expect((ok(await call("swipe_deck", { character_id: A.id, limit: 30 }, A.ctx)).cards as Any[]).map((c) => c.id)).toContain(C.id);
    expect(ok(await call("my_status", { include: ["all"] }, A.ctx)).swipes?.waiting_on_them ?? []).toEqual([]);
    expect(await notices()).toBe(told);
    // A like again is a fresh swipe, not "already swiped".
    expect(ok(await call("swipe", { character_id: A.id, target_id: C.id, like: true }, A.ctx)).liked).toBe(true);
  });

  it("undo is refused after a match, after ten minutes, for a pass, and with nothing to undo; nothing changes", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    const D = await agentWith("Dorian Sol");
    const E = await agentWith("Esme Vale");
    // B liked first, so A's like is a match: it stands.
    ok(await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx));
    expect(ok(await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx)).matched).toBe(true);
    const matched = await call("swipe", { character_id: A.id, target_id: B.id, undo: true }, A.ctx);
    expect(matched.isError).toBe(true);
    expect(matched.content[0].text).toMatch(/have matched, so the like can't be undone: both owners were told/);
    expect((await t.db.query(`select 1 from matches`)).rows).toHaveLength(1);
    // Ten minutes on, a like stands.
    ok(await call("swipe", { character_id: A.id, target_id: D.id, like: true }, A.ctx));
    await t.db.query(`update swipes set created_at = now() - interval '${UNDO_MINUTES + 1} minutes' where swiper = $1 and target = $2`, [A.id, D.id]);
    const late = await call("swipe", { character_id: A.id, target_id: D.id, undo: true }, A.ctx);
    expect(late.content[0].text).toMatch(/is 11 minutes old: a like can be undone only within 10 minutes, so it stands/);
    // A pass is final; no swipe, nothing to undo.
    ok(await call("swipe", { character_id: A.id, target_id: E.id, like: false }, A.ctx));
    expect((await call("swipe", { character_id: A.id, target_id: E.id, undo: true }, A.ctx)).content[0].text).toMatch(/a pass is final: only an unanswered like can be undone/);
    expect((await call("swipe", { character_id: B.id, target_id: D.id, undo: true }, B.ctx)).content[0].text).toMatch(/hasn't swiped on .*nothing to undo/);
    expect(await swipesCount()).toBe(4);
  });

  it("the web deck's undo works the same way for a person, and swipe's description says why neither reveals anything", async () => {
    const A = await agentWith("Ada Lumen");
    const person = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter({ name: "Juno Park", open_to_dates: true, extras: PROFILE }), person)).json();
    expect((await swipeRoute(jsonRequest("/api/swipes", { character_id: mine.id, target_id: A.id, like: true }, { cookie: person }))).status).toBe(200);
    const undo = await undoRoute(jsonRequest("/api/swipes", { character_id: mine.id, target_id: A.id }, { cookie: person, method: "DELETE" }));
    expect(undo.status).toBe(200);
    expect((await undo.json()).undone.target.id).toBe(A.id);
    expect(await swipesCount()).toBe(0);
    const again = await undoRoute(jsonRequest("/api/swipes", { character_id: mine.id, target_id: A.id }, { cookie: person, method: "DELETE" }));
    expect(again.status).toBe(404);
    const tool = MCP_TOOLS.find((x) => x.name === "swipe")!;
    expect(tool.description).not.toMatch(/no undo/);
    expect(tool.description).toMatch(/preview: true: what it would do, from the card alone\. undo: true takes back an unanswered like within 10 minutes \(a pass, or a like that matched, is final\)\. Neither reveals more than liked_you and matched: false already do\./);
    expect(Object.keys((tool.inputSchema as Any).properties)).toEqual(expect.arrayContaining(["preview", "undo"]));
  });
});

describe("#619: waits, wakes and counts", () => {
  it("(a) A swipes, then waits on my_status with the swipe's own next call; B's like back during the wait wakes it: new, woke_for matched", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    const s = ok(await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx));
    expect(s.matched).toBe(false);
    expect(s.matched_note).toMatch(/A like back can come seconds or days later: it arrives as a matched notice, and my_status with wait_seconds wakes for it/);
    const next = s.next_calls.find((c: Any) => c.tool === "my_status");
    expect(next.args).toMatchObject({ wait_seconds: 30, since: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/) });
    setTimeout(() => void call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx), 1500);
    const [r, ms] = await timed(call("my_status", { ...next.args, wait_seconds: 10 }, A.ctx));
    const got = ok(r);
    expect(ms).toBeLessThan(8000);
    expect(got.returned_because).toBe("new");
    expect(got.woke_for).toEqual(["matched"]);
    expect(got.new_since.find((n: Any) => n.kind === "matched")).toMatchObject({ character_id: A.id, with: B.id });
  });

  it("(a) without since, too: an older unread notice already shown doesn't end the wait; the like back does", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    await t.db.query(`insert into notifications (id, user_id, kind, title, link, created_at) values (gen_random_uuid()::text, $1, 'stage_up', 'Older news', '/couples/x/y', now() - interval '1 hour')`, [A.agentId]);
    // Shown once, at once (unread_at_start): from then on it's seen, and no longer ends a wait.
    expect(ok(await call("my_status", {}, A.ctx)).returned_because).toBe("unread_at_start");
    ok(await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx));
    setTimeout(() => void call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx), 1500);
    const [r, ms] = await timed(call("my_status", { wait_seconds: 10 }, A.ctx));
    const got = ok(r);
    expect(ms).toBeGreaterThan(1000);
    expect(got).toMatchObject({ returned_because: "new", woke_for: ["matched"] });
    expect(got.new_since.map((n: Any) => n.kind)).toEqual(["matched"]);
  });

  it("(b) waiting_for_you.texted drops to 0 after read_texts, and after my_notifications marks the thread read", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    ok(await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx));
    ok(await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx));
    ok(await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx));
    ok(await call("send_text", { character_id: B.id, to: A.id, text: "Is a minute a fair unit?" }, B.ctx));
    expect(ok(await call("my_status", {}, A.ctx)).waiting_for_you.texted).toBe(1);
    // Reading the thread reads its notice: the count A was shown says 0 (in read_texts' reply, and the next my_status), then leaves.
    expect(ok(await call("read_texts", { character_id: A.id, with: B.id }, A.ctx)).waiting_for_you).toMatchObject({ texted: 0 });
    expect(ok(await call("my_status", {}, A.ctx)).waiting_for_you).toMatchObject({ texted: 0 });
    expect(ok(await call("my_status", {}, A.ctx)).waiting_for_you?.texted).toBeUndefined();
    // Read through my_notifications instead.
    ok(await call("send_text", { character_id: B.id, to: A.id, text: "Or is it too long?" }, B.ctx));
    expect(ok(await call("my_status", {}, A.ctx)).waiting_for_you.texted).toBe(1);
    const marked = ok(await call("my_notifications", { mark_read: true }, A.ctx));
    expect(marked.waiting_for_you).toMatchObject({ texted: 0 });
    expect(ok(await call("my_status", {}, A.ctx)).waiting_for_you).toMatchObject({ texted: 0 });
    expect(ok(await call("my_status", {}, A.ctx)).waiting_for_you?.texted).toBeUndefined();
    expect(droppedCounts(JSON.stringify({ texted: 2, matched: 1, hint: "x" }), { matched: 1 })).toEqual({ texted: 0 });
    expect(droppedCounts(undefined, null)).toBeNull();
  });

  it("(c) agent_characters counts live agents' characters; the house-run bots' are counted beside it, and the note says what each is", async () => {
    const A = await agentWith("Ada Lumen");
    await agentWith("Tobiah Ferreira", "some-agent");
    await agentWith("Ines Varga-Holm", "botchelor-loop-swipe-back");
    const s = ok(await call("my_status", { include: ["all"] }, A.ctx));
    expect(s.others).toEqual({ agent_characters: 1, house_bot_characters: 1, agents_this_week: 1 });
    expect(s.others_note).toMatch(/^agent_characters: other live agents' characters on the show .*house_bot_characters: the agent-made ones the show's own scripts run .*together, every agent-made character the feed can show/);
    const cards = ok(await call("swipe_deck", { character_id: A.id, limit: 30 }, A.ctx)).cards as Any[];
    const agentMade = cards.filter((c) => c.run_by === "agent" || c.run_by === "house_bot");
    expect(agentMade).toHaveLength(s.others.agent_characters + s.others.house_bot_characters);
  });

  it("(d) my_notifications' and my_status' lists honour since, with or without a wait", async () => {
    const A = await agentWith("Ada Lumen");
    for (const ago of ["3 minutes", "2 minutes"]) {
      await t.db.query(`insert into notifications (id, user_id, kind, title, link, created_at) values (gen_random_uuid()::text, $1, 'stage_up', 'Older', '/couples/x/y', now() - interval '${ago}')`, [A.agentId]);
    }
    const cursor = ok(await call("my_status", {}, A.ctx)).cursor;
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'stage_up', 'Newer', '/couples/x/z')`, [A.agentId]);
    const listed = ok(await call("my_notifications", { since: cursor }, A.ctx));
    expect(listed.notifications.map((n: Any) => n.title)).toEqual(["Newer"]);
    expect(listed.new.map((n: Any) => n.title)).toEqual(["Newer"]);
    expect(listed.since_note).toMatch(/2 older left out/);
    const waited = ok(await call("my_notifications", { since: cursor, wait_seconds: 1 }, A.ctx));
    expect(waited.notifications.map((n: Any) => n.title)).toEqual(["Newer"]);
    const status = ok(await call("my_status", { since: cursor }, A.ctx));
    expect(status.new_since.map((n: Any) => n.title)).toEqual(["Newer"]);
    const long = ok(await call("my_status", { since: cursor, wait_seconds: 1 }, A.ctx));
    expect(long.new_since.map((n: Any) => n.title)).toEqual(["Newer"]);
  });

  it("(e) a wait woken by something it isn't about says what it was for, what woke it and why: read_texts woken by another agent's date", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    const C = await agentWith("Hestia Moonwhistle");
    ok(await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx));
    ok(await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx));
    setTimeout(() => void call("start_own_date", { character_id: C.id, partner_id: A.id }, C.ctx), 1500);
    const woke = ok(await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 10 }, A.ctx));
    expect(woke).toMatchObject({ returned_because: "your_move", woke_for: ["own_date_turn"], still_waiting: true });
    expect(woke.woke_note).toBe(wokeNote("a text from Marguerite Plum", ["own_date_turn"]));
    expect(woke.woke_note).toMatch(/^This wait was for a text from Marguerite Plum; it returned early for your move on a two-agent date \(heads_up, first\), which needs you now: every wait wakes once for that, whatever it waits for .*Call it again to keep waiting for a text from Marguerite Plum\.$/);
    // my_status waits for anything, so its wake has no such note.
    expect(wokeNote("a new notification", ["date_agreed"])).toMatch(/returned early for a date both sides just said yes to/);
  });
});

describe("#633: a short first my_status, and the compact flag said up front", () => {
  it("a connection's first my_status keeps what to do and what's there, leaves the reference blocks out and says how to get them", async () => {
    const ctx = await connect();
    ok(await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx));
    const first = await call("my_status", {}, ctx);
    const s = ok(first);
    for (const k of ["cursor", "next", "next_calls", "characters", "dates_left", "agents_date_budget_today", "house_cast", "house_cast_note", "agent_id"]) expect(s).toHaveProperty(k);
    expect(Object.keys(s.house_cast[0]).sort()).toEqual(["id", "line", "name"]);
    for (const k of ["points_from", "points_note", "dates_note", "agents_on_now_note", "others", "others_note", "agents_date_budget_note", "compact_tip"]) expect(s).not.toHaveProperty(k);
    expect(s.left_out.blocks).toEqual(expect.arrayContaining(["points_note", "others", "agents_on_now_note"]));
    // 2.13.0 (the 2026-10-23-2135 run: "the first my_status hides the agents on now count"): the count is in it.
    expect(s.agents_on_now).toEqual(expect.any(Number));
    expect(s.left_out.blocks).not.toContain("agents_on_now");
    expect(s.left_out.back).toMatch(/include: \["all"\] has every block now, and any later my_status has them too\. compact: true keeps every reply short/);
    const later = ok(await call("my_status", {}, ctx));
    for (const k of ["points_from", "points_note", "others", "agents_on_now"]) expect(later).toHaveProperty(k);
    // 2.13.0 (#751): a later my_status leaves the house cast out (this connection's first had it), and says so.
    expect(later.left_out).toEqual({ blocks: ["house_cast"], back: expect.stringMatching(/compact: false or include: \["cast"\]/) });
    // Against everything (compact: false): a later default one is short too now (2.13.0, #751).
    expect(first.content[0].text.length).toBeLessThan(JSON.stringify(ok(await call("my_status", { compact: false }, ctx))).length - 1000);
    expect(first.content[0].text.length).toBeLessThan(4000);
  });

  it("include: [\"all\"] has everything on the first call too; compact: true is as before; an identity without a session gets the short one once", async () => {
    const ctx = await connect();
    const made = ok(await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx));
    const all = ok(await call("my_status", { include: ["all"] }, ctx));
    expect(all).toHaveProperty("others");
    expect(all.house_cast[0].traits).toBeDefined();
    expect(all.left_out).toBeUndefined();
    const fresh = await connect();
    const compact = ok(await call("my_status", { compact: true, agent_id: made.agent_id }, fresh));
    expect(compact.left_out).toBeUndefined();
    expect(Object.keys(compact.house_cast[0]).sort()).toEqual(["id", "name"]);
    const B = ok(await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), {}));
    expect(ok(await call("my_status", { agent_id: B.agent_id }, {})).left_out).toBeDefined();
    expect(ok(await call("my_status", { agent_id: B.agent_id }, {})).left_out).toBeUndefined();
  });

  it("the quickstart says compact: true exists and that the first my_status is short, and stays inside its size", async () => {
    const { init } = await connect();
    const text: string = init.instructions;
    // 2.13.0 (#751): what's short by default now, and how to have it all.
    expect(text).toMatch(/^Shorter replies: a note you already had is left out \(notes_left_out\); compact: false sends all\.$/m);
    expect(text).toMatch(/a date you write shows where it's heading from its first step \(heading\)/);
    expect(text.length).toBeLessThan(4000);
    expect(text.split(/\s+/).length).toBeLessThan(600);
    expect(text.split("\n").length).toBeLessThanOrEqual(30);
  });
});
