// Character facts (David, 2026-10-18): up to 20 of the creator's own, public or private, a few per act, never the decider.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sharedFact } from "@/lib/dating";
import { ExtrasInput, factsForAct, FACTS_PER_ACT, MAX_FACTS, normaliseExtras, publicExtras, type CharacterFact } from "@/lib/extras";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "facts-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const FACTS: CharacterFact[] = [
  { label: "Afraid of", value: "heights, despite the job" },
  { label: "Secretly collects", value: "hotel soap", private: true },
  { label: "Can't cook", value: "anything but toast" },
];

describe("the data", () => {
  it("keeps up to 20 facts, drops blanks and duplicates, and stores private only when it's true", () => {
    const e = normaliseExtras({ facts: [...FACTS, { label: "Afraid of", value: "heights, despite the job" }, { label: " ", value: "x" }, { label: "Lucky number", value: "7", private: false }] });
    expect(e.facts).toEqual([...FACTS, { label: "Lucky number", value: "7" }]);
    expect(ExtrasInput.safeParse({ facts: Array.from({ length: MAX_FACTS + 1 }, (_, i) => ({ label: `L${i}`, value: "v" })) }).success).toBe(false);
    expect(ExtrasInput.safeParse({ facts: [{ label: "x".repeat(41), value: "v" }] }).success).toBe(false);
  });

  it("publicExtras drops private facts, and nothing else", () => {
    const e = { occupation: "Electrician", facts: FACTS };
    expect(publicExtras(e)).toEqual({ occupation: "Electrician", facts: [FACTS[0], FACTS[2]] });
    expect(publicExtras({ facts: [FACTS[1]] })).toEqual({});
  });

  it("hands each act a few, different ones, deterministically from the seed, split public / private", () => {
    const many: CharacterFact[] = Array.from({ length: 10 }, (_, i) => ({ label: `Fact ${i}`, value: `value ${i}`, ...(i === 4 ? { private: true as const } : {}) }));
    const acts = [0, 1, 2].map((act) => factsForAct({ facts: many }, 7, act));
    for (const a of acts) expect(a.share.length + a.private.length).toBe(FACTS_PER_ACT);
    expect(new Set(acts.flatMap((a) => [...a.share, ...a.private])).size).toBe(9); // three different few
    expect(factsForAct({ facts: many }, 7, 1)).toEqual(acts[1]); // a replay is identical
    expect(acts.flatMap((a) => a.private)).toEqual(["Fact 4: value 4"]);
    expect(factsForAct({}, 7, 0)).toEqual({ share: [], private: [] });
  });

  it("a shared public fact is a light reason; private ones never match", () => {
    expect(sharedFact([{ label: "Collects", value: "vinyl records" }], [{ label: "Collects", value: "Vinyl records" }])).toBe("collects Vinyl records");
    expect(sharedFact([{ label: "Collects", value: "vinyl records" }], [{ label: "Collects", value: "vinyl records", private: true }])).toBeNull();
    expect(sharedFact([{ label: "Allergic to", value: "cats" }], [{ label: "Afraid of", value: "dogs" }])).toBeNull();
  });
});

describe("over MCP and on dates", () => {
  it("the owner sees private facts; anyone else, and search, only the public ones; the content filter applies", async () => {
    const owner = await connect();
    const made = await call("create_character", { ...validCharacter({ name: "Wren Kestrel" }), open_to_dates: true, extras: { facts: FACTS } }, owner);
    expect(made.isError).toBeFalsy();
    const id = made.structuredContent.character.id;
    expect(JSON.stringify((await call("get_character", { character_id: id }, owner)).structuredContent)).toContain("hotel soap");
    expect(JSON.stringify((await call("my_characters", {}, owner)).structuredContent)).toContain("hotel soap");

    const stranger = await connect();
    const seen = JSON.stringify((await call("get_character", { character_id: id }, stranger)).structuredContent);
    expect(seen).toContain("heights, despite the job");
    expect(seen).not.toContain("hotel soap");
    expect(JSON.stringify((await call("search_characters", { query: "hotel soap" }, stranger)).structuredContent)).not.toContain("Wren Kestrel");

    const bad = await call("create_character", { ...validCharacter({ name: "Ivo Blank" }), extras: { facts: [{ label: "Hobby", value: "watching porn" }] } }, owner);
    expect(bad.isError).toBe(true);
    const long = await call("create_character", { ...validCharacter({ name: "Ivo Blank" }), extras: { facts: [{ label: "x".repeat(41), value: "v" }] } }, owner);
    expect(long.content[0].text).toMatch(/facts/);
  });

  it("a character's own turn prompt carries its facts; the other side's never sees its private ones", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const a = (await call("create_character", { ...validCharacter({ name: "Ada Lumen" }), extras: { facts: [{ label: "Secretly collects", value: "hotel soap", private: true }] } }, ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    let step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    expect(step.side).toBe("a");
    expect(JSON.stringify(step.messages)).toContain("things_only_you_know");
    expect(JSON.stringify(step.messages)).toContain("hotel soap");
    step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: "Hello there, you must be Bo.", action: "", emotion: "warm", interest_signal: 0.6 } }, ctx)).structuredContent.step;
    expect(step.side).toBe("b");
    expect(JSON.stringify(step.messages)).not.toContain("hotel soap");
  });
});
