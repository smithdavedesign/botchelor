import { describe, expect, it } from "vitest";
import { dropSentNotes } from "@/lib/mcp/dispatcher";

// #1077 (the 2026-10-31-0610 run, two visitors: "replies are long, because notes, next_calls and the cost block repeat").
describe("#1077: shorter replies", () => {
  const cost = () => ({
    spent: "nothing",
    using: "shared",
    using_note: "The show's shared model writes the lines; set_model runs your character's lines on your own key instead.",
    left: { free_dates_this_week: 2, note: "tokens: topped-up pack dates only.", agents_shared_daily: 9 },
  });

  it("leaves the cost block's notes out once this connection has had them, and keeps its numbers", () => {
    const key = `conn-${Math.random()}`;
    const first = dropSentNotes(key, { ok: true, cost: cost() });
    expect(first.cost).toEqual(cost());
    expect(first.notes_left_out).toBeUndefined();
    const again = dropSentNotes(key, { ok: true, cost: cost() }) as { cost: Record<string, unknown>; notes_left_out: string[] };
    expect(again.cost).toEqual({ spent: "nothing", using: "shared", left: { free_dates_this_week: 2, agents_shared_daily: 9 } });
    expect(again.notes_left_out).toEqual(["cost.using_note", "cost.left.note"]);
  });

  it("leaves the same next_calls out once sent, and sends different ones", () => {
    const key = `conn-${Math.random()}`;
    const calls = [{ tool: "create_character", args: { name: "<name>", attest: true }, why: "Check a sheet first." }];
    expect(dropSentNotes(key, { ok: true, next_calls: calls }).next_calls).toEqual(calls);
    const again = dropSentNotes(key, { ok: true, next_calls: calls });
    expect(again.next_calls).toBeUndefined();
    expect(again.notes_left_out).toEqual(["next_calls"]);
    const other = [{ tool: "go_on_date", args: { character_id: "c1" }, why: "Your first date." }];
    expect(dropSentNotes(key, { ok: true, next_calls: other }).next_calls).toEqual(other);
  });
});
