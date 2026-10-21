import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

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
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "one-date-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

async function agentWith(name: string) {
  const ctx = await connect();
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string };
}

// #558: start_own_date refused a pair with a date in progress, but go_on_date didn't look for a date the agents were
// still performing, so the same two characters had two dates going at once (one agent's own date, the other's booking).
describe("one date at a time for a couple, whichever way round", () => {
  it("go_on_date refuses (and its preview warns) while the pair's own date is unfinished, naming the episode", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const started = await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    expect(started.isError).toBeUndefined();
    const ownId: string = started.structuredContent.step.episode_id;

    // B's agent books the same two on the show's model while A's agent is playing their date.
    const preview = (await call("go_on_date", { character_id: B.id, partner_id: A.id, preview: true }, B.ctx)).structuredContent;
    expect(preview.can_book).toBe(false);
    expect(preview.problems.join(" ")).toContain(ownId);
    const booked = await call("go_on_date", { character_id: B.id, partner_id: A.id }, B.ctx);
    expect(booked.isError).toBe(true);
    expect(booked.content[0].text).toMatch(/date in progress that their agents are performing/);
    expect(booked.content[0].text).toContain(ownId);
    expect(await t.count("episodes")).toBe(1);

    // Once it's finished, nothing stands in the way.
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [ownId]);
    const after = (await call("go_on_date", { character_id: B.id, partner_id: A.id, preview: true }, B.ctx)).structuredContent;
    expect(after.problems ?? []).toEqual([]);
  });
});
