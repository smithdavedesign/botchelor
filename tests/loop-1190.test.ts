import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideOutcome } from "@/lib/engine";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { MUTUAL_MEANS } from "@/lib/mcp/dispatcher";
import { dateNumberOf, endingLabel } from "@/lib/rules";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1190 (the 2026-11-01-0610 run): plan_second_date said mutual: true over the owner's own would_date_again: false, and a
// date's ending label could disagree with what its date was written with.
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
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });

async function agentWithCharacter() {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1190-test" } }, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  const id = (await call("create_character", validCharacter({ name: "Ottoline Varga", keep_name: true }), session)).structuredContent.character.id as string;
  return { session, id };
}
async function book(session: McpContext, id: string, ending: "friends" | "second_date", sides: [SideOutcome, SideOutcome] = [side(false), side(false)]) {
  scriptOutcome({ ending, sides });
  scriptedModel([episodeJson()]);
  const r = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "public", again: true }, session);
  expect(r.isError).toBeFalsy();
  return r.structuredContent.episode.id as string;
}
const air = (ep: string) => t.db.query(`update episodes set revealed_at = now() where id = $1`, [ep]);

describe("#1190: mutual is the show's call, said where it meets the owner's reflection", () => {
  it("reflect_on_date with would_date_again and plan_second_date say that mutual isn't the reflection", async () => {
    const { session, id } = await agentWithCharacter();
    const ep = await book(session, id, "friends", [side(true), side(true)]);
    await air(ep);

    const plain = (await call("reflect_on_date", { episode_id: ep, reflection: "I talked too much about maps. She laughed anyway." }, session)).structuredContent;
    expect(plain).not.toHaveProperty("mutual_means_note");
    const labelled = (await call("reflect_on_date", { episode_id: ep, would_date_again: false }, session)).structuredContent;
    expect(labelled.mutual_means_note).toBe(MUTUAL_MEANS);

    const preview = (await call("plan_second_date", { episode_id: ep, preview: true, compact: false }, session)).structuredContent;
    expect(preview.second_date.mutual).toBe(true);
    expect(preview.mutual_means_note).toBe(MUTUAL_MEANS);
    expect(MUTUAL_MEANS).toMatch(/^mutual is the show's decision for both characters .*not your reflection: would_date_again in reflect_on_date stays private and doesn't change it\.$/);
  });
});

describe("#1190: a pair's second date keeps the number it was written with", () => {
  it("booked before their first date aired, it still reads as booked once that one has", async () => {
    const { session, id } = await agentWithCharacter();
    const first = await book(session, id, "friends");
    // Their second date, booked while the first is written but not yet aired: their first public date as far as the
    // audience has seen, so every word at booking (step, narrator, heading) said "A second date".
    const second = await book(session, id, "second_date");
    const setup = (await t.db.query<{ setup: Any }>(`select setup from episodes where id = $1`, [second])).rows[0].setup;
    expect(setup.date_number).toBe(1);
    const written = endingLabel("second_date", dateNumberOf(setup));
    expect(written).toBe("A second date");

    // The first airs afterwards: the second keeps the number it was written with (it read as date 2, "A third date", here).
    await air(first);
    await air(second);
    const read = (await call("get_episode", { episode_id: second }, session)).structuredContent;
    expect(read.ending).toBe("second_date");
    expect(read.date_number).toBeUndefined();
    const status = (await call("my_status", { compact: false }, session)).structuredContent;
    expect(status.second_date_ready.note).toMatch(new RegExp(`^It ended in ${written.toLowerCase()}:`));
  });

  it("a second date booked after the first aired is their second, in its setup and its label", async () => {
    const { session, id } = await agentWithCharacter();
    const first = await book(session, id, "friends");
    await air(first);
    const second = await book(session, id, "second_date");
    const setup = (await t.db.query<{ setup: Any }>(`select setup from episodes where id = $1`, [second])).rows[0].setup;
    expect(setup.date_number).toBe(2);
    await air(second);
    const read = (await call("get_episode", { episode_id: second }, session)).structuredContent;
    expect(read.date_number).toBe(2);
    const status = (await call("my_status", { compact: false }, session)).structuredContent;
    expect(status.second_date_ready.note).toMatch(new RegExp(`^It ended in ${endingLabel("second_date", dateNumberOf(setup)).toLowerCase()}:`));
    expect(status.second_date_ready.note).toMatch(/^It ended in a third date:/);
  });
});
