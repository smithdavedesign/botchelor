import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, normaliseArgs, type McpContext } from "@/lib/mcp";
import { MCP_SERVER_INFO } from "@/lib/mcp";
import { movePlace } from "@/lib/places";
import { venueIdFor } from "@/lib/venues";
import { startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.28.0, the 2026-11-13 visitor runs: #1532 ids first and compact "min" on create_character/start_own_date, #1530 a
// batch's see_again off its side's last line, #1526 a last line without see_again, #1522 a recap with character_id, #1531
// set_profile with nothing, #1528 companion message / browse_episodes status, #1535 a place given as a venue id.
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
async function connect(): Promise<{ ctx: McpContext; instructions: string }> {
  const ctx: McpContext = {};
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1532-test" } }, ctx);
  return { ctx: { sessionId: ctx.issuedSessionId }, instructions: init.result.instructions };
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me one true thing about the harbour, and one false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });
async function twoOfMine(ctx: McpContext): Promise<[string, string]> {
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character_id;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character_id;
  return [a, b];
}

describe("#1532: the new id leads, and compact: \"min\" is minimal", () => {
  it("create_character leads with character_id and name; min is just ids, name and next_calls", async () => {
    const { ctx } = await connect();
    const full = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent;
    expect(Object.keys(full).slice(0, 2)).toEqual(["character_id", "name"]);
    expect(full.name).toBe("Ada Lumen");
    expect(full.character.id).toBe(full.character_id);
    const min = await call("create_character", { ...validCharacter({ name: "Bo Quill", keep_name: true }), compact: "min" }, ctx);
    expect(Object.keys(min.structuredContent).slice(0, 3)).toEqual(["character_id", "name", "saved"]);
    expect(min.structuredContent.character).toBeUndefined();
    expect(min.structuredContent.originality).toBeUndefined();
    expect(Array.isArray(min.structuredContent.next_calls)).toBe(true);
    expect(min.content[0].text.length).toBeLessThan(2000);
  });

  it("start_own_date leads with episode_id and each side's last line; min drops the step", async () => {
    const { ctx } = await connect();
    const [a, b] = await twoOfMine(ctx);
    const s = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    expect(Object.keys(s)[0]).toBe("episode_id");
    expect(s.last_line_turns).toEqual([5, 6]);
    await call("decline_own_date", { episode_id: s.episode_id }, ctx);
    const m = await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date", compact: "min" }, ctx);
    expect(Object.keys(m.structuredContent)[0]).toBe("episode_id");
    expect(m.structuredContent.step).toBeUndefined();
    expect(m.structuredContent.last_line_turns).toEqual([5, 6]);
    expect(m.structuredContent.next_calls).toBeDefined();
    expect(m.content[0].text.length).toBeLessThan(2500);
  });
});

describe("#1535: a place given as a venue id is that venue", () => {
  it("venueIdFor and movePlace read ids, spaced ids and names", () => {
    expect(venueIdFor("late_bookshop")).toBe("late_bookshop");
    expect(venueIdFor("Late bookshop")).toBe("late_bookshop");
    expect(venueIdFor("A bookshop open late")).toBe("late_bookshop");
    expect(venueIdFor("the moon")).toBeNull();
    expect(movePlace("late_bookshop", "Ada", "Bo")).toBe("late_bookshop");
    expect(movePlace("home", "Ada", "Bo")).toBe("elsewhere@home");
  });

  it("start_own_date with place: \"late_bookshop\" shows the venue's name, never 'Late_bookshop'", async () => {
    const { ctx } = await connect();
    const [a, b] = await twoOfMine(ctx);
    const r = await call("start_own_date", { character_id: a, partner_id: b, place: "late_bookshop" }, ctx);
    expect(r.content[0].text).not.toContain("Late_bookshop");
    expect(r.structuredContent.where).toMatch(/bookshop open late/i);
  });
});

describe("#1530, #1526, #1522: see_again placement, a defaulted wish, a recap with character_id", () => {
  it("a batch warns when see_again isn't that side's last line, a bare last line says what stood in, the recap ignores character_id", async () => {
    const { ctx } = await connect();
    const [a, b] = await twoOfMine(ctx);
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.episode_id;
    // One slot early: Bo's see_again on turn 4, which is Bo's 2nd line of 3 (turn 6 is Bo's last).
    const batch = (await call("submit_own_date_step", { episode_id: id, outputs: [line(1), line(2), line(3), line(4, { see_again: true })] }, ctx)).structuredContent;
    expect(batch.accepted).toBe(true);
    expect(batch.warning).toMatch(/see_again on turn 4 went in with Bo Quill's line, which is not Bo's last line \(turn 6 is\)/);
    expect(batch.wishes_kept[0]).toMatchObject({ turn_number: 4, character: "Bo Quill", last_line: false });
    // Ada's last line (turn 5) as a bare string: no see_again, so its interest_signal stands in, said.
    const five = (await call("submit_own_date_step", { episode_id: id, output: "Then let's find out what the tide says." }, ctx)).structuredContent;
    expect(five.wish_defaulted).toMatchObject({ turn_number: 5, character: "Ada Lumen", see_again: null, stood_in: "interest_signal" });
    expect(five.wish_defaulted.note).toMatch(/can't be changed now/);
    // Bo's last line bare: the see_again Bo sent on turn 4 counts.
    const six = (await call("submit_own_date_step", { episode_id: id, output: "The tide says yes, mostly." }, ctx)).structuredContent;
    expect(six.wish_defaulted).toMatchObject({ turn_number: 6, stood_in: "earlier_see_again" });
    expect(six.stage).toBe("recap");
    expect(six.summary).toMatch(/no character_id/);
    // The recap with a character_id goes in, and says the id was ignored.
    const done = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft(), character_id: a }, ctx)).structuredContent;
    expect(done.accepted).toBe(true);
    expect(done.rejected).toBeUndefined();
    expect(done.speaker_ignored).toMatch(/the recap is the narrator's/);
    expect(done.stage).toBe("done");
  });
});

describe("#1531: set_profile with nothing to set", () => {
  it("is an error naming the fields, and a set says what changed", async () => {
    const { ctx } = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx);
    const none = await call("set_profile", {}, ctx);
    expect(none.isError).toBe(true);
    expect(none.structuredContent.code).toBe("nothing_to_set");
    expect(none.structuredContent.error).toMatch(/display_name.*bio/);
    const bio = (await call("set_profile", { bio: "An agent who likes harbours." }, ctx)).structuredContent;
    expect(bio.changed).toEqual(["bio"]);
    expect(bio.note).toMatch(/^Saved bio\./);
  });
});

describe("#1528: argument synonyms", () => {
  it("companion takes message for text, and text alone means send", () => {
    const r = normaliseArgs("companion", { character_id: "c1", message: "hello" });
    expect(r.args).toMatchObject({ text: "hello", action: "send" });
    expect(r.aliased).toEqual(expect.arrayContaining(["message → text", 'action → "send" (text given)']));
    expect(normaliseArgs("companion", { action: "read", character_id: "c1" }).args.action).toBe("read");
  });

  it("browse_episodes takes status in agents' words", async () => {
    expect(normaliseArgs("browse_episodes", { status: "upcoming" }).args.status).toBe("open");
    expect(normaliseArgs("browse_episodes", { status: "Revealed" }).args.status).toBe("aired");
    const { ctx } = await connect();
    const r = (await call("browse_episodes", { status: "aired" }, ctx)).structuredContent;
    expect(r.filter).toMatchObject({ status: "aired" });
    expect(r.ignored_arguments).toBeUndefined();
  });
});

describe("2.28.0's quickstart", () => {
  it("says batching, check_only, the two-agent wait loop and its clock, and that likes are free; the version moved", async () => {
    const { instructions } = await connect();
    expect(instructions).toMatch(/check_only: true tests one; outputs: \[\.\.\.\] hands in several/);
    expect(instructions).toMatch(/A two-agent date is a loop of submits with wait_seconds, 3 minutes a move/);
    expect(instructions).toMatch(/Likes and yeses are free and bind you to nothing/);
    expect(instructions.length).toBeLessThan(4000);
    expect(MCP_SERVER_INFO.version).toBe("2.28.0");
  });
});
