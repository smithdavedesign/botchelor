import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// What's waiting on an agent reads each match and date by the key in its notice's link (2026-11-22: on the link alone,
// every call built every match's dates). The counts stay what they were: these pin the match and date-agreed rules.
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

async function agentWithMatch() {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "waiting-counts-keyed" } } }, ctx);
  const c: McpContext = { sessionId: ctx.issuedSessionId };
  const made = (await call("create_character", validCharacter({ name: "Ada Lumen" }), c)).structuredContent;
  const mine: string = made.character.id;
  const [lo, hi] = [mine, HOUSE_PARTNER_ID].sort();
  await t.db.query(`insert into matches (character_lo, character_hi, matched_at) values ($1, $2, now() - interval '2 hours')`, [lo, hi]);
  const notice = async (kind: string, link = `/messages/${lo}/${hi}`) =>
    (
      await t.db.query<{ id: string }>(
        `insert into notifications (id, user_id, kind, title, body, link) values (gen_random_uuid()::text, $1, $2, 'x', 'x', $3) returning id`,
        [made.agent_id, kind, link],
      )
    ).rows[0].id;
  const counts = async () => (await call("my_characters", {}, c)).structuredContent.waiting_for_you ?? {};
  return { ctx: c, agentId: made.agent_id as string, mine, lo, hi, notice, counts };
}

describe("what's waiting, read by the key in each notice's link", () => {
  it("counts a match until this agent answers it, and only for its own pair", async () => {
    const a = await agentWithMatch();
    await a.notice("matched");
    // A notice whose link names no match of this agent's still counts, as before.
    await a.notice("matched", `/messages/${a.lo}/nobody`);
    expect((await a.counts()).matched).toBe(2);
    await t.db.query(`update matches set ${a.lo === a.mine ? "yes_lo" : "yes_hi"} = true where character_lo = $1 and character_hi = $2`, [a.lo, a.hi]);
    expect((await a.counts()).matched).toBe(1);
  });

  it("counts a date agreed until a date between the pair exists from the agreement on", async () => {
    const a = await agentWithMatch();
    await t.db.query(`update matches set agreed_at = now() - interval '1 hour' where character_lo = $1 and character_hi = $2`, [a.lo, a.hi]);
    const id = await a.notice("date_agreed");
    expect((await a.counts()).date_agreed).toBe(1);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    await call("go_on_date", { character_id: a.mine, partner_id: HOUSE_PARTNER_ID }, a.ctx);
    // Going on the date marks the notice read; unread again, it's the date's existence that keeps it from counting.
    await t.db.query(`update notifications set read_at = null where id = $1`, [id]);
    expect((await a.counts()).date_agreed ?? 0).toBe(0);

    // A date from before the agreement doesn't settle it.
    await t.db.query(`update matches set agreed_at = now() + interval '1 hour' where character_lo = $1 and character_hi = $2`, [a.lo, a.hi]);
    expect((await a.counts()).date_agreed).toBe(1);
  });
});
