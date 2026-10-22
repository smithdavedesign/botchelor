import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// #620's comment, the 2026-10-22-0610 run: "read_texts with with and wait_seconds: 30 returned [] right after Odalys had
// texted, so I didn't see the thread." Thaddeus had matched and never texted, so the wait looked only past "now".
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-read-texts-opener-test" } }, ctx);
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
/** Two agents' characters that matched; B's agent texts first. */
async function opener() {
  const A = await agentWith("Thaddeus Quillfeather");
  const B = await agentWith("Odalys Oyelaran");
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  const sent = await call("send_text", { character_id: B.id, to: A.id, text: "Your barometer and my lamp should meet." }, B.ctx);
  if (sent.isError) throw new Error(sent.content[0].text);
  return { A, B };
}

describe("#620: a read_texts wait on a thread you haven't texted yet", () => {
  it("returns their unread opener at once, not [] after the whole wait", async () => {
    const { A, B } = await opener();
    const r = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(r.items.map((i: Any) => i.text)).toEqual(["Your barometer and my lamp should meet."]);
    expect(r.returned_because).toBe("at_start");
    expect(r.waited_seconds).toBeLessThan(3);
    // Read now: the next wait waits for what comes after it, and the notice is gone from waiting_for_you.
    const again = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(again).toMatchObject({ items: [], returned_because: "timeout" });
    expect(again.thread.map((i: Any) => i.text)).toEqual(["Your barometer and my lamp should meet."]);
    expect((await call("my_status", {}, A.ctx)).structuredContent.waiting_for_you?.texted).toBeUndefined();
  });

  it("wait_for_text (the same wait) returns it too", async () => {
    const { A, B } = await opener();
    const r = (await call("wait_for_text", { character_id: A.id, with: B.id, timeout_seconds: 5 }, A.ctx)).structuredContent;
    expect(r.items.map((i: Any) => i.text)).toEqual(["Your barometer and my lamp should meet."]);
    expect(r.returned_because).toBe("at_start");
  });

  it("an opener already read (read_texts without a wait) isn't returned again: the wait waits for their next text", async () => {
    const { A, B } = await opener();
    const read = (await call("read_texts", { character_id: A.id, with: B.id }, A.ctx)).structuredContent;
    expect(read.items.map((i: Any) => i.text)).toContain("Your barometer and my lamp should meet.");
    const r = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(r).toMatchObject({ items: [], returned_because: "timeout" });
  });

  it("once you've texted, only what they sent after your text is new (#415, unchanged)", async () => {
    const { A, B } = await opener();
    await call("send_text", { character_id: A.id, to: B.id, text: "Agnes would like that." }, A.ctx);
    const r = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(r).toMatchObject({ items: [], returned_because: "timeout" });
    await call("send_text", { character_id: B.id, to: A.id, text: "Bring her on Saturday." }, B.ctx);
    const next = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(next.items.map((i: Any) => i.text)).toEqual(["Bring her on Saturday."]);
  });
});
