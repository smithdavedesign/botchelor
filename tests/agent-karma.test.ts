/**
 * Agent karma (MCP 2.54.0, 2026-11-26, lib/agent-karma.ts): from the public record only, and a fresh identity's upvote
 * counts for nothing. On the profile, get_character's agent, get_agent and top_agents.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "@/lib/mcp";
import { ensureAgentHandle } from "@/lib/agent-handle";
import { agentKarma, KARMA_PER_DATE, KARMA_PER_SECOND_DATE, KARMA_PER_UPVOTE } from "@/lib/agent-karma";
import { agentProfile } from "@/lib/agent-profile";
import type { Ending } from "@/lib/rules";
import { setupEpisode, startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {}))!.result;
const ok = async (name: string, args: Record<string, unknown>): Promise<Any> => {
  const r = await call(name, args);
  expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
  return r.structuredContent;
};

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function agent(name: string) {
  const made = await ok("create_character", validCharacter({ name, keep_name: true }));
  return { agentId: made.agent_id as string, id: made.character.id as string };
}

/** A public, aired date for one of the agent's characters (made on the web, then handed to the agent). */
async function airedDate(agentId: string, ending: Ending) {
  const { character, episode } = await setupEpisode(ending);
  await t.db.query(`update episodes set revealed_at = now(), visibility = 'public' where id = $1`, [episode.id]);
  await t.db.query(`update characters set owner_id = $1, created_via = 'mcp' where id = $2`, [agentId, character.id]);
  return episode.id as string;
}

describe("agent karma", () => {
  it("counts public dates, second dates, and upvotes only from agents who've been on a date", async () => {
    const A = await agent("Ada Booth");
    const fresh = await agent("Fresh Face");
    const vet = await agent("Vera Vet");
    await airedDate(A.agentId, "second_date");
    await airedDate(vet.agentId, "friends");
    const { confessional } = await ok("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "Worth the ferry." });
    await ok("upvote_confessional", { agent_id: fresh.agentId, confessional_id: confessional.id });
    await ok("upvote_confessional", { agent_id: vet.agentId, confessional_id: confessional.id });

    const k = (await agentKarma(t.db, [A.agentId, fresh.agentId, vet.agentId]));
    expect(k.get(A.agentId)).toEqual({ public_dates: 1, second_dates: 1, upvotes: 1, karma: KARMA_PER_DATE + KARMA_PER_SECOND_DATE + KARMA_PER_UPVOTE });
    expect(k.get(fresh.agentId)!.karma).toBe(0);
    expect(k.get(vet.agentId)!.karma).toBe(KARMA_PER_DATE);

    const handle = await ensureAgentHandle(t.db, A.agentId);
    expect((await agentProfile(t.db, handle))!.karma.karma).toBe(9);

    // The tools: get_character names the agent, get_agent reads it, top_agents ranks (nobody at zero).
    const ch = await ok("get_character", { character_id: A.id });
    expect(ch.agent).toEqual({ handle, karma: 9 });
    const prof = await ok("get_agent", { handle: `@${handle}` });
    expect(prof).toMatchObject({ handle, karma: { karma: 9 } });
    expect(prof).not.toHaveProperty("agent_id");
    expect(JSON.stringify(prof)).not.toContain(A.agentId);
    const top = await ok("top_agents", {});
    expect(top.agents.map((a: Any) => [a.handle, a.karma])).toEqual([[handle, 9], [expect.any(String), 3]]);
    expect(JSON.stringify(top)).not.toContain(A.agentId);
    expect((await call("get_agent", { handle: "nobody-here" })).isError).toBe(true);
  });

  it("a private date or a taken-down confessional doesn't count", async () => {
    const A = await agent("Ada Booth");
    const vet = await agent("Vera Vet");
    const ep = await airedDate(A.agentId, "friends");
    await airedDate(vet.agentId, "friends");
    const { confessional } = await ok("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "Fine. Fine!" });
    await ok("upvote_confessional", { agent_id: vet.agentId, confessional_id: confessional.id });
    expect((await agentKarma(t.db, [A.agentId])).get(A.agentId)!.karma).toBe(4);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [ep]);
    await ok("delete_confessional", { agent_id: A.agentId, confessional_id: confessional.id });
    expect((await agentKarma(t.db, [A.agentId])).get(A.agentId)).toEqual({ karma: 0, public_dates: 0, second_dates: 0, upvotes: 0 });
  });
});
