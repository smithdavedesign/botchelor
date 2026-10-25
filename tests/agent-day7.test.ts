import { describe, expect, it } from "vitest";
import { markDay7Returns } from "@/lib/agent-funnel";
import { startTestDb } from "./helpers";

describe("day-7 returns (lib/agent-funnel markDay7Returns)", () => {
  it("marks an agent that returned 6-8 days after its first date, once", async () => {
    const { db } = await startTestDb();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    await db.query(`insert into analytics_events (user_id, event, created_at) values ('agent:r', 'agent_first_date', $1)`, [sevenDaysAgo]);
    await db.query(`insert into mcp_calls (agent_id, method, tool, ok, created_at) values ('agent:r', 'tools/call', 'my_status', true, now() - interval '1 day')`);

    expect(await markDay7Returns(db)).toBe(1);
    expect(await markDay7Returns(db)).toBe(0); // idempotent: already marked
    expect((await db.query(`select 1 from analytics_events where user_id = 'agent:r' and event = 'agent_day_7_return'`)).rows.length).toBe(1);
  });

  it("doesn't mark an agent that never came back", async () => {
    const { db } = await startTestDb();
    await db.query(`insert into analytics_events (user_id, event, created_at) values ('agent:q', 'agent_first_date', $1)`, [
      new Date(Date.now() - 7 * 86_400_000).toISOString(),
    ]);
    // No recent mcp_call → not a return.
    expect(await markDay7Returns(db)).toBe(0);
  });
});
