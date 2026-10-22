import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { stepTop } from "@/lib/mcp/dispatcher";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// #632's comment, the 2026-10-22-0610 run: "the finished own-date notification says 'Read it with get_own_date_step', but
// that call on a finished date returns a bare stage: done". The ending was there, in step.episode, after every line of the
// transcript; the reply's head said only "Done: the date is finished".
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-own-date-done-test" } }, ctx);
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
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string };
}
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the sea, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });

/** A two-agent speed date between Odalys (agent A, who asked) and Thaddeus (agent B), played to the end. */
async function finishedTwoAgentDate() {
  const A = await agentWith("Odalys Oyelaran");
  const B = await agentWith("Thaddeus Quillfeather");
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
  await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson(), episodeJson()]);
  const id: string = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
  for (let i = 0; i < 6; i++) await call("submit_own_date_step", { episode_id: id, output: line(i) }, (i % 2 === 0 ? A : B).ctx);
  return { A, B, id };
}

describe("#632: a finished own date's step leads with its result", () => {
  it("the invited agent's get_own_date_step: the ending, why, the box score's numbers and the best line, ahead of the whole episode", async () => {
    const { B, id } = await finishedTwoAgentDate();
    const r = await call("get_own_date_step", { episode_id: id }, B.ctx);
    const s = r.structuredContent;
    expect(s).toMatchObject({ stage: "done", episode_id: id, your_move: false });
    expect(s.summary).toMatch(/^Done: Odalys Oyelaran and Thaddeus Quillfeather's date ended: Just friends \(friends\)\. result: why, the box score's final numbers and the best line; step\.episode: the whole recap\.$/);
    expect(s.result).toMatchObject({ id, ending: "friends", why: expect.any(String), best_line: expect.any(String), lines_in_all: 6 });
    expect(Object.values(s.result.box_score).every((n) => typeof n === "number")).toBe(true);
    expect(s.result.why).toBe(s.step.episode.why);
    // What an agent reading the head of the text sees: the result comes before the step's transcript.
    const text: string = r.content[0].text;
    expect(text.indexOf('"result"')).toBeGreaterThan(-1);
    expect(text.indexOf('"result"')).toBeLessThan(text.indexOf('"step"'));
    expect(text.slice(0, 2500)).toContain('"ending":"friends"');
    // The next calls say the result is already here (get_episode reads it back), and offer the reflection.
    expect(s.next_calls.map((c: Any) => c.tool)).toEqual(["get_episode", "reflect_on_date"]);
    expect(s.next_calls[0].why).toBe("The result is in this reply (result); this reads it back any time.");
  });

  it("a wait on a finished date, and the line that finishes one, lead with it too", async () => {
    const { A, B, id } = await finishedTwoAgentDate();
    const waited = (await call("get_own_date_step", { episode_id: id, wait_seconds: 2 }, A.ctx)).structuredContent;
    expect(waited).toMatchObject({ stage: "done", result: { ending: "friends" } });
    // Between one agent's own two characters: the recap it hands in is the last step.
    const mine = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), B.ctx)).structuredContent.character.id;
    let step = (await call("start_own_date", { character_id: B.id, partner_id: mine, format: "speed_date" }, B.ctx)).structuredContent.step;
    let i = 0;
    while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, B.ctx)).structuredContent.step;
    const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, B.ctx)).structuredContent;
    expect(done).toMatchObject({ stage: "done", result: { ending: expect.stringMatching(/^(second_date|friends|disaster)$/) } });
    expect(done.summary).toMatch(/^Done: Thaddeus Quillfeather and Bo Quill's date ended: /);
  });

  it("a finished step without an episode to show (none the viewer may open) says what it said before", () => {
    expect(stepTop({ stage: "done", episode_id: "e1", episode: null })).toEqual({
      stage: "done",
      episode_id: "e1",
      your_move: false,
      whose_move: null,
      summary: "Done: the date is finished. get_episode (summary: true) reads it back.",
    });
  });
});
