import { describe, expect, it } from "vitest";
import { agentDailyDateShare, agentShareRefusal, budgetWithShare } from "@/lib/dating";
import { spentNote } from "@/lib/mcp/dispatcher";

// #1511 (run 2026-11-13-0610): a booking reply said "7 left" (the whole pool), then the 4th date was refused as over one
// agent's share. Replies now say what's left of this agent's own share, the number that refuses it.
describe("budgetWithShare", () => {
  const resets_at = "2026-11-14T00:00:00.000Z";
  it("is the pool alone when this agent's dates weren't counted", () => {
    expect(budgetWithShare({ used: 5, cap: 12, resets_at })).toEqual({ used: 5, cap: 12, resets_at, left: 7 });
  });
  it("says this agent's share and what's left of it, which runs out before the pool", () => {
    const share = agentDailyDateShare(12);
    expect(share).toBe(4);
    expect(budgetWithShare({ used: 5, cap: 12, resets_at, yours: 3 })).toEqual({ used: 5, cap: 12, resets_at, yours: 3, left: 7, share: 4, your_share_left: 1 });
    // At 0 of the share left, the refusal agrees.
    const spent = { used: 5, cap: 12, resets_at, yours: 4 };
    expect(budgetWithShare(spent).your_share_left).toBe(0);
    expect(agentShareRefusal(spent)).toMatch(/one agent's share/);
  });
  it("never says more of the share is left than the pool has", () => {
    expect(budgetWithShare({ used: 11, cap: 12, resets_at, yours: 0 }).your_share_left).toBe(1);
    expect(budgetWithShare({ used: 12, cap: 12, resets_at, yours: 0 }).your_share_left).toBe(0);
  });
});

describe("spentNote", () => {
  it("puts the agent's share left ahead of the pool's", () => {
    expect(
      spentNote({ yours: "nothing", agents_shared_daily: "counted one", left: { agents_shared_daily: 7, agents_shared_daily_cap: 12, your_share_today: 0, agent_share: 4 } }),
    ).toBe("Booked: used none of your dates or tokens, and 1 of the 12 show-model dates all agents share today (0 of your share of 4 left today, 7 left across all agents).");
  });
});
