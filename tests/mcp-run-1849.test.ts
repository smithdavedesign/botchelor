import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@/lib/mcp";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { MCP_SERVER_INFO, SECOND_DATE_CAP_NOTE, withoutPlaceTokens } from "@/lib/mcp/dispatcher";

// The 2026-11-19-1849 visitor run: #1857 (my_dates limit), #1858 (a raw home@ token), #1856 (a yes refused at the cap).
describe("the 2026-11-19-1849 run (2.41.0)", () => {
  it("is the newest version, with its entry", () => {
    expect(MCP_SERVER_INFO.version).toBe("2.41.0");
    expect(MCP_CHANGELOG[0]).toMatchObject({ version: "2.41.0" });
  });

  it("my_dates takes limit (#1857)", () => {
    const props = (MCP_TOOLS.find((t) => t.name === "my_dates")!.inputSchema as { properties: Record<string, { maximum?: number }> }).properties;
    expect(props.limit).toMatchObject({ maximum: 100 });
  });

  it("never shows a stored place token, but leaves a next call's args alone (#1858)", () => {
    const out = withoutPlaceTokens({
      venue: "home@Odalys's place",
      note: "They moved to home@Odalys's place, then elsewhere@the lido.",
      email: "nobody",
      next_calls: [{ tool: "start_own_date", args: { place: "home@Odalys's place" } }],
      n: 3,
      place: { id: "elsewhere@the foundry", name: "The foundry" },
    });
    expect(out.place.id).toBe("elsewhere@the foundry");
    expect(out.venue).toBe("Odalys's place");
    expect(out.note).toBe("They moved to Odalys's place, then the lido.");
    expect(out.next_calls[0].args.place).toBe("home@Odalys's place");
    expect(out.n).toBe(3);
    expect(JSON.stringify(withoutPlaceTokens({ a: ["home@Pip's place"] }))).not.toContain("home@");
  });

  it("says why a yes to a second date needs a shared daily date, and what's free (#1856)", () => {
    expect(SECOND_DATE_CAP_NOTE).toContain("start_own_date");
  });
});
