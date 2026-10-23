import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import * as keysRoute from "@/app/api/me/keys/route";
import { listUserKeys, pingKey, TEXT_PROVIDERS } from "@/lib/keys";
import { startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// BYOK UX: new MCP tools (set_model, my_model, clear_model), the expanded provider list and the ping helper.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage(
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "byok-test" } } },
    ctx,
  );
  return { sessionId: ctx.issuedSessionId };
}
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

describe("TEXT_PROVIDERS: expanded list", () => {
  it("includes Anthropic, DeepSeek and Groq alongside the originals", () => {
    expect(Object.keys(TEXT_PROVIDERS).sort()).toEqual(["anthropic", "deepseek", "google", "groq", "openai", "openrouter"]);
    expect(TEXT_PROVIDERS.anthropic.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(TEXT_PROVIDERS.deepseek.baseUrl).toBe("https://api.deepseek.com");
    expect(TEXT_PROVIDERS.groq.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(TEXT_PROVIDERS.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("each provider lists at least one recommended model with a note", () => {
    for (const p of Object.values(TEXT_PROVIDERS)) {
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.defaultModel.length).toBeGreaterThan(0);
      // The default is one of the listed models (so a user picking "default" gets something real).
      expect(p.models.some((m) => m.id === p.defaultModel)).toBe(true);
      for (const m of p.models) {
        expect(m.id).toMatch(/\S/);
        expect(m.note).toMatch(/\S/);
      }
    }
  });
});

describe("pingKey: one-call validation", () => {
  it("returns ok when the provider replies 200", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    const r = await pingKey("deepseek", "sk-test-aaaa", null, { fetchImpl: fetchImpl as typeof fetch });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.model).toBe(TEXT_PROVIDERS.deepseek.defaultModel);
      expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects a user-chosen model", async () => {
    let seen: Record<string, unknown> | undefined;
    const fetchImpl = async (_: unknown, init?: { body?: BodyInit }) => {
      seen = JSON.parse(init?.body as string);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    const r = await pingKey("anthropic", "sk-ant-test", "claude-sonnet-5-5", { fetchImpl: fetchImpl as typeof fetch });
    expect(r.ok).toBe(true);
    expect(seen?.model).toBe("claude-sonnet-5-5");
  });

  it("returns ok: false in plain words on a 4xx, never the provider's own text (it can echo part of the key)", async () => {
    const bad = ["test", "key", "not", "real", "bad"].join("-"); // built from parts, obviously fake
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${bad}.` } }), { status: 401, headers: { "content-type": "application/json" } });
    const r = await pingKey("openai", bad, null, { fetchImpl: fetchImpl as typeof fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toBe("401: OpenAI didn't accept this key");
      expect(r.error).not.toContain(bad);
    }
  });

  it("refuses an unknown provider", async () => {
    const r = await pingKey("notaprovider", "x");
    expect(r.ok).toBe(false);
  });
});

describe("MCP: set_model / my_model / clear_model", () => {
  it("my_model with no key lists providers and default models", async () => {
    const ctx = await connect();
    const r = (await call("my_model", {}, ctx)).structuredContent;
    expect(r.byok).toBe(false);
    expect(r.providers.find((p: Any) => p.id === "anthropic")).toMatchObject({ label: "Anthropic Claude" });
    expect(r.providers.find((p: Any) => p.id === "deepseek")).toMatchObject({ label: "DeepSeek" });
    expect(r.providers.find((p: Any) => p.id === "groq")).toBeDefined();
  });

  it("set_model saves and my_model reads it back without exposing the key", async () => {
    const ctx = await connect();
    const r = (await call("set_model", { provider: "deepseek", api_key: "sk-deepseek-aaaabbbbccccdddd", model: "deepseek-chat" }, ctx)).structuredContent;
    expect(r).toMatchObject({ saved: true, provider: "deepseek", model: "deepseek-chat", last4: "dddd" });
    const after = (await call("my_model", {}, ctx)).structuredContent;
    expect(after).toMatchObject({ byok: true, provider: "deepseek", model: "deepseek-chat", last4: "dddd" });
    // Nothing in the reply resembles the full key.
    expect(JSON.stringify(after)).not.toContain("sk-deepseek-aaaabbbbccccdddd");
    // The row exists under the agent_id as user_id. toToolResult surfaces the agent id as structuredContent.agent_id.
    const agentId = (await call("my_model", {}, ctx)).structuredContent.agent_id as string | undefined;
    expect(agentId).toBeDefined();
    const stored = await listUserKeys(t.db, agentId!);
    expect(stored.find((k) => k.kind === "text")).toMatchObject({ provider: "deepseek", last4: "dddd" });
  });

  it("set_model refuses an unknown provider or a short key", async () => {
    const ctx = await connect();
    const bad = await call("set_model", { provider: "nothingreal", api_key: "sk-whatever-abcdefgh" }, ctx);
    expect(bad.isError).toBe(true);
    // 2.8.0 (#650): refused before the tool runs, by the enum check every tool shares, naming the values.
    expect(bad.content[0].text).toMatch(/^Error: Not valid — provider: one of google, openai, anthropic/);
    const short = await call("set_model", { provider: "openai", api_key: "sk-x" }, ctx);
    expect(short.isError).toBe(true);
    expect(short.content[0].text).toMatch(/at least 8 characters/);
  });

  it("clear_model drops the key and my_model goes back to byok: false", async () => {
    const ctx = await connect();
    await call("set_model", { provider: "openai", api_key: "sk-openai-aaaa0000bbbb1111" }, ctx);
    const removed = (await call("clear_model", {}, ctx)).structuredContent;
    expect(removed.removed).toBe(true);
    const after = (await call("my_model", {}, ctx)).structuredContent;
    expect(after.byok).toBe(false);
  });

  it("set_model saves nothing when test: true and the ping fails", async () => {
    const ctx = await connect();
    // Monkey-patch global fetch so pingKey hits a 401.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const r = await call("set_model", { provider: "openai", api_key: "sk-bad-00000000", test: true }, ctx);
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/didn't work.*Nothing was saved/);
      const after = (await call("my_model", {}, ctx)).structuredContent;
      expect(after.byok).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("the core list and MCP_TOOLS include set_model / my_model / clear_model", () => {
    expect(CORE_TOOL_ORDER).toContain("set_model");
    expect(CORE_TOOL_ORDER).toContain("my_model");
    expect(CORE_TOOL_ORDER).toContain("clear_model");
    expect(MCP_TOOLS.find((t) => t.name === "set_model")).toBeDefined();
  });
});

describe("account/keys POST test-only endpoint", () => {
  it("exports a POST handler for key testing (shape only; unit above exercises pingKey)", () => {
    expect(typeof (keysRoute as { POST?: unknown }).POST).toBe("function");
  });
});

// A placeholder referenced by the typecheck: using validCharacter so the import doesn't go unused when adding checks.
describe("sanity", () => {
  it("validCharacter still builds a usable sheet", () => {
    const s = validCharacter({ name: "Pip" });
    expect(s.name).toBe("Pip");
    expect(Array.isArray(s.traits)).toBe(true);
  });
});
