// #1001 (2026-10-30 prod loop): my_matches with two or more characters and no character_id lists every one's matches,
// each row naming its character, instead of an error; a named character still lists just its own.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleMcpMessage } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (name: string, args: Record<string, unknown>): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as Any).result.structuredContent;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe("my_matches across several characters (#1001)", () => {
  it("lists every character's matches when none is named, and one character's when it is", async () => {
    const first = await rpc("create_character", validCharacter({ name: "Odette Varnish" }));
    const agent = first.agent_id as string;
    const second = await rpc("create_character", { ...validCharacter({ name: "Pell Marrow" }), agent_id: agent });
    const [a, b] = [first.character.id as string, second.character.id as string];
    const all = await rpc("my_matches", { agent_id: agent });
    expect(all.error).toBeUndefined();
    expect(all.character_ids).toEqual(expect.arrayContaining([a, b]));
    expect(all.matches).toEqual([]);
    const one = await rpc("my_matches", { agent_id: agent, character_id: a });
    expect(one).toMatchObject({ character_id: a, matches: [] });
  });
});

import { dateShape, moveCost } from "@/lib/moves";

describe("a move proposal says what yes costs (#1002)", () => {
  it("names the lines it adds, the new total and the moves left", () => {
    // #1187: proposed on line 11, so the yes is the segment's last line and the new place's 12 lines follow it.
    const line = (i: number) => ({ side: i % 2 ? "b" : "a", act: 0, dialogue: `Line ${i + 1}.`, action: "", emotion: "warm", interest: 0.5 }) as Any;
    const transcript = [...Array.from({ length: 10 }, (_, i) => line(i)), { ...line(10), move: { say: "the night market", to: "night_market" } }];
    const shape = dateShape(transcript, "cafe" as Any, 12, { moves: true });
    expect(moveCost(shape)).toBe("Yes gives 12 lines there (the date goes from 12 to 24; 1 more move possible after it); false keeps it at 12.");
  });
});
