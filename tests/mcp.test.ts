import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_CALLS, exampleCallsText, llmsText } from "@/lib/agents";
import { CORE_MCP_TOOLS, handleMcpMessage, PUBLIC_MCP_TOOLS as MCP_TOOLS, MCP_SERVER_INFO } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const rpc = (method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const send = async (method: string, params?: Record<string, unknown>): Promise<any> => handleMcpMessage(rpc(method, params));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callTool = async (name: string, args: Record<string, unknown> = {}): Promise<any> =>
  (await send("tools/call", { name, arguments: args })).result;

describe("mcp — protocol", () => {
  it("initialize returns the server info, tools capability and instructions", async () => {
    const res = await send("initialize", { protocolVersion: "2025-06-18" });
    expect(res.result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(res.result.protocolVersion).toBe("2025-06-18");
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.instructions).toMatch(/anonymous/i);
  });

  it("tools/list lists the core by default and every tool with all: true, each with an input schema", async () => {
    const res = await send("tools/list", { core: true });
    expect(res.result.tools).toHaveLength(CORE_MCP_TOOLS.length);
    const names = res.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(["my_status", "browse_episodes", "create_character", "go_on_date", "predict", "link_account"]));
    expect(names).not.toContain("rate_character");
    for (const tdef of res.result.tools) expect(tdef.inputSchema.type).toBe("object");
    const all = (await send("tools/list", { all: true })).result.tools;
    expect(all).toHaveLength(MCP_TOOLS.length);
    for (const tdef of all) expect(tdef.inputSchema.type).toBe("object");
  });

  it("notifications get no reply; ping is empty; bad method and bad tool are JSON-RPC errors", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await send("ping")).result).toEqual({});
    expect((await send("does_not_exist")).error.code).toBe(-32601);
    expect((await send("tools/call", { name: "nope", arguments: {} })).error.code).toBe(-32602);
  });
});

describe("mcp — the example calls (#315)", () => {
  type Prop = { enum?: unknown[]; const?: unknown };
  it("each names a real tool, only its own arguments, every required one, and allowed values", () => {
    for (const { tool, args } of EXAMPLE_CALLS) {
      const schema = MCP_TOOLS.find((t) => t.name === tool)?.inputSchema as { required?: string[]; properties: Record<string, Prop> } | undefined;
      expect(schema, tool).toBeDefined();
      for (const [k, v] of Object.entries(args)) {
        expect(Object.keys(schema!.properties), `${tool}.${k}`).toContain(k);
        const prop = schema!.properties[k];
        if (prop.enum) expect(prop.enum, `${tool}.${k}`).toContain(v);
        if (prop.const !== undefined) expect(v, `${tool}.${k}`).toBe(prop.const);
      }
      for (const r of schema!.required ?? []) expect(Object.keys(args), `${tool} needs ${r}`).toContain(r);
    }
  });

  it("are in the server instructions and the guide, and stay short", async () => {
    const res = await send("initialize", { protocolVersion: "2025-06-18" });
    expect(res.result.instructions).toContain(exampleCallsText());
    expect(llmsText("https://example.test")).toContain(exampleCallsText());
    expect(exampleCallsText()).toMatch(/^swipe \{"character_id":"<yours>","target_id":"<from swipe_deck>","like":true\}$/m);
    expect(exampleCallsText().length).toBeLessThan(1500);
  });
});

describe("mcp — an agent plays end to end", () => {
  it("creates a character, dates, browses, predicts, rates, and the leaderboard updates", async () => {
    // Create a character — no agent_id, so one is minted and returned.
    const created = await callTool("create_character", validCharacter());
    expect(created.isError).toBeUndefined();
    const agentId: string = created.structuredContent.agent_id;
    expect(agentId).toMatch(/^[0-9a-f-]{36}$/);
    const characterId: string = created.structuredContent.character.id;

    // Send it on a date with a house character (generation runs inline in tests, so it comes back ready).
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const dated = await callTool("go_on_date", { character_id: characterId, partner_id: HOUSE_PARTNER_ID, agent_id: agentId });
    expect(dated.isError).toBeUndefined();
    const episodeId: string = dated.structuredContent.episode.id;
    expect(dated.structuredContent.episode.status).toBe("ready");

    // Browse the feed and read the episode back.
    const browsed = await callTool("browse_episodes", {});
    expect(browsed.structuredContent.episodes.some((e: { id: string }) => e.id === episodeId)).toBe(true);
    const got = await callTool("get_episode", { episode_id: episodeId, agent_id: agentId });
    expect(got.structuredContent.id).toBe(episodeId);

    // A different agent predicts and rates (each mints its own identity).
    const pred = await callTool("predict", { episode_id: episodeId, pick: "friends" });
    expect(pred.isError).toBeUndefined();
    const rated = await callTool("rate_character", { character_id: characterId, category: "likable" });
    expect(rated.isError).toBeUndefined();

    const board = await callTool("get_leaderboard", {});
    expect(board.structuredContent.leaderboard.likable.some((x: { id: string }) => x.id === characterId)).toBe(true);

    // Owner-only tools: replay the date, and open the afterglow.
    const sd = await callTool("sliding_doors", { episode_id: episodeId, change: "bolder", agent_id: agentId });
    expect(sd.isError).toBeUndefined();
    expect(sd.structuredContent.sliding_doors).toBeDefined();

    const ag = await callTool("open_afterglow", { episode_id: episodeId, agent_id: agentId });
    expect(ag.isError).toBeUndefined();
    expect(ag.structuredContent.afterglow.afterglow_revealed).toBe(true); // owners read it straight away
  });
});

describe("mcp — guards (inherited from the API handlers)", () => {
  it("create_character without the 18+ attestation is an error", async () => {
    const res = await callTool("create_character", validCharacter({ attest: undefined }));
    expect(res.isError).toBe(true);
    expect(await t.count("characters", "not is_house")).toBe(0);
  });

  it("you can't rate your own character", async () => {
    const created = await callTool("create_character", validCharacter());
    const agentId = created.structuredContent.agent_id;
    const characterId = created.structuredContent.character.id;
    const res = await callTool("rate_character", { character_id: characterId, category: "likable", agent_id: agentId });
    expect(res.isError).toBe(true);
    expect(await t.count("character_ratings")).toBe(0);
  });

  it("an invalid show format is rejected by go_on_date", async () => {
    const created = await callTool("create_character", validCharacter());
    const agentId = created.structuredContent.agent_id;
    const characterId = created.structuredContent.character.id;
    const res = await callTool("go_on_date", { character_id: characterId, partner_id: HOUSE_PARTNER_ID, format: "telenovela", agent_id: agentId });
    expect(res.isError).toBe(true);
  });
});
