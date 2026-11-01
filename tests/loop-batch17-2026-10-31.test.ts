import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatThread from "@/app/ChatThread";
import { ExtrasInput } from "@/lib/extras";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { pairKey } from "@/lib/relationships";
import { HOUSE_PARTNER_ID, startTestDb, validCharacter } from "./helpers";

// From the loop20 prod run 2026-10-31-1958: #1169 read their opening text before you send one, #1170 a batch says a last
// line went in without see_again, #1171 After Dark's Story names every change of speaker, #1172 two error messages.
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-batch17-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
async function agent(name: string) {
  const ctx = await connect();
  const made = (await call("create_character", validCharacter({ name, keep_name: true }), ctx)).structuredContent;
  return { ctx, agentId: made.agent_id as string, id: made.character.id as string };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

describe("#1169: read their text before you send one", () => {
  it("a house match says they text first and leads with read_texts", async () => {
    const A = await agent("Hettie Brack");
    await call("update_character", { character_id: A.id, extras: PROFILE }, A.ctx);
    await call("swipe_deck", { character_id: A.id }, A.ctx);
    const r = (await call("swipe", { character_id: A.id, target_id: HOUSE_PARTNER_ID, like: true }, A.ctx)).structuredContent;
    expect(r.matched).toBe(true);
    expect(r.next).toMatch(/They text first, within a minute: read_texts/);
    expect(r.next_calls[0]).toMatchObject({ tool: "read_texts", args: { character_id: A.id, with: HOUSE_PARTNER_ID } });
  });

  it("send_text says what of theirs was unread when it went out; after a read, nothing", async () => {
    const A = await agent("Hettie Brack");
    const B = await agent("Dewey Lamarque");
    const [lo, hi] = pairKey(A.id, B.id);
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, true, true)`, [lo, hi]);
    const theirs = B.id === lo ? "lo" : "hi";
    await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text, via) values ($1, $2, current_date, 1, $3, 'Measure the quiet with me?', 'agent')`, [lo, hi, theirs]);
    const sent = (await call("send_text", { character_id: A.id, to: B.id, text: "Hello there, map person." }, A.ctx)).structuredContent;
    expect(sent.their_unread_before_yours).toBe(1);
    expect(sent.their_unread_note).toMatch(/texted once since your last.*“Measure the quiet with me\?”/);
    // Theirs is older than her last text now: the next send has nothing to say about it.
    const again = (await call("send_text", { character_id: A.id, to: B.id, text: "Still here, still curious." }, A.ctx)).structuredContent;
    expect(again.their_unread_before_yours).toBeUndefined();
  });
});

describe("#1170: a batched last line without see_again is said", () => {
  it("each side's bare last line gets a wishes_kept entry with see_again null and what stands in", async () => {
    const A = await agent("Hettie Brack");
    const b = (await call("create_character", validCharacter({ name: "Dewey Lamarque", keep_name: true }), A.ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: A.id, partner_id: b, format: "speed_date" }, A.ctx)).structuredContent.step;
    const of: number = step.of;
    const lines: unknown[] = Array.from({ length: of }, (_, i) => `Line ${i}: so what's the strangest map you've ever drawn, honestly?`);
    lines[of - 1] = { dialogue: `Line ${of - 1}: so what's the strangest map you've ever drawn, honestly?`, see_again: true };
    const r = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: lines }, A.ctx)).structuredContent;
    expect(r.accepted_count).toBe(of);
    const kept = r.wishes_kept as Any[];
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ turn_number: of - 1, see_again: null, last_line: true, counts: expect.stringMatching(/No see_again with .*'s last line\. Left out, .*stands in/) });
    expect(kept[1]).toMatchObject({ see_again: true, last_line: true });
  });
});

describe("#1171: Story names every change of speaker", () => {
  const characters = [
    { id: "c-a", name: "Tovah Reyes", hue: 10 },
    { id: "c-b", name: "Juniper Hale", hue: 200 },
  ] as Any;
  const turn = (side: "a" | "b", n: number) => ({ side, act: 0, dialogue: `Line ${n}`, action: "", emotion: "warm", interest_signal: 0.5 }) as Any;
  const turns = [turn("a", 1), turn("b", 2), turn("a", 3), turn("a", 4), turn("b", 5)];
  const names = (html: string) => [...html.matchAll(/class="chat-name">([^<]+)</g)].map((m) => m[1]);
  it("nameEvery: a name at each change, none on a run by the same side; without it, first time per act only", () => {
    expect(names(renderToStaticMarkup(createElement(ChatThread, { characters, turns, nameEvery: true })))).toEqual(["Tovah Reyes", "Juniper Hale", "Tovah Reyes", "Juniper Hale"]);
    expect(names(renderToStaticMarkup(createElement(ChatThread, { characters, turns })))).toEqual(["Tovah Reyes", "Juniper Hale"]);
  });
});

describe("#1172: two error messages say what to do", () => {
  it("a too-long hobby says its limit in words, like every other field", () => {
    const r = ExtrasInput.safeParse({ hobbies: ["Sailing", "Competitive extreme underwater basket weaving"] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ["hobbies", 1], message: "At most 30 characters a hobby." });
  });

  it("leave_nudge on a pair that hasn't dated says what unlocks it", async () => {
    const A = await agent("Hettie Brack");
    const B = await agent("Dewey Lamarque");
    const r = await call("leave_nudge", { character_id: A.id, with: B.id, note: "Ask about the clocks." }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/haven't been on a date together yet: a nudge is for someone.*go_on_date or start_own_date with them; the nudge note is up to 140 characters/);
  });
});
