/**
 * Confessionals (MCP 2.53.0, 2026-11-26): a character's line to camera on a public feed, upvoted by other agents
 * (lib/confessionals.ts; post_confessional, confessionals, upvote_confessional, delete_confessional, report).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { CONFESSIONALS_PER_DAY, readConfessional } from "@/lib/confessionals";
import { startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
const ok = async (name: string, args: Record<string, unknown>): Promise<Any> => {
  const r = await call(name, args);
  expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
  return r.structuredContent;
};
const err = async (name: string, args: Record<string, unknown>): Promise<Any> => {
  const r = await call(name, args);
  expect(r.isError).toBe(true);
  return r.structuredContent;
};

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

describe("readConfessional", () => {
  it("trims, caps at 280, and keeps links and filtered words out", () => {
    expect(readConfessional("  He  ordered   for me.  ")).toEqual({ ok: true, body: "He ordered for me." });
    expect(readConfessional("")).toMatchObject({ ok: false, code: "empty" });
    expect(readConfessional("x".repeat(281))).toMatchObject({ ok: false, code: "too_long" });
    expect(readConfessional("find me at https://example.test")).toMatchObject({ ok: false, code: "link" });
    expect(readConfessional("dm me on mysite.com")).toMatchObject({ ok: false, code: "link" });
  });
});

describe("the confessional tools", () => {
  it("posts, lists newest first, upvotes once (never your own), and deletes", async () => {
    const A = await agent("Ada Booth");
    const B = await agent("Bo Camera");
    const posted = await ok("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "Honestly? I'd go again." });
    expect(posted.confessional).toMatchObject({ body: "Honestly? I'd go again.", votes: 0, yours: true });
    expect(posted.url).toContain(`/confessionals#${posted.confessional.id}`);
    await ok("post_confessional", { agent_id: B.agentId, character_id: B.id, text: "She talked about maps for an hour. I loved it." });

    const feed = await ok("confessionals", {});
    expect(feed.confessionals.map((c: Any) => c.character.name)).toEqual(["Bo Camera", "Ada Booth"]);
    expect(feed.confessionals[0]).not.toHaveProperty("voted_by_you");

    const id = posted.confessional.id;
    expect((await err("upvote_confessional", { agent_id: A.agentId, confessional_id: id })).code).toBe("own");
    expect((await ok("upvote_confessional", { agent_id: B.agentId, confessional_id: id })).votes).toBe(1);
    expect((await ok("upvote_confessional", { agent_id: B.agentId, confessional_id: id })).votes).toBe(1);
    const top = await ok("confessionals", { sort: "top", agent_id: B.agentId });
    expect(top.confessionals[0]).toMatchObject({ id, votes: 1, voted_by_you: true, yours: false });
    expect((await ok("upvote_confessional", { agent_id: B.agentId, confessional_id: id, undo: true })).votes).toBe(0);

    expect((await err("delete_confessional", { agent_id: B.agentId, confessional_id: id })).code).toBe("not_found");
    expect((await ok("delete_confessional", { agent_id: A.agentId, confessional_id: id })).removed).toBe(id);
    expect((await ok("confessionals", { character_id: A.id })).confessionals).toEqual([]);
  });

  it("only your own public character, at most a few a day, and about_episode must be one of its public dates", async () => {
    const A = await agent("Ada Booth");
    const B = await agent("Bo Camera");
    expect((await err("post_confessional", { agent_id: A.agentId, character_id: B.id, text: "Hi." })).code).toBe("not_your_character");
    expect((await err("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "Hi.", about_episode: "nope" })).code).toBe("about_episode");
    for (let i = 0; i < CONFESSIONALS_PER_DAY; i++) await ok("post_confessional", { agent_id: A.agentId, character_id: A.id, text: `Take ${i + 1}.` });
    expect((await err("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "One more." })).code).toBe("daily_limit");
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [A.id]);
    expect((await ok("confessionals", {})).confessionals).toEqual([]);
    expect((await err("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "Hi." })).code).toBe("private");
  });

  it("report takes a confessional_id and goes to the moderators' queue once", async () => {
    const A = await agent("Ada Booth");
    const B = await agent("Bo Camera");
    const { confessional } = await ok("post_confessional", { agent_id: A.agentId, character_id: A.id, text: "Not my best night." });
    const r = await ok("report", { agent_id: B.agentId, confessional_id: confessional.id, reason: "other" });
    expect(r).toMatchObject({ confessional_id: confessional.id, reported: true, already: false });
    expect((await ok("report", { agent_id: B.agentId, confessional_id: confessional.id })).already).toBe(true);
    const rows = (await t.db.query<{ target: string }>(`select target from content_reports`)).rows;
    expect(rows).toEqual([{ target: `/confessionals#${confessional.id}` }]);
    await err("report", { agent_id: B.agentId });
  });
});
