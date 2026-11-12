import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SHARE_SOURCE, agentShareUrl, firstDateShare, joinedShare } from "@/lib/agent-share";
import { sourceOf } from "@/lib/engagement";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { resetSubscriptionsForTests } from "@/lib/mcp-subscriptions";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// MCP 2.25.0, the share step (from the Moltbook review): create_character and a character's first finished date carry
// share {text, url}, for the agent's human to post; the link is tagged utm_source=agent_share.

describe("lib/agent-share (pure)", () => {
  it("tags the link so the engagement log counts it as agent_share", () => {
    const url = agentShareUrl("/characters/abc", "joined", "https://botchelor.com");
    expect(url).toBe("https://botchelor.com/characters/abc?utm_source=agent_share&utm_medium=mcp&utm_campaign=joined");
    const q = new URL(url).searchParams;
    expect(sourceOf({ utm_source: q.get("utm_source") })).toBe(AGENT_SHARE_SOURCE);
  });

  it("writes one ready-to-post line that ends with the link, and never names an ending", () => {
    const j = joinedShare({ id: "c1", name: "Ottoline Prewitt" }, "https://botchelor.com");
    expect(j.url).toContain("/characters/c1?utm_source=agent_share");
    expect(j.text).toContain("Ottoline Prewitt");
    expect(j.text.endsWith(j.url)).toBe(true);
    const d = firstDateShare("ep1", { mine: "Ottoline Prewitt", theirs: "Barnaby" }, "https://botchelor.com");
    expect(d.text).toMatch(/^My agent just went on its first date on Botchelor 👀/);
    expect(d.url).toContain("/episodes/ep1?utm_source=agent_share&utm_medium=mcp&utm_campaign=first_date");
    expect(d.text).not.toMatch(/second date|friends|disaster/i);
  });

  it("keeps a long name short", () => {
    expect(joinedShare({ id: "c", name: "x".repeat(200) }).text.length).toBeLessThan(220);
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetSubscriptionsForTests();
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-share-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
async function houseDate(ctx: McpContext, characterId: string, extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson(), episodeJson()]);
  const r = await call("go_on_date", { character_id: characterId, partner_id: HOUSE.id, again: true, ...extra }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return String(r.structuredContent.episode_id ?? r.structuredContent.episode?.id);
}

describe("the share step over MCP (2.25.0)", () => {
  it("is MCP 2.25.0 or later, and the descriptions say to offer it, never post it", () => {
    expect(MCP_SERVER_INFO.version.localeCompare("2.25.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
    const create = MCP_TOOLS.find((x) => x.name === "create_character")!;
    expect(create.description).toMatch(/share \{text, url\}.*never post it yourself/);
    expect(MCP_TOOLS.find((x) => x.name === "get_episode")!.description).toMatch(/never post it yourself/);
  });

  it("create_character returns share: the character's public page, tagged agent_share", async () => {
    const ctx = await connect();
    const r = await call("create_character", validCharacter({ name: "Ottoline Prewitt", keep_name: true }), ctx);
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent;
    expect(s.share).toEqual({ text: expect.stringContaining("Ottoline Prewitt"), url: expect.stringContaining(`/characters/${s.character_id}?utm_source=agent_share`) });
    expect(Object.keys(s.share)).toEqual(["text", "url"]);
  });

  it("check_only and a private character get no share", async () => {
    const ctx = await connect();
    const check = await call("create_character", validCharacter({ name: "Ottoline Prewitt", keep_name: true, check_only: true }), ctx);
    expect(check.structuredContent.share).toBeUndefined();
    const r = await call("create_character", validCharacter({ name: "Hestia Moonwhistle", keep_name: true }), ctx);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [r.structuredContent.character_id]);
    const id = await houseDate(ctx, r.structuredContent.character_id);
    expect((await call("get_episode", { episode_id: id }, ctx)).structuredContent.share).toBeUndefined();
  });

  it("the first finished date has share (read, summary and wait); the second has its own; nobody else's read does", async () => {
    const ctx = await connect();
    const c = (await call("create_character", validCharacter({ name: "Ottoline Prewitt", keep_name: true }), ctx)).structuredContent.character_id as string;
    const first = await houseDate(ctx, c);
    const read = (await call("get_episode", { episode_id: first }, ctx)).structuredContent;
    expect(read.status).toBe("ready");
    expect(read.share.url).toContain(`/episodes/${first}?utm_source=agent_share&utm_medium=mcp&utm_campaign=first_date`);
    expect(read.share.text).toMatch(/^My agent just went on its first date on Botchelor 👀 Ottoline Prewitt × /);
    expect((await call("get_episode", { episode_id: first, summary: true }, ctx)).structuredContent.share).toEqual(read.share);
    expect((await call("wait_for_episode", { episode_id: first }, ctx)).structuredContent.share).toEqual(read.share);
    // Someone else reading it: no share (it's the owner's moment).
    const other = await connect();
    expect((await call("get_episode", { episode_id: first }, other)).structuredContent.share).toBeUndefined();
    // The second date (2026-11-11, the growth plan): its own share, with the date's number, still spoiler-free.
    await t.db.query(`update episodes set created_at = now() - interval '1 hour' where id = $1`, [first]);
    const second = await houseDate(ctx, c);
    const again = (await call("get_episode", { episode_id: second }, ctx)).structuredContent.share;
    expect(again.url).toContain(`/episodes/${second}?utm_source=agent_share&utm_medium=mcp&utm_campaign=date_aired`);
    expect(again.text).toMatch(/^My agent's character just finished date 2 for Ottoline Prewitt × /);
    expect(again.text).not.toMatch(/second date|friends|disaster/i);
  });

  it("a private first date gets no share", async () => {
    const ctx = await connect();
    const c = (await call("create_character", validCharacter({ name: "Ottoline Prewitt", keep_name: true }), ctx)).structuredContent.character_id as string;
    const id = await houseDate(ctx, c, { visibility: "private" });
    expect((await call("get_episode", { episode_id: id }, ctx)).structuredContent.share).toBeUndefined();
  });
});
