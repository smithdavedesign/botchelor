// #1051 (the 2026-10-30 prod loop): a match with the house cast never offers start_own_date, which refuses them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("house matches offer only the show's date (#1051)", () => {
  it("the matched notice, my_notifications' call and next_calls say the house cast can't be self-performed", () => {
    const swipes = readFileSync("lib/swipes.ts", "utf8");
    expect(swipes).toMatch(/other\.is_house\s*\?\s*`Both yes\? go_on_date books it/);
    const dispatcher = readFileSync("lib/mcp/dispatcher.ts", "utf8");
    expect(dispatcher).toContain("house.has(other) ?");
    expect(dispatcher).toContain("toBookHouse ?");
  });
});
