import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, hideUnwrittenEndings, HOUSE_BOT_LABEL, withoutEnding, type McpContext } from "@/lib/mcp";
import { endingWhy } from "@/lib/why";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// David's calls on the needs-david agent feedback (2026-10-19, "I agree with everything"): #261, #252, #337, #268,
// #260, #342 (#343 is the loop arena's seeding, scripts/loop/arena.mjs).
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

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(client = "botchelor-calls-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: client } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

describe("#261: the booker doesn't see the ending while the date is written", () => {
  it("hides the ending, box score and drama answer until it's ready", () => {
    const e = { id: "e1", status: "generating", ending: "friends", drama_answer: "yes", box_score: { chemistry: 60 }, why: "…", setting: "A bar" };
    expect(withoutEnding(e)).toEqual({ id: "e1", status: "generating", setting: "A bar" });
    expect(withoutEnding({ ...e, status: "ready" })).toMatchObject({ ending: "friends", box_score: { chemistry: 60 } });
  });

  it("go_on_date says when the ending can be read", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const r = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent;
    expect(r.ending_note).toMatch(/hidden until the date is written/);
    if (r.episode.status === "generating") expect(r.episode.ending).toBeUndefined();
  });
});

describe("#261 everywhere: no tool shows a generating date's ending (2026-10-21 visitors)", () => {
  it("takes the ending off a generating date wherever it sits, and leaves a written one and an own-date step alone", () => {
    const gen = { id: "e1", status: "generating", ending: "friends", box_score: { chemistry: 60 } };
    const out = hideUnwrittenEndings({ latest_dates: [gen, { ...gen, id: "e2", status: "ready" }], second_date: { episode: gen }, step: { stage: "turn", ending: "friends" } });
    expect(out.latest_dates[0]).toEqual({ id: "e1", status: "generating" });
    expect(out.latest_dates[1]).toMatchObject({ ending: "friends", box_score: { chemistry: 60 } });
    expect(out.second_date.episode).toEqual({ id: "e1", status: "generating" });
    expect(out.step).toEqual({ stage: "turn", ending: "friends" });
  });

  it("my_status's latest_dates and get_episode hide it while the date is written", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode.id;
    // Back to "being written", with the engine's ending already stored (as it is from the last line on: lib/own-date.ts).
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [ep]);
    const status = (await call("my_status", {}, ctx)).structuredContent;
    const mine = (status.latest_dates ?? []).find((e: Any) => e.id === ep || e.episode_id === ep);
    expect(mine).toBeDefined();
    expect(mine.ending).toBeUndefined();
    expect(mine.box_score).toBeUndefined();
    const got = (await call("get_episode", { episode_id: ep }, ctx)).structuredContent;
    expect(JSON.stringify(got)).not.toMatch(/"(ending|box_score|drama_answer)":/);
  });
});

describe("#252 and #268: what a self-played date says up front", () => {
  it("says role-play doesn't change the ending, and offers the six-line speed date", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const r = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    // David 2026-10-20: what they say still doesn't change it, but the two sides' private wishes weigh in. (2.10.0: said as the
    // one lever a performer has, see_again on its last line: tests/mcp-run-0800.test.ts.)
    expect(r.ending_note).toMatch(/never by what the lines say\. Your one lever: see_again: true or false \(private\)/);
    // #728: under engine v4 the two see_agains are a rule on a date agents write.
    expect(r.ending_note).toMatch(/Both true and it can't end in a disaster .*both false and it can't be a second date; one each, the engine's ending stands/);
    expect(r.how_long).toMatch(/format: "speed_date" is a six-line date/);
    expect(r.how_long).toMatch(/submit_own_date_step with wait_seconds/);
  });
});

describe("#337: whose dealbreaker tripped", () => {
  const box = { chemistry: { final: 40 }, attraction: { final: 45 }, trust: { final: 42 }, awkwardness: { final: 60 } } as Any;
  const side = (hit: boolean) => ({ wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: hit ? "x" : null, want_met: null, note_followed: null }) as Any;
  it("names the side by first name, never the dealbreaker", () => {
    expect(endingWhy("disaster", box, [side(false), side(true)], null, 2, ["Ada Lumen", "Bo Quill"])).toMatch(/Bo's dealbreaker tripped/);
    expect(endingWhy("disaster", box, [side(true), side(true)], null, 2, ["Ada Lumen", "Bo Quill"])).toMatch(/both their dealbreakers tripped/);
    expect(endingWhy("disaster", box, [side(true), side(false)], null, 2)).toMatch(/a dealbreaker tripped/);
  });
});

describe("#260: agents can delete their characters", () => {
  it("needs confirm, removes one that never dated, and retires one that did", async () => {
    const ctx = await connect();
    const fresh = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    expect((await call("delete_character", { character_id: fresh }, ctx)).isError).toBe(true);
    const gone = (await call("delete_character", { character_id: fresh, confirm: true }, ctx)).structuredContent;
    expect(gone).toMatchObject({ deleted: true, anonymized: false });
    expect((await t.db.query(`select 1 from characters where id = $1`, [fresh])).rows).toHaveLength(0);

    const dated = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    await call("go_on_date", { character_id: dated, partner_id: HOUSE_PARTNER_ID }, ctx);
    const retired = (await call("delete_character", { character_id: dated, confirm: true }, ctx)).structuredContent;
    expect(retired).toMatchObject({ deleted: false, anonymized: true });
    const row = (await t.db.query<{ open_to_dates: boolean; owner_id: string }>(`select open_to_dates, owner_id from characters where id = $1`, [dated])).rows[0];
    expect(row.open_to_dates).toBe(false);
    // Not yours any more.
    expect((await call("delete_character", { character_id: dated, confirm: true }, ctx)).isError).toBe(true);
  });

  it("refuses someone else's character", async () => {
    const a = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), a)).structuredContent.character.id;
    const b = await connect();
    await call("create_character", validCharacter({ name: "Bo Quill" }), b);
    expect((await call("delete_character", { character_id: id, confirm: true }, b)).isError).toBe(true);
  });
});

describe("#342: a house-run bot says so", () => {
  it("labels a character run by the loop's own script, and leaves real agents alone", async () => {
    const bot = await connect("botchelor-loop-swipe-back");
    await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, open_to_dates: true, extras: PROFILE }), bot);
    const live = await connect("some-agent");
    await call("create_character", validCharacter({ name: "Tobiah Ferreira", keep_name: true, open_to_dates: true, extras: PROFILE }), live);
    const me = await connect("visitor");
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), me)).structuredContent.character.id;
    const cards = (await call("swipe_deck", { character_id: mine }, me)).structuredContent.cards as Any[];
    const byName = Object.fromEntries(cards.map((c) => [c.name, c.agent_active]));
    expect(byName["Ines Varga-Holm"]).toBe(HOUSE_BOT_LABEL);
    expect(byName["Tobiah Ferreira"]).toMatch(/^active/);
  });

  it("says it as a house_bot flag on cards, search, profiles, swipes, matches, texts, own dates and my_status (#417)", async () => {
    const bot = await connect("botchelor-loop-swipe-back");
    const ines = (await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, open_to_dates: true, extras: PROFILE }), bot)).structuredContent.character.id;
    const live = await connect("some-agent");
    await call("create_character", validCharacter({ name: "Tobiah Ferreira", keep_name: true, open_to_dates: true, extras: PROFILE }), live);
    const me = await connect("visitor");
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), me)).structuredContent.character.id;

    // 2.7.0 (the 2026-10-22-0215 run: house-run bots read as agents): house_bot is on every card, true only for the bot.
    const flags = (cards: Any[]) => Object.fromEntries(cards.filter((c) => c.house_bot !== false).map((c) => [c.name, c.house_bot]));
    const deck = (await call("swipe_deck", { character_id: mine }, me)).structuredContent.cards as Any[];
    expect(flags(deck)).toEqual({ "Ines Varga-Holm": true });
    expect(deck.every((c) => typeof c.house_bot === "boolean")).toBe(true);
    expect(deck.find((c) => c.name === "Tobiah Ferreira").house_bot).toBe(false);
    expect(flags((await call("swipe_deck", { character_id: mine, compact: true }, me)).structuredContent.cards)).toEqual({ "Ines Varga-Holm": true });
    const found = (await call("search_characters", { include_house: true, open_only: false, limit: 20 }, me)).structuredContent.characters as Any[];
    expect(flags(found)).toEqual({ "Ines Varga-Holm": true });
    // The house cast (which has its own house field) says house_bot: false, as people's characters do.
    expect(found.filter((c) => c.house).every((c) => c.house_bot === false)).toBe(true);
    expect((await call("get_character", { character_id: ines }, me)).structuredContent.character).toMatchObject({ house_bot: true, agent_active: HOUSE_BOT_LABEL });

    // A like on it says so before any match, and my_status's likes in flight too.
    expect((await call("swipe", { character_id: mine, target_id: ines, like: true }, me)).structuredContent).toMatchObject({ matched: false, house_bot: true });
    expect((await call("my_status", {}, me)).structuredContent.swipes.waiting_on_them).toEqual([expect.objectContaining({ with: ines, house_bot: true })]);
    await call("swipe", { character_id: ines, target_id: mine, like: true }, bot);
    expect((await call("my_status", {}, me)).structuredContent.matches_to_answer).toEqual([expect.objectContaining({ with: ines, house_bot: true })]);
    expect((await call("my_matches", { character_id: mine }, me)).structuredContent.matches[0]).toMatchObject({ house_bot: true, their_agent: HOUSE_BOT_LABEL });
    expect((await call("send_text", { character_id: mine, to: ines, text: "Do you draw your own maps?" }, me)).structuredContent).toMatchObject({ house_bot: true });

    await call("answer_match", { character_id: mine, with: ines, yes: true }, me);
    await call("answer_match", { character_id: ines, with: mine, yes: true }, bot);
    const own = await call("start_own_date", { character_id: mine, partner_id: ines }, me);
    expect(own.isError).toBeUndefined();
    expect(own.structuredContent).toMatchObject({ house_bot: true, their_agent: HOUSE_BOT_LABEL });
  });
});
