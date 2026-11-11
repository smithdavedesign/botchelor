import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { AIR_WINDOW_MINUTES_DEFAULT } from "@/lib/air";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1444 (the 2026-11-11-0755 run: get_episode said age_seconds 832 and "2 lines in 14 minutes"; airs_at was 16:10 but it
// aired at 16:23, and the agent couldn't tell whether the clock or the writing was at fault): age_seconds says what it
// counts from (booked_at), a slot that passes while the date is still being written says it airs when it's finished, and
// an aired date says when it aired and, when that was well after its slot, why.
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

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

async function booked(): Promise<{ ctx: McpContext; episode: string; creator: string }> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1444-test" } } }, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const c = (await call("create_character", validCharacter({ name: "Ada Lumen" }), session)).structuredContent;
  const ep = (await call("go_on_date", { character_id: c.character.id, partner_id: HOUSE_PARTNER_ID }, session)).structuredContent.episode;
  return { ctx: session, episode: ep.id, creator: c.agent_id };
}

/** The date's job, finished `minutesAgo` minutes ago. */
async function writtenAgo(episode: string, creator: string, minutesAgo: number) {
  await t.db.query(
    `insert into generation_jobs (episode_id, status, creator_id, updated_at) values ($1, 'succeeded', $2, now() - $3 * interval '1 minute')
     on conflict (episode_id) do update set status = 'succeeded', updated_at = excluded.updated_at`,
    [episode, creator, minutesAgo],
  );
}

describe("#1444: a slow date's timing explains itself", () => {
  it("still being written past its slot: age_seconds says it counts from booked_at, and it airs when it's finished", async () => {
    const { ctx, episode } = await booked();
    await t.db.query(`update episodes set status = 'generating', revealed_at = null, created_at = now() - interval '14 minutes' where id = $1`, [episode]);
    const g = (await call("get_episode", { episode_id: episode }, ctx)).structuredContent;
    expect(g.seconds_left).toBe(0);
    expect(g.airs).toBe("when_ready");
    expect(g.airs_note).toMatch(/still being written: it airs once it's finished/);
    const w = (await call("get_episode", { episode_id: episode, wait_seconds: 1 }, ctx)).structuredContent;
    expect(w.age_seconds).toBeGreaterThanOrEqual(14 * 60 - 1);
    expect(Date.now() - new Date(w.booked_at).getTime()).toBeGreaterThanOrEqual(14 * 60_000 - 1000);
  });

  it("before its slot, a date being written says nothing extra", async () => {
    const { ctx, episode } = await booked();
    await t.db.query(`update episodes set status = 'generating', revealed_at = null where id = $1`, [episode]);
    const g = (await call("get_episode", { episode_id: episode }, ctx)).structuredContent;
    expect(g.airs).toBeUndefined();
    expect(g.airs_note).toBeUndefined();
  });

  it("aired late because it was still being written says so, with when it finished", async () => {
    const { ctx, episode, creator } = await booked();
    await t.db.query(`update episodes set status = 'ready', created_at = now() - interval '23 minutes', revealed_at = now() where id = $1`, [episode]);
    await writtenAgo(episode, creator, 1);
    const g = (await call("get_episode", { episode_id: episode }, ctx)).structuredContent;
    expect(g.aired).toBe(true);
    expect(typeof g.aired_at).toBe("string");
    expect(g.aired_late_note).toMatch(new RegExp(`^Aired 13 minutes after its slot \\(.*, ${AIR_WINDOW_MINUTES_DEFAULT} minutes after booking\\): it was still being written then`));
  });

  it("aired late though written in time says airing waits for the next call", async () => {
    const { ctx, episode, creator } = await booked();
    await t.db.query(`update episodes set status = 'ready', created_at = now() - interval '23 minutes', revealed_at = now() where id = $1`, [episode]);
    await writtenAgo(episode, creator, 20);
    const g = (await call("get_episode", { episode_id: episode }, ctx)).structuredContent;
    expect(g.aired_late_note).toMatch(/airs on the next call anyone makes/);
  });

  it("aired on time: just when", async () => {
    const { ctx, episode } = await booked();
    await t.db.query(`update episodes set status = 'ready', created_at = now() - interval '10 minutes', revealed_at = now() where id = $1`, [episode]);
    const g = (await call("get_episode", { episode_id: episode }, ctx)).structuredContent;
    expect(typeof g.aired_at).toBe("string");
    expect(g.aired_late_note).toBeUndefined();
  });
});
