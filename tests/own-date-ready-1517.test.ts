import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1517 (run 2026-11-13-0904): my_status kept counting own_date_ready long after the agent's dates were finished.
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
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

async function finishedDateWithNotice() {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "own-date-ready-1517" } } }, ctx);
  const c: McpContext = { sessionId: ctx.issuedSessionId };
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const made = (await call("create_character", validCharacter({ name: "Ada Lumen" }), c)).structuredContent;
  const ep = (await call("go_on_date", { character_id: made.character.id, partner_id: HOUSE_PARTNER_ID }, c)).structuredContent.episode;
  await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
  await t.db.query(
    `insert into notifications (id, user_id, kind, title, body, link) values (gen_random_uuid()::text, $1, 'own_date_ready', 'Done', 'x', $2)`,
    [made.agent_id, `/episodes/${ep.id}`],
  );
  return { ctx: c, episodeId: ep.id as string };
}

const readyCount = async (ctx: McpContext) => (await call("my_characters", {}, ctx)).structuredContent.waiting_for_you?.own_date_ready ?? 0;

describe("own_date_ready counts only while it's still true (#1517)", () => {
  it("stops counting once my_dates has listed the finished date", async () => {
    const { ctx } = await finishedDateWithNotice();
    expect(await readyCount(ctx)).toBe(1);
    await call("my_dates", {}, ctx);
    expect(await readyCount(ctx)).toBe(0);
  });

  it("doesn't count a notice whose date is gone (a failed or declined date is deleted)", async () => {
    const { ctx, episodeId } = await finishedDateWithNotice();
    await t.db.query(`delete from episodes where id = $1`, [episodeId]);
    expect(await readyCount(ctx)).toBe(0);
  });
});
