import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { loadSoul, unknownSoulKeys } from "@/lib/souls";
import { startTestDb, validCharacter } from "./helpers";

// #1188 (the live board, 2026-11-01): update_character and create_character took soul { secret, wound, private_belief },
// dropped every key, and said soul_changed: true; the date prompt then had no soul.
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
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1188-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const UNKNOWN = { secret: "Kept a letter she never sent.", wound: "Left at a station.", private_belief: "Everyone leaves." };

describe("#1188: soul keys that aren't its fields", () => {
  it("unknownSoulKeys refuses a soul with no field in it and names the extras of one that has some", () => {
    expect(unknownSoulKeys(UNKNOWN).refusal).toMatch(/^soul doesn't take "secret", "wound", "private_belief", so nothing in it would be saved\. Its fields: values, insecurities, humor, boundaries, romantic, communication/);
    expect(unknownSoulKeys({ ...UNKNOWN, local_only: true }).refusal).not.toBeNull();
    expect(unknownSoulKeys({ values: "Honesty.", wound: "x" })).toEqual({ unknown: ["wound"], refusal: null });
    expect(unknownSoulKeys({})).toEqual({ unknown: [], refusal: null });
    expect(unknownSoulKeys({ values: "Honesty.", local_only: true })).toEqual({ unknown: [], refusal: null });
  });

  it("create_character refuses a soul of unknown keys and saves nothing; with a real field too, it's saved and the rest named", async () => {
    const ctx = await connect();
    const before = await t.count("characters");
    const refused = await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true, soul: UNKNOWN }), ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/soul doesn't take "secret", "wound", "private_belief"/);
    expect(await t.count("characters")).toBe(before);

    const made = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true, soul: { values: "Honesty, even when it costs.", wound: "Left at a station." } }), ctx)).structuredContent;
    expect(made.character.has_soul).toBe(true);
    expect(made.ignored_soul_keys).toEqual(["wound"]);
    expect(made.character.ignored_soul_keys).toBeUndefined();
    expect((await loadSoul(t.db, made.character_id))?.values).toBe("Honesty, even when it costs.");
  });

  it("update_character refuses a soul of unknown keys, and soul_changed is true only when the stored soul changed", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent.character_id;

    const refused = await call("update_character", { character_id: id, soul: UNKNOWN }, ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/soul doesn't take "secret", "wound", "private_belief".*Its fields: values, insecurities/);
    expect(await loadSoul(t.db, id)).toBeNull();

    const set = (await call("update_character", { character_id: id, soul: { humor: "Dry.", secret: "x" } }, ctx)).structuredContent;
    expect(set.updated).toMatchObject({ soul_changed: true, ignored_soul_keys: ["secret"] });
    expect((await loadSoul(t.db, id))?.humor).toBe("Dry.");

    const same = (await call("update_character", { character_id: id, soul: { humor: "Dry." } }, ctx)).structuredContent;
    expect(same.updated.soul_changed).toBe(false);
    expect(same.updated.ignored_soul_keys).toBeUndefined();
  });
});
