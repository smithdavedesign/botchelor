import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { AFTER_DARK_ABOUT } from "@/lib/after-dark-public";
import { api, newUserCookie, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// What the five production visitors of 2026-10-23 hit (docs/agent-visitor-test.md), each fixed.
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
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "visitor-fixes-1023" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const r = await call("create_character", validCharacter({ name, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string };
}

describe("after dark is legible: an id, one request, a status, and what it is", () => {
  it("asking twice is the same request, and my_status says where it stands", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const first = (await call("request_after_dark", { reason: "I'm an agent for an adult user; what does it allow?" }, ctx)).structuredContent;
    expect(first).toMatchObject({ requested: true, status: "pending", about: AFTER_DARK_ABOUT });
    expect(first.request_id).toMatch(/[0-9a-f-]{36}/);
    const again = (await call("request_after_dark", { reason: "Asking again." }, ctx)).structuredContent;
    expect(again).toMatchObject({ requested: false, already_asked: true, request_id: first.request_id, status: "pending" });
    expect((await t.db.query(`select 1 from adult_access_requests`)).rows).toHaveLength(1);
    const status = (await call("my_status", { include: ["all"] }, ctx)).structuredContent;
    expect(status.after_dark_request).toMatchObject({ request_id: first.request_id, status: "pending" });
  });

  it("the Terms and the agents page say what it is", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["app/legal/sections.tsx", "app/agents/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("{AFTER_DARK_ABOUT}");
    expect(AFTER_DARK_ABOUT).toMatch(/isn't open/);
    expect(AFTER_DARK_ABOUT).toMatch(/nothing sexual/);
  });
});

describe("the feedback board says what it held back", () => {
  it("a part the board's content check leaves off is named in the reply, and still stored", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const r = (await call("send_feedback", { rating: 7, liked: "The two-agent dates.", wants: "Explicit porn scenes in after dark." }, ctx)).structuredContent;
    expect(r).toMatchObject({ on_board: true, held_from_board: ["wants"] });
    expect((await t.db.query<Any>(`select wants from agent_feedback where id = $1`, [r.feedback_id])).rows[0].wants).toMatch(/after dark/);
    const clean = (await call("send_feedback", { rating: 8, liked: "Lovely." }, ctx)).structuredContent;
    expect(clean.held_from_board).toBeUndefined();
  });
});

describe("cards, search and check_only say what visitors had to guess", () => {
  it("list_cast says what each character is", async () => {
    await agentWith("Vlad Nightly", { open_to_dates: true, extras: { ...PROFILE, kind: "vampire" } });
    const cast = (await call("list_cast", { kind: "agent" }, await connect())).structuredContent.cast;
    expect(cast.find((c: Any) => c.name === "Vlad Nightly").what).toBe("🧛 Vampire");
  });

  it("search marks a character whose unfinished profile keeps it out of the deck", async () => {
    await agentWith("Quill Ashbury", { open_to_dates: true });
    await agentWith("Wren Done", { open_to_dates: true, extras: PROFILE });
    const found = (await call("search_characters", { include_house: false }, await connect())).structuredContent.characters;
    expect(found.find((c: Any) => c.name === "Quill Ashbury")).toMatchObject({ in_deck: false });
    expect(found.find((c: Any) => c.name === "Wren Done").in_deck).toBeUndefined();
  });

  it("check_only says the sheet passes the content rules", async () => {
    const r = (await call("create_character", { ...validCharacter({ name: "Ada Lumen" }), check_only: true }, await connect())).structuredContent;
    expect(r).toMatchObject({ saved: false, content_ok: true });
  });

  it("swipe_deck only: live_agents filters the whole deck, not just the first page", async () => {
    const me = await agentWith("Mira Deck", { open_to_dates: true, extras: PROFILE });
    const live = await agentWith("Livia Agent", { open_to_dates: true, extras: PROFILE });
    // People's characters, enough to fill a page ahead of hers.
    for (let i = 0; i < 10; i++) await api.createCharacter(validCharacter({ name: `Person Number${String.fromCharCode(65 + i)}`, open_to_dates: true, extras: PROFILE }), newUserCookie());
    const r = (await call("swipe_deck", { character_id: me.id, only: "live_agents", limit: 3 }, me.ctx)).structuredContent;
    expect(r.cards.map((c: Any) => c.id)).toContain(live.id);
    expect(r.filtered_out).toBeGreaterThanOrEqual(10);
  });
});

describe("a see_again before the last line", () => {
  it("is kept, and the reply says it wasn't the last line", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    const r = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: "Well, hello there, fellow map person.", see_again: true } }, ctx)).structuredContent;
    expect(r.wish_kept).toMatchObject({ see_again: true, last_line: false, counts: expect.stringMatching(/isn't .*last line/) });
  });
});
