import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { AGENT_DAILY_DATES_DEFAULT, agentDailyDateCap } from "@/lib/dating";
import { peekRateLimit, resetRateLimitsForTests } from "@/lib/rate-limit";
import { heartbeat, withLive } from "@/lib/mcp/heartbeat";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 40-visitor simulation of 2026-11-28: what its MCP agents hit.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetRateLimitsForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "sim-2026-11-28-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

describe("the agent date pool", () => {
  it("defaults to 60 a day, and the switch still sets it", () => {
    expect(AGENT_DAILY_DATES_DEFAULT).toBe(60);
    expect(agentDailyDateCap({} as unknown as NodeJS.ProcessEnv)).toBe(60);
    expect(agentDailyDateCap({ BOTCHELOR_AGENT_DAILY_DATES: "5" } as unknown as NodeJS.ProcessEnv)).toBe(5);
  });
});

describe("rate limits", () => {
  it("a refused call doesn't count against the limit", async () => {
    const ctx = await connect();
    const r = await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx);
    expect(r.isError).toBeFalsy();
    const agent = r.structuredContent.agent_id as string;
    const before = peekRateLimit(agent, "swipe").used;
    const bad = await call("swipe", { character_id: r.structuredContent.character.id, target_id: "no-such-character", like: true }, ctx);
    expect(bad.isError).toBe(true);
    expect(peekRateLimit(agent, "swipe").used).toBe(before);
  });

  it("a call over a limit says rate_limited, with retry_after_seconds", async () => {
    const ctx = await connect();
    const r = await call("create_character", validCharacter({ name: "Bo Quill" }), ctx);
    const agent = r.structuredContent.agent_id as string;
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 100; i++) checkRateLimit(agent, "swipe");
    const out = await call("swipe", { character_id: r.structuredContent.character.id, target_id: "anyone", like: true }, ctx);
    expect(out.isError).toBe(true);
    expect(out.structuredContent.code).toBe("rate_limited");
    expect(out.structuredContent.retry_after_seconds).toBeGreaterThan(0);
  });
});

describe("heartbeat sees what no notice says", () => {
  const now = "2026-11-28T12:00:00.000Z";
  const absolute = (p: string | null) => (p ? `https://x${p}` : null);
  it("likes waiting are a need, a date airing soon is told, and the next check is when it airs", () => {
    const out = withLive(
      heartbeat([], { absolute, now }),
      { likes: [{ character_id: "c1", name: "Ada", likes: 6 }], airing: [{ episode_id: "e1", date: "Ada × Bo", airs_at: "2026-11-28T12:05:00.000Z" }] },
      { now, absolute },
    );
    expect(out.summary).toMatch(/6 likes waiting/);
    expect(out.summary).not.toMatch(/Nothing new/);
    expect(out.needs_you[0].call).toEqual({ tool: "swipe_deck", args: { character_id: "c1" } });
    expect(out.tell_human[0].title).toMatch(/airs soon/);
    expect(out.check_again_in_minutes).toBe(5);
  });
  it("leaves a quiet heartbeat alone", () => {
    const out = withLive(heartbeat([], { absolute, now }), { likes: [], airing: [] }, { now, absolute });
    expect(out.summary).toMatch(/Nothing new/);
  });
});

describe("read_letters box", () => {
  it("reads sent as out and inbox as in", async () => {
    const { normaliseArgs } = await import("@/lib/mcp");
    expect(normaliseArgs("read_letters", { box: "sent" }).args.box).toBe("out");
    expect(normaliseArgs("read_letters", { box: "Inbox" }).args.box).toBe("in");
  });
});

describe("a second identity from the same address", () => {
  it("can't predict a date the first one made", async () => {
    const owner: McpContext = { visitor: "same-address" };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "owner" } }, owner);
    const ownerCtx: McpContext = { sessionId: owner.issuedSessionId, visitor: "same-address" };
    const made = await call("create_character", validCharacter({ name: "Ada Lumen" }), ownerCtx);
    expect(made.isError).toBeFalsy();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = await call("go_on_date", { character_id: made.structuredContent.character.id, partner_id: HOUSE_PARTNER_ID }, ownerCtx);
    expect(booked.isError).toBeFalsy();
    const episodeId = booked.structuredContent.episode?.id ?? booked.structuredContent.episode_id;
    expect(episodeId).toBeTruthy();
    const puppet: McpContext = { visitor: "same-address" };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "puppet" } }, puppet);
    const r = await call("predict", { episode_id: episodeId, pick: "friends" }, { sessionId: puppet.issuedSessionId, visitor: "same-address" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/same connection/);
    // Another address is a different person.
    const other: McpContext = { visitor: "elsewhere" };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "other" } }, other);
    const ok = await call("predict", { episode_id: episodeId, pick: "friends" }, { sessionId: other.issuedSessionId, visitor: "elsewhere" });
    expect(ok.content[0].text).not.toMatch(/same connection/);
  });
});
