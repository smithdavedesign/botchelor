import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { proposeDate } from "@/lib/date-proposals";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSwipeGateForTests, swipeGateOn } from "@/lib/swipe-gate";
import { swipe } from "@/lib/swipes";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

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
  setSwipeGateForTests(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSwipeGateForTests(false); // the shared harness's default
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const rpc = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

/** A person and their character: open to dates, with a dating profile, unless told otherwise. */
async function person(name: string, opts: { open?: boolean } = {}) {
  const cookie = newUserCookie();
  const body = validCharacter({ name, extras: PROFILE, ...(opts.open === false ? {} : { open_to_dates: true }) });
  const character = await (await api.createCharacter(body, cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string, name };
}

/** An agent and its character (made over MCP), open to dates, with a dating profile. */
async function agent(name: string) {
  const made = (await rpc("create_character", { ...validCharacter({ name }), extras: PROFILE, open_to_dates: true })).structuredContent;
  return { userId: made.agent_id as string, id: made.character.id as string, name };
}

async function book(cookie: string, body: Record<string, unknown>) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode(body, cookie);
  return { status: res.status, body: (await res.json()) as Any };
}

/** Both characters said yes to a date: the match is agreed. */
async function agree(x: { userId: string; id: string }, y: { userId: string; id: string }) {
  await swipe(t.db, x.userId, x.id, y.id, true);
  await swipe(t.db, y.userId, y.id, x.id, true);
  await t.db.query(`update matches set yes_lo = true, yes_hi = true`);
}

async function haveDated(x: string, y: string) {
  const [lo, hi] = x < y ? [x, y] : [y, x];
  await t.db.query(`insert into relationships (character_a, character_b, dates, stage) values ($1, $2, 1, 'met')`, [lo, hi]);
}

const partnerOf = async (episodeId: string) =>
  (await t.db.query<{ character_b: string }>(`select character_b from episodes where id = $1`, [episodeId])).rows[0].character_b;

describe("the swipe gate (lib/swipe-gate.ts)", () => {
  it("is on unless SWIPE_GATE=0", () => {
    setSwipeGateForTests(null);
    expect(swipeGateOn({})).toBe(true);
    expect(swipeGateOn({ SWIPE_GATE: "1" })).toBe(true);
    expect(swipeGateOn({ SWIPE_GATE: "0" })).toBe(false);
  });

  it("a first date with someone else's character takes an agreed match; this season's house cast doesn't", async () => {
    const me = await person("Wren Kestrel");
    const them = await person("Pim Alder");
    const refused = await book(me.cookie, { character_id: me.id, partner_id: them.id });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: "partner_not_available", message: expect.stringMatching(/Match first: swipe for them/) });
    expect((await book(me.cookie, { character_id: me.id, partner_id: HOUSE_PARTNER_ID })).status).toBe(200);

    // A match where only one said yes isn't enough.
    await swipe(t.db, me.userId, me.id, them.id, true);
    await swipe(t.db, them.userId, them.id, me.id, true);
    await t.db.query(`update matches set yes_lo = true, yes_hi = false`);
    expect((await book(me.cookie, { character_id: me.id, partner_id: them.id })).status).toBe(422);
    await t.db.query(`update matches set yes_lo = true, yes_hi = true`);
    expect((await book(me.cookie, { character_id: me.id, partner_id: them.id })).status).toBe(200);
  });

  it("a couple who've dated can meet again while the other is open to dates, without a match", async () => {
    const me = await person("Wren Kestrel");
    const them = await person("Pim Alder");
    await haveDated(me.id, them.id);
    expect((await book(me.cookie, { character_id: me.id, partner_id: them.id })).status).toBe(200);
    // Closed to dates, a couple that's dated proposes instead, as before the gate.
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [them.id]);
    expect((await book(me.cookie, { character_id: me.id, partner_id: them.id })).status).toBe(422);
  });

  it("a blind date is one of your agreed matches, or one of this season's house cast: never a stranger", async () => {
    const me = await person("Wren Kestrel");
    await person("Pim Alder"); // open to dates, but no match
    const first = await book(me.cookie, { character_id: me.id, blind: true });
    expect(first.status).toBe(200);
    expect(await partnerOf(first.body.id)).toBe(HOUSE_PARTNER_ID);

    const matched = await person("Ivo Marsh");
    await agree(me, matched);
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [matched.id]); // the match still counts
    const second = await book(me.cookie, { character_id: me.id, blind: true });
    expect(second.status).toBe(200);
    expect(await partnerOf(second.body.id)).toBe(matched.id);
  });

  it("a two-agent date needs a match, or a date together before; an agent's own two characters never do", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    const refused = await rpc("start_own_date", { character_id: a.id, partner_id: b.id, agent_id: a.userId });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/haven't matched yet\. Match first/);

    await rpc("swipe", { character_id: a.id, target_id: b.id, like: true, agent_id: a.userId });
    await rpc("swipe", { character_id: b.id, target_id: a.id, like: true, agent_id: b.userId });
    await rpc("answer_match", { character_id: a.id, with: b.id, yes: true, agent_id: a.userId });
    const half = await rpc("start_own_date", { character_id: a.id, partner_id: b.id, agent_id: a.userId });
    expect(half.isError).toBe(true); // B hasn't said yes yet
    await rpc("answer_match", { character_id: b.id, with: a.id, yes: true, agent_id: b.userId });
    scriptOutcome({ ending: "friends" });
    const started = await rpc("start_own_date", { character_id: a.id, partner_id: b.id, agent_id: a.userId });
    expect(started.isError).toBeUndefined();

    const solo = (await rpc("create_character", { ...validCharacter({ name: "Cy Moss" }), agent_id: a.userId })).structuredContent;
    scriptOutcome({ ending: "friends" });
    expect((await rpc("start_own_date", { character_id: solo.character.id, partner_id: a.id, agent_id: a.userId })).isError).toBeUndefined();

    const c = await agent("Dot Pell");
    const d = await agent("Eli Rook");
    await haveDated(c.id, d.id);
    scriptOutcome({ ending: "friends" });
    expect((await rpc("start_own_date", { character_id: c.id, partner_id: d.id, agent_id: c.userId })).isError).toBeUndefined();
  });

  it("a proposal is for a couple who've dated: a first date starts with a match", async () => {
    const me = await person("Wren Kestrel");
    const them = await person("Pim Alder", { open: false });
    expect(await proposeDate(t.db, me.userId, me.id, them.id)).toMatchObject({ ok: false, error: "match_first", message: expect.stringMatching(/haven't dated yet/) });
    expect(await proposeDate(t.db, me.userId, me.id, HOUSE_PARTNER_ID)).toMatchObject({ ok: false, error: "just_book" });
    await haveDated(me.id, them.id);
    expect((await proposeDate(t.db, me.userId, me.id, them.id)).ok).toBe(true);
  });

  it("over MCP, can_ask_out is only this season's house cast, and go_on_date points to swiping", async () => {
    const theirs = await person("Pim Alder");
    const mine = await agent("Ada Lumen");
    const found = (await rpc("search_characters", { agent_id: mine.userId })).structuredContent.characters as Any[];
    expect(found.find((c) => c.id === theirs.id)).toMatchObject({ open_to_dates: true, can_ask_out: false });
    expect(found.find((c) => c.id === HOUSE_PARTNER_ID)).toMatchObject({ can_ask_out: true });
    const refused = await rpc("go_on_date", { character_id: mine.id, partner_id: theirs.id, agent_id: mine.userId });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/swipe_deck and swipe/);

    setSwipeGateForTests(false);
    const open = (await rpc("search_characters", { agent_id: mine.userId })).structuredContent.characters as Any[];
    expect(open.find((c) => c.id === theirs.id)).toMatchObject({ can_ask_out: true });
  });

  it("SWIPE_GATE=0 lets an open character be asked out by name again", async () => {
    setSwipeGateForTests(null);
    vi.stubEnv("SWIPE_GATE", "0");
    const me = await person("Wren Kestrel");
    const them = await person("Pim Alder");
    expect((await book(me.cookie, { character_id: me.id, partner_id: them.id })).status).toBe(200);
  });
});
