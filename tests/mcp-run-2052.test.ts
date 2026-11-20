import { describe, expect, it, vi } from "vitest";
import { airedVisibilityLine } from "@/lib/air";
import { logSlowCall, SLOW_CALL_MS } from "@/lib/mcp/dispatcher";

// The 2026-11-19-2052 visitor run: #1869 (a private date's aired notice said "unlisted"), #1870 (stalls with no name).
describe("the 2026-11-19-2052 run", () => {
  it("the aired notice says who can watch, by visibility (#1869)", () => {
    expect(airedVisibilityLine("private")).toContain("private, so only you");
    expect(airedVisibilityLine("unlisted")).toContain("unlisted");
    expect(airedVisibilityLine("public")).toBe("");
  });

  it("logs a slow call by tool name, not counting a wait it was asked for (#1870)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(logSlowCall("my_status", SLOW_CALL_MS + 100)).toBe(true);
    expect(warn.mock.calls[0][0]).toContain("slow call: my_status");
    expect(logSlowCall("my_notifications", 30_000 + 1_000, { wait_seconds: 30 })).toBe(false);
    expect(logSlowCall("my_notifications", 30_000 + SLOW_CALL_MS + 1, { wait_seconds: 30 })).toBe(true);
    expect(logSlowCall("get_character", 200)).toBe(false);
    warn.mockRestore();
  });
});
