import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { everydayOf, ownClothes } from "@/lib/adult/media";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { renameLeftovers, extrasText } from "@/lib/rename-leftovers";
import { startTestDb, validCharacter } from "./helpers";

// From the loop20 prod run 2026-10-31-1838 (~/.botchelor-loop/runs/2026-10-31-1838): #1158 a waistcoat character dressed
// in a stock tee and jeans, #1160 a rename left the old name's sign-off in the voice.
describe("#1158: the clothes a character's own words name come before a stock outfit", () => {
  it("a house look's 'in a velvet waistcoat' is what they wear; an age is never clothes", () => {
    const waistcoat = ALL_HOUSE_CHARACTERS.find((h) => /velvet waistcoat/.test(h.look ?? ""))!;
    expect(ownClothes({ id: waistcoat.id, extras: {} })).toBe("a velvet waistcoat over a buttoned shirt");
    expect(everydayOf({ id: "c-1", pronouns: "he/him", extras: {}, look: { appearance: "always mid-laugh, wearing a moss-green cardigan", physical: null } })).toBe("a moss-green cardigan");
    expect(ownClothes({ id: "c-2", extras: {}, look: { appearance: "a man in his late thirties, freckled", physical: null } })).toBeNull();
    expect(ownClothes({ id: "c-3", extras: { style: "linen everything" }, look: { appearance: "in a red coat", physical: null } })).toBe("linen everything");
  });
});

describe("#1160: a rename says where the old name is still written", () => {
  it("names the field and what it found: the full name, the first name, the initial as a sign-off", () => {
    const w = renameLeftovers("Caspian Vale", "Corwin Vale", {
      bio: "Caspian restores lighthouse lenses.",
      voice: "Dry, then warm. Signs off: Yours, for now, C.",
      want: "Someone who reads the tide tables.",
    });
    expect(w).toEqual([expect.stringMatching(/^bio still says 'Caspian', the old name/)]);
    const w2 = renameLeftovers("Caspian Vale", "Orla Vale", { voice: "Signs off: Yours, for now, C.", ...extrasText({ sample_lines: ["Caspian Vale, at your service."] }) });
    expect(w2).toEqual([expect.stringMatching(/^voice still says 'C\.' \(a sign-off\)/), expect.stringMatching(/^extras\.sample_lines still says 'Caspian Vale' and 'Caspian'/)]);
    expect(renameLeftovers("Caspian Vale", "Orla Vale", { bio: "Restores lighthouse lenses." })).toEqual([]);
    expect(renameLeftovers("Caspian Vale", "caspian vale", { bio: "Caspian." })).toEqual([]);
  });
});

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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop20-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

describe("#1159: my_dates says aired, when, and with whom", () => {
  it("an aired date is aired: true with no airs_at; one not yet aired has airs_at; a private one never airs; with is the other side", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx);
    const agent = made.structuredContent.agent_id;
    const mine = made.structuredContent.character.id;
    const house = ALL_HOUSE_CHARACTERS[0];
    const ins = (id: string, revealed: boolean, visibility: string) =>
      t.db.query(
        `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility, sides)
         values ($1, $2, $3, $4, 'the pier', '{}'::jsonb, '[]'::jsonb, '', '', 'friends', ${revealed ? "now()" : "null"}, '[]'::jsonb, 'ready', $5, '[{"wants_another": false}, {"wants_another": false}]'::jsonb)`,
        [id, agent, mine, house.id, visibility],
      );
    await ins("ep-aired", true, "public");
    await ins("ep-soon", false, "public");
    await ins("ep-private", false, "private");
    const dates = (await call("my_dates", {}, ctx)).structuredContent.dates as Any[];
    const by = (id: string) => dates.find((d) => d.id === id);
    expect(by("ep-aired")).toMatchObject({ aired: true, with: house.name });
    expect(by("ep-aired").airs_at).toBeUndefined();
    expect(by("ep-soon")).toMatchObject({ aired: false, airs_at: expect.any(String) });
    expect(by("ep-private")).toMatchObject({ aired: false, airs: "never: it's private" });
  });
});

describe("#1160: update_character warns about the old name left in the sheet", () => {
  it("a rename with the old first name still in the bio says so; nothing is changed", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Caspian Vale", keep_name: true, bio: "Caspian restores lighthouse lenses for the coast guard." }), ctx)).structuredContent.character.id;
    const r = (await call("update_character", { character_id: id, name: "Corwin Vale", keep_name: true }, ctx)).structuredContent;
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^bio still says 'Caspian', the old name/)]));
    expect((await t.db.query(`select bio from characters where id = $1`, [id])).rows[0].bio).toMatch(/^Caspian restores/);
  });
});
