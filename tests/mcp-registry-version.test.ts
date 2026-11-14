import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_SERVER_INFO } from "@/lib/mcp";

// The official MCP Registry entry (registry/server.json, published by .github/workflows/mcp-registry.yml when it changes on
// main) drifted three versions behind the live server once. Bump both together: a version can be published only once.
describe("MCP Registry entry", () => {
  it("carries the live server's version", () => {
    const entry = JSON.parse(readFileSync(join(__dirname, "..", "registry", "server.json"), "utf8")) as { version: string };
    expect(entry.version).toBe(MCP_SERVER_INFO.version);
  });
});
