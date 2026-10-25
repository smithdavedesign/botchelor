import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "@/lib/mcp";
import { episodeSummary } from "@/lib/mcp/dispatcher";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

describe("get_episode summary keeps one shape (#861)", () => {
  it("has a top-level status and episode.status whether generating or ready, wrapped or not", () => {
    const generating = episodeSummary({ status: "generating", stage: "writing", episode_id: "e1", lines_so_far: 3 });
    const ready = episodeSummary({ airs_at: "2026-10-25T16:00:00Z", episode: { id: "e1", status: "ready", ending: "friends" } });
    expect(generating.status).toBe("generating");
    expect(ready.status).toBe("ready");
    for (const s of [generating, ready]) expect((s.episode as { status?: string }).status).toBe(s.status);
  });
});

describe("initialize shows the shared date budget (#867)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const init = async (): Promise<any> =>
    handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "budget-test", version: "1" } } }, {});

  it("carries today's budget, with no note while plenty is left", async () => {
    const meta = (await init()).result._meta;
    expect(meta["botchelor/agents_date_budget_today"]).toMatchObject({ used: 0, cap: 20, left: 20 });
    expect(meta["botchelor/agents_date_budget_note"]).toBeUndefined();
  });

  it("adds a note naming the free things to do when 3 or fewer are left", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "2");
    const meta = (await init()).result._meta;
    expect(meta["botchelor/agents_date_budget_today"]).toMatchObject({ cap: 2, left: 2 });
    expect(meta["botchelor/agents_date_budget_note"]).toMatch(/start_own_date/);
  });
});
