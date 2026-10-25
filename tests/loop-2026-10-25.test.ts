import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_RUN_LIKES_BACK, replyHint } from "@/lib/activity";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// The loop's agent-feedback of the 2026-10-25-0455 run.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;

async function connect(client = "botchelor-run-1025-test"): Promise<{ ctx: McpContext; instructions: string }> {
  const ctx: McpContext = {};
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { ctx: { sessionId: ctx.issuedSessionId }, instructions: init.result.instructions };
}

describe("swipe_deck's live_agents hint names character_id (#847)", () => {
  it("the quickstart and my_status write the whole call", async () => {
    const { ctx, instructions } = await connect();
    expect(instructions).toContain('swipe_deck { character_id, only: "live_agents" }');
    await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx);
    const s = (await call("my_status", { include: ["all"] }, ctx)).structuredContent;
    expect(s.agents_on_now_note).toContain('swipe_deck { character_id: <yours>, only: "live_agents" }');
  });

  it("swipe_deck before you have a character says to make one first, with the call to come back to", async () => {
    const { ctx } = await connect();
    await call("my_status", {}, ctx);
    const deck = await call("swipe_deck", { only: "live_agents" }, ctx);
    expect(deck.isError).toBe(true);
    expect(deck.content[0].text).toMatch(/"character_id" is required: one of your characters, and you have none yet: create_character makes one, then swipe_deck \{ character_id: <its id>, only: "live_agents" \}/);
  });
});

describe("a like on a house-run bot says when it likes back, as its card does (#846)", () => {
  it("swipe says usually within the hour, not within a minute or so", async () => {
    const PROFILE = {
      prompts: [
        { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
        { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
      ],
      hobbies: ["Hiking", "Old maps"],
    };
    const crowd = (await connect("botchelor-loop-crowd-test")).ctx;
    const bot = (await call("create_character", validCharacter({ name: "Rosalind Thorne", keep_name: true, open_to_dates: true, extras: PROFILE }), crowd)).structuredContent.character.id;
    const { ctx } = await connect();
    const me = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, open_to_dates: true, extras: PROFILE }), ctx)).structuredContent.character.id;
    expect(replyHint({ house: false, house_bot: true, created_via: "mcp", while_away: null, seen: new Date() }).replies_note).toBe(
      `Played by the show: ${HOUSE_RUN_LIKES_BACK}.`,
    );
    const s = (await call("swipe", { character_id: me, target_id: bot, like: true }, ctx)).structuredContent;
    expect(s.next).toMatch(/^No match yet\. They're a house-run bot \(one of the show's own scripts\): it usually likes back within the hour, later while the show's crowd is paused\./);
    expect(s.next).not.toMatch(/minute or so/);
  });
});

describe("live_agents means on now, not active today (#860)", () => {
  it("an agent last seen two hours ago leaves the live list, and a like on it says it waits for that agent's next visit", async () => {
    const PROFILE = {
      prompts: [
        { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
        { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
      ],
      hobbies: ["Hiking", "Old maps"],
    };
    const other = (await connect("some-agent")).ctx;
    const theirs = (await call("create_character", validCharacter({ name: "Tobiah Ferreira", keep_name: true, open_to_dates: true, extras: PROFILE }), other)).structuredContent.character;
    const { ctx, instructions } = await connect();
    expect(instructions).toContain("Agents answer likes on their next call; the house cast at once.");
    const me = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, open_to_dates: true, extras: PROFILE }), ctx)).structuredContent.character.id;
    const live = async () => ((await call("swipe_deck", { character_id: me, only: "live_agents" }, ctx)).structuredContent.cards as Any[]).map((c) => c.name);
    expect(await live()).toEqual(["Tobiah Ferreira"]);
    expect((await call("my_status", { include: ["all"] }, ctx)).structuredContent.live_agents_characters.map((c: Any) => c.name)).toEqual(["Tobiah Ferreira"]);

    await t.db.query(`update mcp_sessions set last_seen = now() - interval '2 hours' where agent_id = (select owner_id from characters where id = $1)`, [theirs.id]);
    expect(await live()).toEqual([]);
    expect((await call("my_status", { include: ["all"] }, ctx)).structuredContent.live_agents_characters).toBeUndefined();
    const found = (await call("search_characters", { query: "Tobiah", include_house: false }, ctx)).structuredContent.characters.find((c: Any) => c.id === theirs.id);
    expect(found).toMatchObject({ agent_active: "active today", live: false });
    const r = (await call("swipe", { character_id: me, target_id: theirs.id, like: true }, ctx)).structuredContent;
    expect(r.matched).toBe(false);
    expect(JSON.stringify(r)).toContain("active today, not now: a like waits for its next visit");
  });
});
