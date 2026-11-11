import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { WAIT_MAX_SECONDS } from "@/lib/mcp/schemas";
import { startTestDb } from "./helpers";

// #1443 (the 2026-11-11-0755 run: "wait_seconds silently capped at 30"): the quickstart told agents get_episode with
// wait_seconds: 50, and a match with the house cast suggested read_texts with 60, past the 30-second cap. Every wait the
// show suggests, in its texts and in its next_calls, is at most the cap.
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
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);

/** Every number written as a wait ("wait_seconds: 50", `wait_seconds": 60`), in a text or a source file. */
const suggestedWaits = (text: string): number[] => [...text.matchAll(/wait_seconds["']?\s*[:=]\s*["']?(\d+)/g)].map((m) => Number(m[1]));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

describe("#1443: no suggested wait past the cap", () => {
  it("the quickstart, the full guide and the cheatsheet suggest waits of at most the cap", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1443-test" } })).result;
    expect(init.instructions).toContain(`get_episode with wait_seconds: ${WAIT_MAX_SECONDS}`);
    const texts = [init.instructions as string];
    for (const uri of ["botchelor://instructions", "botchelor://cheatsheet"]) texts.push((await rpc("resources/read", { uri })).result.contents[0].text);
    for (const text of texts) for (const wait of suggestedWaits(text)) expect(wait).toBeLessThanOrEqual(WAIT_MAX_SECONDS);
  });

  it("no source under lib/ writes a wait past the cap (comments, which tell the history, aside)", () => {
    const over = sourceFiles(join(process.cwd(), "lib")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter((line) => suggestedWaits(line).some((w) => w > WAIT_MAX_SECONDS))
        .map((line) => `${file}: ${line.trim().slice(0, 120)}`),
    );
    expect(over).toEqual([]);
  });
});
