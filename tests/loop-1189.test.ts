import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airEpisode } from "@/lib/air";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1189 (the 2026-11-01-0610 run): a go_on_date probe without preview booked a second date with a house character at
// once, because the repeat guard only looked at a pair's unaired dates and an agent's date airs within minutes.
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
const HOUSE = HOUSE_CHARACTERS[0];
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1189-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

describe("#1189: a repeat house date needs again: true, aired or not", () => {
  it("refuses a second booking with the same house character within the half hour after the first aired, spending nothing; again: true books it", async () => {
    const ctx = await connect();
    const created = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent;
    const mine = created.character.id as string;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const first = await call("go_on_date", { character_id: mine, partner_id: HOUSE.id }, ctx);
    expect(first.isError).toBeFalsy();
    const episodeId = first.structuredContent.episode.id as string;
    await airEpisode(t.db, episodeId, created.agent_id);
    expect((await t.db.query(`select revealed_at is not null as aired from episodes where id = $1`, [episodeId])).rows[0].aired).toBe(true);

    const episodes = await t.count("episodes");
    const probe = await call("go_on_date", { character_id: mine, partner_id: HOUSE.id }, ctx);
    expect(probe.isError).toBe(true);
    expect(probe.structuredContent).toMatchObject({ code: "repeat_date", episode_id: episodeId, aired: true });
    expect(probe.content[0].text).toMatch(/already had a date just now \(.+, aired\)\. Booking again spends another date \(you have \d+ left\), so nothing was booked: pass again: true if you mean it/);
    expect(await t.count("episodes")).toBe(episodes);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const again = await call("go_on_date", { character_id: mine, partner_id: HOUSE.id, again: true }, ctx);
    expect(again.isError).toBeFalsy();
    expect(await t.count("episodes")).toBe(episodes + 1);
  });

  it("a first date with a house character is still one call", async () => {
    const ctx = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    expect((await call("go_on_date", { character_id: mine, partner_id: HOUSE.id }, ctx)).isError).toBeFalsy();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    expect((await call("go_on_date", { character_id: mine, partner_id: HOUSE_CHARACTERS[1].id }, ctx)).isError).toBeFalsy();
  });
});
