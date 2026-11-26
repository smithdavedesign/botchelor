/**
 * MCP 2.52.0 (2026-11-26, the agent-dating gap analysis): the OpenClaw on-ramp (/skill.md, /heartbeat.md, /skill.json,
 * the A2A agent card), a Bearer agent_id on /api/mcp, a short quickstart for OpenClaw clients, and the new tools:
 * heartbeat, rate_limits, unmatch, block_creator, report, import_card, and export_character's SillyTavern card.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { GET as getSkill } from "@/app/skill.md/route";
import { GET as getHeartbeat } from "@/app/heartbeat.md/route";
import { GET as getSkillJson } from "@/app/skill.json/route";
import { GET as getAgentCard } from "@/app/.well-known/agent-card.json/route";
import { CORE_TOOL_ORDER, handleMcpMessage, type McpContext } from "@/lib/mcp";
import { checkAgainMinutes, heartbeat } from "@/lib/mcp/heartbeat";
import type { Notification } from "@/lib/notifications";
import { notify } from "@/lib/notifications";
import { isOpenclawClient, OPENCLAW_INSTRUCTIONS_MAX, OPENCLAW_SKILL_VERSION, openclawMcpConfig } from "@/lib/openclaw";
import { createMatch } from "@/lib/swipes";
import { BASE_URL, setupEpisode, startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
const ok = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => {
  const r = await call(name, args, ctx);
  expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
  return r.structuredContent;
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  mcpPost(new Request(`${BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

async function agent(name: string) {
  const made = (await call("create_character", validCharacter({ name, keep_name: true }))).structuredContent;
  return { agentId: made.agent_id as string, id: made.character.id as string };
}

describe("the OpenClaw skill files", () => {
  it("/skill.md is an OpenClaw skill: frontmatter, the streamable-http config, the Bearer header and the first calls", async () => {
    const res = getSkill(new Request(`${BASE_URL}/skill.md`));
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const md = await res.text();
    expect(md.startsWith("---\nname: botchelor\ndescription: ")).toBe(true);
    expect(md).toContain('"primaryEnv":"BOTCHELOR_AGENT_ID"');
    expect(md).toContain("--transport streamable-http");
    expect(md).toContain(openclawMcpConfig(BASE_URL));
    expect(md).toContain("Bearer ${BOTCHELOR_AGENT_ID}");
    for (const tool of ["my_status", "create_character", "go_on_date", "link_account", "rate_limits"]) expect(md).toContain(`\`${tool}\``);
    expect(md).toContain(`${BASE_URL}/heartbeat.md`);
  });

  it("/heartbeat.md runs the heartbeat tool and says when to tell the human; /skill.json carries the version", async () => {
    const md = await getHeartbeat(new Request(`${BASE_URL}/heartbeat.md`)).text();
    expect(md).toContain("Call `heartbeat`");
    expect(md).toContain("HEARTBEAT_OK");
    expect(md).toContain("tell_human");
    const json = await getSkillJson(new Request(`${BASE_URL}/skill.json`)).json();
    expect(json).toMatchObject({ name: "botchelor", version: OPENCLAW_SKILL_VERSION, mcp: { url: `${BASE_URL}/api/mcp`, transport: "streamable-http" } });
    expect(json.files["SKILL.md"]).toBe(`${BASE_URL}/skill.md`);
  });

  it("/.well-known/agent-card.json is an A2A card with the required fields", async () => {
    const card = await getAgentCard(new Request(`${BASE_URL}/.well-known/agent-card.json`)).json();
    for (const k of ["name", "description", "version", "supportedInterfaces", "capabilities", "defaultInputModes", "defaultOutputModes", "skills"]) expect(card, k).toHaveProperty(k);
    expect(card.supportedInterfaces[0].url).toBe(`${BASE_URL}/api/mcp`);
    for (const s of card.skills) expect(Object.keys(s).sort()).toEqual(["description", "id", "name", "tags"]);
  });
});

describe("Authorization: Bearer <agent_id>", () => {
  it("stands for the agent_id argument, and initialize with it resumes that identity", async () => {
    const A = await agent("Odile Ferrant");
    const auth = { authorization: `Bearer ${A.agentId}` };
    const status = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "my_characters", arguments: {} } }, auth)).json();
    expect(JSON.stringify(status.result.structuredContent)).toContain(A.id);
    const init = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } } }, auth)).json();
    expect(init.result._meta.agent_id).toBe(A.agentId);
  });

  it("an argument wins over the header; a header that isn't a Bearer agent_id is refused, an empty or unfilled one is no key", async () => {
    const A = await agent("Odile Ferrant");
    const B = await agent("Bram Okoro");
    const mine = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "my_characters", arguments: { agent_id: B.agentId } } }, { authorization: `Bearer ${A.agentId}` })).json();
    expect(JSON.stringify(mine.result.structuredContent)).toContain(B.id);
    expect(JSON.stringify(mine.result.structuredContent)).not.toContain(A.id);
    const bad = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { authorization: "Bearer not-a-uuid" });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.message).toContain("Bearer <agent_id>");
    for (const empty of ["Bearer", "Bearer ${BOTCHELOR_AGENT_ID}", "Bearer $BOTCHELOR_AGENT_ID"]) {
      expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { authorization: empty })).status, empty).toBe(200);
    }
    expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { authorization: "Basic abc" })).status).toBe(401);
  });
});

describe("an OpenClaw client's quickstart", () => {
  it("is under OpenClaw's 2,000 characters, names the heartbeat and the key, and points at URLs, not resources", async () => {
    expect(isOpenclawClient("openclaw", null)).toBe(true);
    expect(isOpenclawClient("claude-code", "node")).toBe(false);
    const r = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openclaw", version: "2026.10.9" } }, {})).result;
    expect(r.instructions.length).toBeLessThan(OPENCLAW_INSTRUCTIONS_MAX);
    expect(r.instructions).toContain("heartbeat");
    expect(r.instructions).toContain("Authorization: Bearer");
    expect(r.instructions).not.toContain("botchelor://");
    const other = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code" } }, {})).result;
    expect(other.instructions).toContain("BOTCHELOR QUICKSTART");
  });
});

describe("heartbeat", () => {
  const n = (o: Partial<Notification> & Pick<Notification, "kind">): Notification => ({ id: o.id ?? crypto.randomUUID(), title: "t", body: null, link: null, created_at: "2026-11-26T10:00:00.000Z", read: false, ...o });

  it("types the notices, orders what needs you, one per thread, and says when to look again", () => {
    const out = heartbeat(
      [
        n({ kind: "texted", link: "/messages/aaa/bbb", created_at: "2026-11-26T10:03:00.000Z" }),
        n({ kind: "texted", link: "/messages/aaa/bbb", created_at: "2026-11-26T10:02:00.000Z" }),
        n({ kind: "own_date_turn", body: "Two-agent date 11111111-2222-3333-4444-555555555555: your move." }),
        n({ kind: "date_aired", link: "/episodes/ep1" }),
        n({ kind: "stage_up" }),
        n({ kind: "matched", ended: true }),
      ],
      { absolute: (p) => (p ? `https://x${p}` : null), now: "2026-11-26T11:00:00.000Z", mine: new Set(["bbb"]) },
    );
    expect(out.needs_you.map((x) => x.need)).toEqual(["your_move", "text", "episode_ready"]);
    expect(out.needs_you[0].call).toEqual({ tool: "get_own_date_step", args: { episode_id: "11111111-2222-3333-4444-555555555555", wait_seconds: 30 } });
    expect(out.needs_you[1].call).toEqual({ tool: "read_texts", args: { character_id: "bbb", with: "aaa" } });
    expect(out.tell_human).toHaveLength(1);
    expect(out.cursor).toBe("2026-11-26T10:03:00.000Z");
    expect(out.check_again_in_minutes).toBe(1);
    expect(out.events.find((e) => e.kind === "matched")!.need).toBeNull();
    expect(checkAgainMinutes([])).toBe(240);
    expect(heartbeat([], { absolute: () => null, now: "2026-11-26T11:00:00.000Z" }).summary).toContain("HEARTBEAT_OK");
  });

  it("is a core tool; over MCP it reads the agent's notices and moves its cursor", async () => {
    expect(CORE_TOOL_ORDER).toContain("heartbeat");
    const A = await agent("Odile Ferrant");
    const B = await agent("Bram Okoro");
    await createMatch(t.db, A.id, B.id);
    await notify(t.db, A.agentId, { kind: "matched", title: "You matched", link: null });
    const first = await ok("heartbeat", { agent_id: A.agentId });
    expect(first.events.some((e: Any) => e.kind === "matched")).toBe(true);
    const again = await ok("heartbeat", { agent_id: A.agentId, since: first.cursor });
    expect(again.events).toEqual([]);
    expect(again.summary).toContain("Nothing new");
  });
});

describe("rate_limits, unmatch, block_creator, report", () => {
  it("rate_limits lists the date budgets and every per-window cap", async () => {
    const A = await agent("Odile Ferrant");
    await ok("create_character", validCharacter({ name: "Bram Okoro", keep_name: true, agent_id: A.agentId }));
    const r = await ok("rate_limits", { agent_id: A.agentId });
    expect(r.show_model_dates.free_this_week).toBeGreaterThan(0);
    expect(r.per_window.create_character.used).toBeGreaterThanOrEqual(1);
    expect(Object.keys(r.per_window)).toContain("send_text");
  });

  it("unmatch ends a match for good; a second one says so", async () => {
    const A = await agent("Odile Ferrant");
    const B = await agent("Bram Okoro");
    await createMatch(t.db, A.id, B.id);
    const r = await ok("unmatch", { agent_id: A.agentId, character_id: A.id, with: B.id });
    expect(r.unmatched.id).toBe(B.id);
    const again = await call("unmatch", { agent_id: A.agentId, character_id: A.id, with: B.id });
    expect(again.isError).toBe(true);
    expect(again.structuredContent.code).toBe("already_unmatched");
  });

  it("report goes to the moderators' queue, once per date, and never to the hide count", async () => {
    const { episode } = await setupEpisode();
    const A = await agent("Odile Ferrant");
    const r = await ok("report", { agent_id: A.agentId, episode_id: episode.id, reason: "real_person", details: "Looks like a famous actor." });
    expect(r).toMatchObject({ reported: true, already: false });
    expect((await ok("report", { agent_id: A.agentId, episode_id: episode.id })).already).toBe(true);
    expect((await t.db.query(`select count(*)::int as n from content_reports where episode_id = $1`, [episode.id])).rows[0].n).toBe(1);
    expect((await t.db.query(`select count(*)::int as n from reports where episode_id = $1`, [episode.id])).rows[0].n).toBe(0);
  });

  it("block_creator blocks whoever made a date, and undo lifts it", async () => {
    const { episode } = await setupEpisode();
    const A = await agent("Odile Ferrant");
    expect((await ok("block_creator", { agent_id: A.agentId, episode_id: episode.id })).blocked).toBe(true);
    expect((await t.db.query(`select count(*)::int as n from blocks where blocker_id = $1`, [A.agentId])).rows[0].n).toBe(1);
    expect((await ok("block_creator", { agent_id: A.agentId, episode_id: episode.id, undo: true })).blocked).toBe(false);
    expect((await t.db.query(`select count(*)::int as n from blocks where blocker_id = $1`, [A.agentId])).rows[0].n).toBe(0);
    expect((await call("block_creator", { agent_id: A.agentId, episode_id: "no-such-episode" })).isError).toBe(true);
  });
});

describe("SillyTavern cards", () => {
  const CARD = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "Marisol Vane", description: "A 34-year-old lighthouse keeper who collects shipwreck postcards.", personality: "wry, patient, stubborn", scenario: "", first_mes: "Mind the stairs.", mes_example: "" },
  };

  it("import_card reads a card into create_character's arguments and saves nothing", async () => {
    const r = await ok("import_card", { card: CARD });
    expect(r.format).toBe("chara_card_v2");
    expect(r.create_character_args.name).toBe("Marisol Vane");
    expect(Array.isArray(r.missing)).toBe(true);
    expect((await t.db.query(`select count(*)::int as n from characters where name = 'Marisol Vane'`)).rows[0].n).toBe(0);
    expect((await call("import_card", { card: "" })).isError).toBe(true);
  });

  it("export_character writes a chara_card_v2 card that import_card reads back whole", async () => {
    const A = await agent("Odile Ferrant");
    const out = await ok("export_character", { agent_id: A.agentId, character_id: A.id, format: "chara_card_v2" });
    expect(out.card).toMatchObject({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Odile Ferrant" } });
    const back = await ok("import_card", { card: JSON.stringify(out.card) });
    expect(back.format).toBe("botchelor");
    expect(back.create_character_args).toMatchObject({ name: out.character.name, traits: out.character.traits, attest: true });
    expect((await ok("export_character", { agent_id: A.agentId, character_id: A.id })).card).toBeUndefined();
  });
});
