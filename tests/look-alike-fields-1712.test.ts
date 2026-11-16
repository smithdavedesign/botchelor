import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { matchedFields, setLookAlikeGateForTests } from "@/lib/originality";
import { startTestDb, validCharacter } from "./helpers";

// #1712 (the 2026-11-16 runs: four and six look-alike refusals in a row, "say which fields matched", "a hint that look-alikes
// are common among same-model agents"): a refusal names each look-alike's matched fields, the words shared and how strong.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setLookAlikeGateForTests(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
const agent = async (): Promise<McpContext> => {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1712-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
};

const ingeborg = validCharacter({
  name: "Ingeborg Salvesen",
  bio: "Announces the stops on the night trams and records the city's quietest sounds on a reel-to-reel recorder after every shift.",
  traits: ["precise", "dreamy", "dry"],
  want: "Someone who will stand still long enough to hear a tram bell fade",
  dealbreaker: "Talking over the announcements",
  extras: { occupation: "Night tram announcer" },
});
const tramTwin = validCharacter({
  name: "Vesna Horvat",
  bio: "Announces the stops on the night trams of Zagreb and records the city's quietest sounds on a cassette recorder after every shift.",
  traits: ["exact", "wistful", "wry"],
  want: "Someone who hears the city the way she does",
  dealbreaker: "People who play music on the tram",
  extras: { occupation: "Tram announcer" },
});

describe("#1712: a look-alike refusal says what matched", () => {
  it("matchedFields, pure: the fields that overlap, the words as written, and a strength from how many", () => {
    const m = matchedFields(tramTwin, { id: "x", ...ingeborg });
    expect(m.matched.map((f) => f.field)).toEqual(expect.arrayContaining(["job", "bio"]));
    expect(m.matched.find((f) => f.field === "job")!.words).toContain("tram");
    expect(m.matched.find((f) => f.field === "bio")!.words.length).toBeGreaterThan(0);
    expect(m.matched.some((f) => f.field === "name")).toBe(false);
    expect(["close", "strong"]).toContain(m.strength);
    // One field alone is a weak match; a close first name counts as a name match.
    const weak = matchedFields({ name: "Thaddeus Quillfeather", want: "Someone punctual" }, { id: "y", name: "Thaddeus Marlowe", want: "A quiet life" });
    expect(weak).toEqual({ matched: [{ field: "name", words: ["Thaddeus"] }], strength: "weak" });
    expect(matchedFields({ name: "Ann Lee" }, { id: "z", name: "Bo Quill" })).toEqual({ matched: [], strength: "weak" });
  });

  it("the refusal lists each look-alike's matched fields and strength, says why look-alikes are common, and still offers names and jobs", async () => {
    const first = (await call("create_character", ingeborg, await agent())).structuredContent.character;
    const r = await call("create_character", tramTwin, await agent());
    expect(r.isError).toBe(true);
    const out = r.structuredContent;
    const twin = out.look_alikes.find((x: Any) => x.id === first.id);
    expect(twin.matched.map((f: Any) => f.field)).toEqual(expect.arrayContaining(["job", "bio"]));
    expect(["close", "strong"]).toContain(twin.match_strength);
    expect(out.error).toMatch(/What matched: Ingeborg Salvesen: .*job \(.*tram.*\).*, a (close|strong) match\./);
    expect(out.error).toMatch(/Agents on the same model often reach for the same names and jobs/);
    expect(out.error).toMatch(/call again with keep_look_alike: true\.$/);
    expect(out.try_names.length).toBeGreaterThan(0);
    expect(out.try_instead.length).toBeGreaterThan(0);
  });
});
