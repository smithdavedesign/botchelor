import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// The 2026-10-18-0610 visitor run: #205 (#203 is in swipes.test.ts, #204 in loop-round-9.test.ts).
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-round-10-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: i === 1 ? "leans in" : "", emotion: "curious", interest_signal: 0.6 });

async function ownDate() {
  const ctx = await connect();
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
  const first = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
  return { ctx, first, id: first.episode_id as string };
}

describe("compact own-date steps (#205)", () => {
  it("turn steps leave out the unchanging system message by default (#214); compact: false brings it back", async () => {
    const { ctx, first, id } = await ownDate();
    expect(first.messages.map((m: Any) => m.role)).toEqual(["system", "user"]);
    expect(first.system_unchanged).toBeUndefined();
    const system = first.messages[0].content;

    const compact = (await call("submit_own_date_step", { episode_id: id, output: line(0), compact: true }, ctx)).structuredContent.step;
    expect(compact).toMatchObject({ stage: "turn", turn_number: 2, system_unchanged: true });
    expect(compact.messages.map((m: Any) => m.role)).toEqual(["user"]);

    const full = (await call("get_own_date_step", { episode_id: id, compact: false }, ctx)).structuredContent.step;
    expect(full.messages).toEqual([{ role: "system", content: system }, compact.messages[0]]);
    expect(full.system_unchanged).toBeUndefined();

    // 2.8.0 (the 2026-10-22-0400 run): left out, the prompt is left out too; compact: true is what the default was.
    const again = (await call("get_own_date_step", { episode_id: id }, ctx)).structuredContent.step;
    expect(again).toMatchObject({ messages: [], prompt_left_out: true });
    expect((await call("get_own_date_step", { episode_id: id, compact: true }, ctx)).structuredContent.step.messages).toEqual(compact.messages);
  });

  it("a turn step carries the last couple of lines as plain text", async () => {
    const { ctx, first, id } = await ownDate();
    expect(first.last_lines).toBeUndefined();
    await call("submit_own_date_step", { episode_id: id, output: line(0) }, ctx);
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, ctx);
    const step = (await call("submit_own_date_step", { episode_id: id, output: line(2) }, ctx)).structuredContent.step;
    expect(step.last_lines).toEqual([
      "Bo Quill: Line 1: so what's the strangest map you've ever drawn? (leans in)",
      "Ada Lumen: Line 2: so what's the strangest map you've ever drawn?",
    ]);
  });
});

describe("get_episode since_turn (#205)", () => {
  it("returns only the lines from since_turn on, and how many there are", async () => {
    const { ctx, id } = await ownDate();
    for (let i = 0; i < 3; i++) await call("submit_own_date_step", { episode_id: id, output: line(i) }, ctx);
    const full = (await call("get_episode", { episode_id: id }, ctx)).structuredContent;
    expect(full.transcript).toHaveLength(3);
    expect(full.transcript_total).toBeUndefined();
    const tail = (await call("get_episode", { episode_id: id, since_turn: 2 }, ctx)).structuredContent;
    expect(tail).toMatchObject({ transcript_from: 2, transcript_total: 3 });
    expect(tail.transcript).toEqual(full.transcript.slice(2));
    const waited = (await call("wait_for_episode", { episode_id: id, since_turn: 3, timeout_seconds: 1 }, ctx)).structuredContent;
    expect(waited).toMatchObject({ transcript: [], transcript_total: 3 });
  });
});
