import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airEpisode } from "@/lib/air";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 2026-11-20-0610 run, #1878: "plan_second_date with Cornelius: my yes is recorded, waiting on their creator ...
// Nothing visible after the final yes". my_status lists the second-date yeses still open, both ways.
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
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string) {
  const c: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1878-test" } }, c);
  const ctx = { sessionId: c.issuedSessionId };
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string };
}
async function airedFirstDate() {
  const A = await agentWith("Lysander Vexley");
  const B = await agentWith("Cornelius Quillby");
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson(), episodeJson()]);
  const booked = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
  if (booked.isError) throw new Error(booked.content[0].text);
  const first = booked.structuredContent.episode.id as string;
  await airEpisode(t.db, first, A.agentId);
  return { A, B, first };
}
const status = async (ctx: McpContext) => (await call("my_status", { include: ["all"] }, ctx)).structuredContent;

describe("#1878: my_status lists second-date yeses still waiting", () => {
  it("shows a recorded yes as waiting_on_them to the one who said it and waiting_on_you to the other, with plan_second_date next", async () => {
    const { A, B, first } = await airedFirstDate();
    expect((await status(A.ctx)).second_date_yeses).toBeUndefined();

    const yes = (await call("plan_second_date", { episode_id: first, confirm: true }, A.ctx)).structuredContent;
    expect(yes.booked).toBeFalsy();

    const mine = await status(A.ctx);
    expect(mine.second_date_yeses).toMatchObject({
      waiting_on_them: [{ episode_id: first, your_character: { id: A.id, name: "Lysander Vexley" }, with: { id: B.id, name: "Cornelius Quillby" }, date_number: 2 }],
      waiting_on_you: [],
    });
    expect(Date.parse(mine.second_date_yeses.waiting_on_them[0].yes_at)).not.toBeNaN();
    expect(mine.second_date_yeses_note).toMatch(/waiting_on_them: your yes, waiting on their creator/);
    expect(mine.next_calls.some((c: Any) => c.tool === "my_status" && c.args.wait_seconds && /Cornelius's creator/.test(c.why))).toBe(true);

    const theirs = await status(B.ctx);
    expect(theirs.second_date_yeses).toMatchObject({
      waiting_on_them: [],
      waiting_on_you: [{ episode_id: first, your_character: { id: B.id }, with: { id: A.id, name: "Lysander Vexley" }, date_number: 2 }],
    });
    expect(theirs.next_calls[0]).toMatchObject({ tool: "plan_second_date", args: { episode_id: first, preview: true } });
    expect(theirs.next_calls[0].why).toMatch(/^Lysander's creator said yes to a second date with Cornelius/);
    // The other creator heard it too (the route's notice), as before.
    const notes = (await call("my_notifications", {}, B.ctx)).structuredContent;
    expect(JSON.stringify(notes)).toContain("second_date_yes");

    // B's yes books it: neither side lists it any more.
    scriptedModel([episodeJson(), episodeJson()]);
    const booked = (await call("plan_second_date", { episode_id: first, confirm: true }, B.ctx)).structuredContent;
    expect(booked.booked).toBe(true);
    expect((await status(A.ctx)).second_date_yeses).toBeUndefined();
    expect((await status(B.ctx)).second_date_yeses).toBeUndefined();
  });
});
