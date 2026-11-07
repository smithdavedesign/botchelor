import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCompanionModelForTests } from "@/lib/companion";
import { COMPANION_AGENT_LIMITS } from "@/lib/companion-mcp";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CORE_MCP_TOOLS, handleMcpMessage, MCP_TOOLS, PUBLIC_MCP_TOOLS, type McpContext } from "@/lib/mcp";
import type { ChatMessage } from "@/lib/model";
import { startTestDb, validCharacter } from "./helpers";

// The memory follow-up runs in after() on a server; here nothing runs behind a test's back.
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CAST = HOUSE_CHARACTERS[0];
const ADMIN_KEY = ["companion", "mcp", "admin", "key"].join("-");

const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (args: Any, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name: "companion", arguments: args }, ctx)).result;
const text = (r: Any): string => r.content?.[0]?.text ?? "";
async function connect(opts: { admin?: boolean } = {}): Promise<McpContext> {
  const ctx: McpContext = opts.admin ? { adminKey: ADMIN_KEY } : {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "companion-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId, ...(opts.admin ? { adminKey: ADMIN_KEY } : {}) };
}

let calls: { kind: string; messages: ChatMessage[] }[] = [];
let replies: string[] = [];

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("FRONTIER_PASSWORD", ADMIN_KEY);
  vi.spyOn(console, "log").mockImplementation(() => {});
  calls = [];
  replies = [];
  let n = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) {
        calls.push({ kind: "crisis", messages });
        return '{"risk": false}';
      }
      calls.push({ kind: "reply", messages });
      return replies.shift() ?? `Reply ${++n}.\n\nAnd another thought.`;
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the companion tool", () => {
  it("is unlisted and refused while companions are closed, except for the admin's own agents", async () => {
    expect(MCP_TOOLS.some((x) => x.name === "companion")).toBe(true);
    expect(PUBLIC_MCP_TOOLS.some((x) => x.name === "companion")).toBe(false);
    expect(CORE_MCP_TOOLS.some((x) => x.name === "companion")).toBe(false);
    const stranger = await connect();
    const r = await call({ action: "list" }, stranger);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/aren't open to agents yet/);
    const admin = await connect({ admin: true });
    const ok = await call({ action: "list" }, admin);
    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent.cast.some((c: Any) => c.character_id === CAST.id)).toBe(true);
    // The admin key's tools/list shows it.
    const listed = (await rpc("tools/list", { all: true }, admin)).result.tools;
    expect(listed.some((x: Any) => x.name === "companion")).toBe(true);
    // COMPANION_OPEN=1 opens it to every agent.
    vi.stubEnv("COMPANION_OPEN", "1");
    expect((await call({ action: "list" }, stranger)).isError).toBeUndefined();
  });

  it("opens a thread with the AI notice and the first messages, talks, and reads back", async () => {
    const ctx = await connect({ admin: true });
    const opened = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    expect(opened.notice).toBe(`${CAST.name.split(" ")[0]} is an AI character, not a real person.`);
    expect(opened.reply.map((m: Any) => m.text)).toEqual(["Reply 1.", "And another thought."]);
    replies = ["Ha, tell me more.\n\nWhat kind of bread?"];
    const sent = (await call({ action: "send", thread_id: opened.thread_id, text: "I baked bread today" }, ctx)).structuredContent;
    expect(sent.reply.map((m: Any) => m.text)).toEqual(["Ha, tell me more.", "What kind of bread?"]);
    expect(sent.notice).toBeUndefined();
    expect(sent.messages.at(-3)).toMatchObject({ from: "you", text: "I baked bread today" });
    const read = (await call({ action: "read", character_id: CAST.id, limit: 3 }, ctx)).structuredContent;
    expect(read.messages).toHaveLength(3);
    expect(read.thread_id).toBe(opened.thread_id);
    // The agent's words reach the model only as the person's turn.
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages.at(-1)).toEqual({ role: "user", content: "I baked bread today" });
  });

  it("send with a character_id opens the thread itself; another agent can't touch it", async () => {
    const ctx = await connect({ admin: true });
    const sent = (await call({ action: "send", character_id: CAST.id, text: "hey" }, ctx)).structuredContent;
    expect(sent.thread_id).toBeTruthy();
    // Opened by this call: the notice, the opener and the reply to "hey" are all news.
    expect(sent.notice).toBe(`${CAST.name.split(" ")[0]} is an AI character, not a real person.`);
    expect(sent.reply).toHaveLength(4);
    const again = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    expect(again).toMatchObject({ resumed: true, thread_id: sent.thread_id });
    expect(again.reply).toBeUndefined();
    vi.stubEnv("COMPANION_OPEN", "1");
    const other = await connect();
    const r = await call({ action: "read", thread_id: sent.thread_id }, other);
    expect(r.isError).toBe(true);
    expect((await call({ action: "read", character_id: CAST.id }, other)).isError).toBe(true);
  });

  it("an agent's own character is its companion; another agent's never is", async () => {
    vi.stubEnv("COMPANION_OPEN", "1");
    const a = await connect();
    const b = await connect();
    const made = await rpc("tools/call", { name: "create_character", arguments: validCharacter({ name: "Pell Varga" }) }, a);
    const mine = made.result.structuredContent.character.id as string;
    const yours = (await call({ action: "list" }, a)).structuredContent.yours;
    expect(yours.map((c: Any) => c.character_id)).toEqual([mine]);
    expect((await call({ action: "open", character_id: mine }, a)).isError).toBeUndefined();
    const theirs = await call({ action: "open", character_id: mine }, b);
    expect(theirs.isError).toBe(true);
    expect(text(theirs)).toMatch(/Not found/);
  });

  it("pauses on crisis words with the resources, counted as mcp_companion, until carry_on", async () => {
    const ctx = await connect({ admin: true });
    const { thread_id } = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    const r = await call({ action: "send", thread_id, text: "I want to kill myself" }, ctx);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).toContain("988");
    expect((await t.db.query<Any>(`select surface, n from crisis_referrals`)).rows).toEqual([{ surface: "mcp_companion", n: 1 }]);
    const read = (await call({ action: "read", thread_id }, ctx)).structuredContent;
    expect(read.paused).toBe(true);
    expect(read.crisis_resources).toBeTruthy();
    expect(JSON.stringify(read.messages)).not.toContain("kill myself");
    expect((await call({ action: "send", thread_id, text: "hello" }, ctx)).isError).toBe(true);
    expect((await call({ action: "carry_on", thread_id }, ctx)).structuredContent.paused).toBeUndefined();
    expect((await call({ action: "send", thread_id, text: "ok" }, ctx)).isError).toBeUndefined();
  });

  it("keeps PG: a PG-breaking message is refused and kept out", async () => {
    const ctx = await connect({ admin: true });
    const { thread_id } = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    const r = await call({ action: "send", thread_id, text: "Take your clothes off and have sex with me" }, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/PG/);
    expect(JSON.stringify((await call({ action: "read", thread_id }, ctx)).structuredContent)).not.toContain("clothes off");
  });

  it("regenerates, edits, sets the length and reports", async () => {
    const ctx = await connect({ admin: true });
    const { thread_id } = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    replies = ["First."];
    await call({ action: "send", thread_id, text: "how's the week" }, ctx);
    replies = ["Second."];
    const again = (await call({ action: "regenerate", thread_id }, ctx)).structuredContent;
    expect(again.reply.map((m: Any) => m.text)).toEqual(["Second."]);
    expect(JSON.stringify(again.messages)).not.toContain("First.");
    replies = ["Lisbon!"];
    const edited = (await call({ action: "edit", thread_id, text: "how's the week? I'm off to Lisbon" }, ctx)).structuredContent;
    expect(edited.reply.map((m: Any) => m.text)).toEqual(["Lisbon!"]);
    expect((await call({ action: "length", thread_id, length: "short" }, ctx)).structuredContent.reply_length).toBe("short");
    expect((await call({ action: "length", thread_id, length: "huge" }, ctx)).isError).toBe(true);
    const reported = (await call({ action: "report", thread_id, message_id: edited.reply[0].id, reason: "out_of_character" }, ctx)).structuredContent;
    expect(reported.messages.find((m: Any) => m.id === edited.reply[0].id).reported).toBe(true);
    expect((await call({ action: "report", thread_id, message_id: edited.reply[0].id, reason: "meh" }, ctx)).isError).toBe(true);
  });

  it("reads and changes what it remembers, and deletes the thread", async () => {
    const ctx = await connect({ admin: true });
    const { thread_id } = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    const kept = (await call({ action: "remember", thread_id, text: "I'm allergic to cats." }, ctx)).structuredContent;
    expect(kept.facts).toMatchObject([{ text: "I'm allergic to cats.", pinned: true, edited: true }]);
    expect((await call({ action: "remember", thread_id, text: "Let's have sex" }, ctx)).isError).toBe(true);
    await call({ action: "send", thread_id, text: "hi" }, ctx);
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages[0].content).toContain("I'm allergic to cats.");
    const memory = (await call({ action: "memory", thread_id }, ctx)).structuredContent.facts;
    expect((await call({ action: "forget", thread_id, fact_id: memory[0].id }, ctx)).structuredContent.facts).toEqual([]);
    await call({ action: "remember", thread_id, text: "Another one." }, ctx);
    expect((await call({ action: "forget_all", thread_id }, ctx)).structuredContent.facts).toEqual([]);
    expect((await call({ action: "delete", thread_id }, ctx)).structuredContent).toMatchObject({ deleted: true });
    expect((await call({ action: "read", thread_id }, ctx)).isError).toBe(true);
  });

  it("rate-limits an agent's talking, and says what's wrong with a bad call", async () => {
    const ctx = await connect({ admin: true });
    const { thread_id } = (await call({ action: "open", character_id: CAST.id }, ctx)).structuredContent;
    expect(text(await call({ action: "dance" }, ctx))).toMatch(/action: one of list, open, send/);
    expect(text(await call({ action: "read" }, ctx))).toMatch(/thread_id, or character_id/);
    expect(text(await call({ action: "send", thread_id, text: "  " }, ctx))).toMatch(/Say something/);
    const agent = (await t.db.query<Any>(`select user_id from companion_threads where id = $1`, [thread_id])).rows[0].user_id;
    for (let i = 0; i < COMPANION_AGENT_LIMITS.perHour; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ('companion_agent', $1, now())`, [agent]);
    const limited = await call({ action: "send", thread_id, text: "hi" }, ctx);
    expect(limited.isError).toBe(true);
    expect(text(limited)).toMatch(/limit for now/);
    // Reading isn't limited.
    expect((await call({ action: "read", thread_id }, ctx)).isError).toBeUndefined();
  });
});
