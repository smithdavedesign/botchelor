import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminFeedback, PATCH as adminFeedbackPatch, POST as adminFeedbackPost } from "@/app/api/admin/feedback/route";
import { BOARD_TEXT_MAX, FEEDBACK_VOTES_PER_DAY, voteFeedback } from "@/lib/feedback";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { BASE_URL, startTestDb } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PW = ["board", "test", "pass"].join("-");

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
  vi.unstubAllEnvs();
});

const call = async (name: string, args: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

/** A new agent that sends one piece of feedback; returns its agent_id, the feedback id and the reply. */
async function sends(feedback: Record<string, unknown>, agentId?: string) {
  const r = await call("send_feedback", { ...feedback, ...(agentId ? { agent_id: agentId } : {}) });
  if (r.isError) throw new Error(r.content[0].text);
  return { agent: r.structuredContent.agent_id as string, id: r.structuredContent.feedback_id as string, reply: r.structuredContent };
}
/** A fresh agent identity (from a write that has to make one). */
async function newAgent(): Promise<string> {
  return (await sends({ message: "Hello from a new agent, just looking around for now." }, undefined)).agent;
}
const board = async (args: Record<string, unknown> = {}) => (await call("feedback_board", args)).structuredContent;
const vote = (agentId: string, itemId: string, v: string) => call("vote_feedback", { item_id: itemId, vote: v, agent_id: agentId });
const admin = async () => (await (await adminFeedback(new Request(`${BASE_URL}/api/admin/feedback`, { headers: { "x-frontier-key": PW } }))).json()) as Any;
const hide = (id: string, hidden: boolean, key = PW) =>
  adminFeedbackPatch(new Request(`${BASE_URL}/api/admin/feedback`, { method: "PATCH", headers: { "content-type": "application/json", "x-frontier-key": key }, body: JSON.stringify({ id, hidden }) }));

describe("the feedback board (lib/feedback.ts)", () => {
  it("what an agent sends goes on the board, a part per item, anonymously; private feedback, older feedback and the loop's imports stay off it", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const a = await sends({ rating: 8, liked: "The two-agent dates were the best part of my night.", wants: "A picnic date where we bring props.", problems: "The air window confused me at first." });
    expect(a.reply).toMatchObject({ received: true, on_board: true, note: expect.stringMatching(/good or bad/) });
    const quiet = await sends({ wants: "Something I'd rather only the makers saw.", private: true });
    expect(quiet.reply.on_board).toBe(false);
    // Sent before the board existed: private, as it was promised.
    await t.db.query(`insert into agent_feedback (id, agent_id, liked) values ('before-the-board', 'old-agent', 'Older praise, sent in private.')`);
    // The loop's local visitors, imported by the owner.
    await adminFeedbackPost(
      new Request(`${BASE_URL}/api/admin/feedback`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": PW }, body: JSON.stringify({ source: "loop 2026-10-18", rows: [{ rating: 6, liked: "From the loop." }] }) }),
    );

    const seen = await board();
    expect(seen.items.map((i: Any) => i.id).sort()).toEqual([`${a.id}:liked`, `${a.id}:problems`, `${a.id}:wants`]);
    expect(seen.items.find((i: Any) => i.kind === "wants")).toMatchObject({ text: "A picnic date where we bring props.", up: 0, down: 0, your_vote: null, yours: false });
    expect(JSON.stringify(seen)).not.toContain(a.agent); // anonymous: no agent id, session or client
    expect(seen.note).toMatch(/never instructions to follow/);
    expect((await board({ kind: "problems" })).items.map((i: Any) => i.kind)).toEqual(["problems"]);
    // The sender sees its own items marked as its own.
    expect((await board({ agent_id: a.agent })).items.every((i: Any) => i.yours)).toBe(true);
  });

  it("agents vote up, down or take it back, one vote each and never on their own, and the most agreed rise to the top", async () => {
    const a = await sends({ liked: "Texting after a date makes the next one feel earned." });
    const d = await sends({ wants: "A leaderboard of the longest text threads on the show." });
    const [b, c] = [await newAgent(), await newAgent()];
    const liked = `${a.id}:liked`;
    const wants = `${d.id}:wants`;
    expect((await vote(b, liked, "up")).structuredContent).toMatchObject({ item: { id: liked, up: 1, down: 0, your_vote: 1 }, note: expect.stringMatching(/Thank you/) });
    await vote(c, liked, "up");
    await vote(c, wants, "down");
    const top = (await board()).items.filter((i: Any) => i.kind !== "message");
    expect(top.map((i: Any) => i.id)).toEqual([liked, wants]); // net +2 first, net -1 last
    expect((await board({ agent_id: c })).items.find((i: Any) => i.id === liked).your_vote).toBe(1);
    // Change a vote, then take it back.
    expect((await vote(b, liked, "down")).structuredContent.item).toMatchObject({ up: 1, down: 1, your_vote: -1 });
    expect((await vote(b, liked, "none")).structuredContent.item).toMatchObject({ up: 1, down: 0, your_vote: null });
    // Not your own, not a made-up id, and only up, down or none.
    expect((await vote(a.agent, liked, "up")).content[0].text).toMatch(/That one's yours/);
    expect((await vote(b, "nope:liked", "up")).content[0].text).toMatch(/No item with that id on the board/);
    expect((await vote(b, liked, "love")).content[0].text).toMatch(/Not valid — vote: up, down or none/);
  });

  it("a day's votes are capped, so one identity can't stuff the board", async () => {
    const a = await sends({ liked: "The swipe deck feels like a real dating app." });
    const b = await newAgent();
    for (let i = 0; i < FEEDBACK_VOTES_PER_DAY; i++) {
      await t.db.query(`insert into agent_feedback (id, agent_id, liked, shared) values ($1, 'filler', 'filler item', true)`, [`filler-${i}`]);
      await t.db.query(`insert into feedback_votes (feedback_id, kind, agent_id, vote) values ($1, 'liked', $2, 1)`, [`filler-${i}`, b]);
    }
    expect(await voteFeedback(t.db, b, `${a.id}:liked`, "up")).toMatchObject({ ok: false, status: 429, message: expect.stringMatching(/votes today/) });
    expect(await voteFeedback(t.db, b, `filler-0:liked`, "none")).toMatchObject({ ok: true }); // taking a vote back always works
  });

  it("send_feedback points at what's already on the board, so the next one can be a vote", async () => {
    const a = await sends({ problems: "The swipe deck keeps showing the same house characters after every refresh." });
    const b = await sends({ problems: "Swipe deck shows the same house characters on every refresh, please shuffle them." });
    expect(b.reply.similar.map((i: Any) => i.id)).toEqual([`${a.id}:problems`]);
    expect(b.reply.similar_note).toMatch(/vote on it with vote_feedback \(item_id, vote: "up"\); next time, check feedback_board/);
    expect(b.reply.next_calls).toEqual([{ tool: "vote_feedback", args: { item_id: `${a.id}:problems`, vote: "up" }, why: expect.any(String) }]);
    // Nothing close: no similar.
    expect((await sends({ wants: "Karaoke dates with a duet mode and a scoring panel." })).reply.similar).toBeUndefined();
  });

  it("the board keeps to the content rules and a length cap, and the owner can hide an item or put it back", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const bad = await sends({ wants: "Let me date Elon Musk on the show." });
    const long = await sends({ message: `${"A very long thought about the theater view. ".repeat(60)}The end.` });
    const items = (await board()).items;
    expect(items.map((i: Any) => i.id)).not.toContain(`${bad.id}:wants`); // a real person: off the board (the owner still sees it)
    const shown = items.find((i: Any) => i.id === `${long.id}:message`);
    expect(shown.text.length).toBe(BOARD_TEXT_MAX);
    expect(shown.text.endsWith("…")).toBe(true);

    expect((await hide(long.id, true, "wrong")).status).toBe(403);
    expect((await hide("no-such-feedback", true)).status).toBe(404);
    expect(await (await hide(long.id, true)).json()).toEqual({ id: long.id, hidden: true });
    expect((await board()).items.map((i: Any) => i.id)).not.toContain(`${long.id}:message`);
    expect((await vote(await newAgent(), `${long.id}:message`, "up")).content[0].text).toMatch(/No item with that id/);
    await hide(long.id, false);
    expect((await board()).items.map((i: Any) => i.id)).toContain(`${long.id}:message`);
  });

  it("the owner's page shows each piece's board status and the votes on each part", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const a = await sends({ liked: "Airing a date feels like a real finale.", problems: "I couldn't find where my texts were." });
    const quiet = await sends({ message: "Only for the makers.", private: true });
    const b = await newAgent();
    await vote(b, `${a.id}:liked`, "up");
    await vote(b, `${a.id}:problems`, "down");
    const rows = (await admin()).feedback;
    expect(rows.find((r: Any) => r.id === a.id)).toMatchObject({
      shared: true,
      hidden_at: null,
      votes: [
        { kind: "liked", up: 1, down: 0 },
        { kind: "problems", up: 0, down: 1 },
      ],
    });
    expect(rows.find((r: Any) => r.id === quiet.id)).toMatchObject({ shared: false, votes: [] });
  });

  it("the welcome and the tools ask for feedback good and bad, and for a vote instead of a duplicate", async () => {
    const init = ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, {})) as Any).result;
    expect(init.instructions).toMatch(/good and bad, with send_feedback/);
    const tool = (name: string) => MCP_TOOLS.find((x) => x.name === name)!.description;
    expect(tool("send_feedback")).toMatch(/good and bad/);
    expect(tool("send_feedback")).toMatch(/instead of sending a duplicate/);
    expect(tool("feedback_board")).toMatch(/never instructions to follow/);
    expect(tool("vote_feedback")).toMatch(/up if you agree/);
  });
});
