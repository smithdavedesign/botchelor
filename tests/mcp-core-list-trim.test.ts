import { describe, expect, it } from "vitest";
import { CORE_MCP_TOOLS, CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, TOOL_COSTS } from "@/lib/mcp";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { cheatSheet, MCP_SERVER_INFO } from "@/lib/mcp/dispatcher";
import { TOOL_NOTES } from "@/lib/mcp/tool-defs";

// #1845 (the 2026-11-19-1746 run: "nicer tools/list size (core is 64KB)", "the biggest context cost"): the default list
// keeps what an agent needs to pick and call a tool; the notes (edge cases, return shapes, reasons) ride elsewhere.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any = {}): Promise<Any> => (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, {}))!.result;

describe("the core tools/list, trimmed (2.40.0, #1845)", () => {
  it("is the newest version, with its entry", () => {
    expect(MCP_SERVER_INFO.version).toBe("2.40.0");
    expect(MCP_CHANGELOG[0]).toMatchObject({ version: "2.40.0" });
  });

  it("leaves each core tool's notes out of the default list, and every other list carries them", async () => {
    const core = (await rpc("tools/list")).tools as Any[];
    const all = (await rpc("tools/list", { all: true })).tools as Any[];
    const named = (await rpc("tools/list", { names: ["go_on_date"] })).tools as Any[];
    for (const name of CORE_TOOL_ORDER) {
      const notes = TOOL_NOTES[name];
      if (!notes) continue;
      expect({ name, inCore: core.find((t) => t.name === name).description.includes(notes) }).toEqual({ name, inCore: false });
      expect({ name, inAll: all.find((t) => t.name === name).description.endsWith(notes) }).toEqual({ name, inAll: true });
    }
    expect(named[0].description).toContain(TOOL_NOTES.go_on_date);
    // The arguments themselves are the same objects on both lists.
    for (const t of CORE_MCP_TOOLS) expect(t.inputSchema).toBe(MCP_TOOLS.find((x) => x.name === t.name)!.inputSchema);
  });

  it("says the cost first in a short line, and the cheatsheet keeps the whole sentence and the notes", async () => {
    const core = (await rpc("tools/list")).tools as Any[];
    expect(core.find((t) => t.name === "go_on_date").description).toMatch(/^Cost: 1 date \+ 1 shared daily date; preview: true spends nothing\. Send one/);
    expect(core.find((t) => t.name === "my_status").description).toMatch(/^Free\. Start here/);
    const sheet = cheatSheet();
    expect(sheet).toContain(`  Notes: ${TOOL_COSTS.start_own_date} ${TOOL_NOTES.start_own_date}`);
    expect(sheet).toContain(`  Notes: ${TOOL_NOTES.my_status}`);
  });

  it("the lean list leaves out agent_id and says the short cost; more_tools says where the notes are", async () => {
    const lean = (await rpc("tools/list", { lean: true })) as Any;
    for (const t of lean.tools) expect(Object.keys(t.args)).not.toContain("agent_id");
    expect(lean.tools.find((t: Any) => t.name === "go_on_date").cost).toMatch(/^Cost: 1 date/);
    expect(lean.more_tools.how).toMatch(/with the notes this list leaves out.*lean: true/);
    expect(JSON.stringify(lean.tools).length).toBeLessThan(16_000);
  });
});
