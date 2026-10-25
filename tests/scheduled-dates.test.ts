import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { runDueScheduledDates, SCHEDULED_MAX_PENDING } from "@/lib/scheduled-dates";
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
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const send = async (method: string, params: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  (await send("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "schedule-test", version: "1" } }, ctx);
  return { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe("schedule_date (lib/scheduled-dates)", () => {
  it("schedules, lists, shows in my_status, bounds the window and the count, and cancels", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Lotte Hale" }), ctx)).structuredContent.character.id;

    const first = await call("schedule_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, at: inMinutes(10) }, ctx);
    expect(first.isError).toBeUndefined();
    const sid = first.structuredContent.scheduled_date.id;
    expect(first.structuredContent.scheduled).toHaveLength(1);

    // Out of the window, both ways.
    expect((await call("schedule_date", { character_id: id, at: inMinutes(8 * 24 * 60) }, ctx)).isError).toBe(true);
    expect((await call("schedule_date", { character_id: id, at: inMinutes(1) }, ctx)).isError).toBe(true);
    // Not your character.
    expect((await call("schedule_date", { character_id: HOUSE_PARTNER_ID, at: inMinutes(10) }, ctx)).isError).toBe(true);

    // Shows where agents look.
    expect((await call("schedule_date", { list: true }, ctx)).structuredContent.scheduled).toHaveLength(1);
    expect((await call("my_status", {}, ctx)).structuredContent.scheduled_dates).toHaveLength(1);

    // At most SCHEDULED_MAX_PENDING waiting.
    for (let i = 1; i < SCHEDULED_MAX_PENDING; i++) {
      expect((await call("schedule_date", { character_id: id, at: inMinutes(20 + i) }, ctx)).isError).toBeUndefined();
    }
    const over = await call("schedule_date", { character_id: id, at: inMinutes(50) }, ctx);
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toMatch(/already waiting/);

    // Cancel puts a slot back.
    expect((await call("schedule_date", { cancel: sid }, ctx)).structuredContent.scheduled).toHaveLength(SCHEDULED_MAX_PENDING - 1);
    expect((await call("schedule_date", { cancel: sid }, ctx)).isError).toBe(true); // already gone
  });

  it("runs a due booking through the real route and tells the creator", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Juni Marsh" }), ctx);
    const id = made.structuredContent.character.id;
    const agentId = made.structuredContent.agent_id;
    await call("schedule_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, at: inMinutes(5) }, ctx);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await runDueScheduledDates(t.db, new Date(Date.now() + 10 * 60_000));
    expect(res).toMatchObject({ ran: 1, booked: 1, waiting: 0, failed: 0 });

    const row = (await t.db.query<Any>(`select episode_id, outcome, ran_at from scheduled_dates`)).rows[0];
    expect(row.outcome).toBe("booked");
    expect(row.ran_at).not.toBeNull();
    const ep = (await t.db.query<Any>(`select created_via from episodes where id = $1`, [row.episode_id])).rows[0];
    expect(ep.created_via).toBe("mcp");
    const note = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'scheduled_date'`, [agentId])).rows;
    expect(note).toHaveLength(1);
    expect(note[0].title).toMatch(/booked/);
  });

  it("a full shared pool waits an hour, and gives up with a notice after its last try", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "0");
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Pia Voss" }), ctx);
    const id = made.structuredContent.character.id;
    const agentId = made.structuredContent.agent_id;
    await call("schedule_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, at: inMinutes(5) }, ctx);

    const later = new Date(Date.now() + 10 * 60_000);
    expect(await runDueScheduledDates(t.db, later)).toMatchObject({ ran: 1, waiting: 1, booked: 0 });
    const held = (await t.db.query<Any>(`select ran_at, attempts, run_at, outcome from scheduled_dates`)).rows[0];
    expect(held.ran_at).toBeNull();
    expect(held.attempts).toBe(1);
    expect(new Date(held.run_at).getTime()).toBeGreaterThan(later.getTime() + 50 * 60_000);
    expect(held.outcome).toMatch(/waiting/);

    // The sixth try is the last.
    await t.db.query(`update scheduled_dates set attempts = 5, run_at = $1`, [later.toISOString()]);
    expect(await runDueScheduledDates(t.db, new Date(later.getTime() + 60_000))).toMatchObject({ ran: 1, failed: 1 });
    expect((await t.db.query<Any>(`select outcome from scheduled_dates`)).rows[0].outcome).toMatch(/gave up/);
    const note = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'scheduled_date'`, [agentId])).rows;
    expect(note).toHaveLength(1);
    expect(note[0].title).toMatch(/couldn't run/);
  });
});
