import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pronounWarnings } from "@/lib/character";
import { handleMcpMessage, normaliseArgs, type McpContext } from "@/lib/mcp";
import { pairKey } from "@/lib/relationships";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The agent-feedback backlog from the 5-run visitor loop (#194, #214–#226).
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
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-backlog-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const c = (await call("create_character", validCharacter({ name, ...extra }), ctx)).structuredContent;
  return { ctx, agentId: c.agent_id as string, id: c.character.id as string, created: c };
}

async function showDate(ctx: McpContext, id: string, extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  return (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, ...extra }, ctx)).structuredContent;
}

describe("own dates (#214, #223, #225)", () => {
  it("start_own_date says how long it runs; the turn steps are compact unless asked otherwise", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: id, partner_id: b }, ctx)).structuredContent;
    expect(started.how_long).toMatch(/lines, then the recap/);
    const line = { dialogue: "So what's the strangest map you've drawn?", action: "", emotion: "curious", interest_signal: 0.6 };
    const next = (await call("submit_own_date_step", { episode_id: started.step.episode_id, output: line }, ctx)).structuredContent.step;
    expect(next.messages.some((m: Any) => m.role === "system")).toBe(false);
    const full = (await call("get_own_date_step", { episode_id: started.step.episode_id, compact: false }, ctx)).structuredContent.step;
    expect(full.messages[0].role).toBe("system");
  });

  it("an own-date tool without episode_id uses the agent's only open own date, and says so", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: id, partner_id: b }, ctx)).structuredContent;
    const r = (await call("get_own_date_step", {}, ctx)).structuredContent;
    expect(r.step.episode_id).toBe(started.step.episode_id);
    expect(JSON.stringify(r.read_arguments_as)).toMatch(/episode_id/);
  });

  it("a house partner gets a clear refusal pointing to go_on_date, not 'not found'", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = await call("start_own_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/house characters.*go_on_date/s);
  });
});

describe("dates on the show's model (#215, #217, #224)", () => {
  it("go_on_date says what it spent and what's left", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = await showDate(ctx, id);
    expect(r.spent).toMatch(/one date/);
    expect(r.dates_left).toMatchObject({ total: expect.any(Number) });
  });

  it("my_status lists the agent's dates still to air (#216)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await showDate(ctx, id)).episode;
    await t.db.query(`update episodes set revealed_at = null, status = 'ready' where id = $1`, [ep.id]);
    const status = (await call("my_status", {}, ctx)).structuredContent;
    expect(status.airing_soon?.map((d: Any) => d.episode_id ?? d.id)).toContain(ep.id);
  });

  it("the creator can't guess the dealbreaker on its own date", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await showDate(ctx, id)).episode;
    const r = await call("guess_dealbreaker", { episode_id: ep.id, guess: "lateness" }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/already know/);
  });

  it("set_date_visibility turns a private date public", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await showDate(ctx, id, { visibility: "private" })).episode;
    const r = await call("set_date_visibility", { episode_id: ep.id, visibility: "public" }, ctx);
    expect(r.isError).toBeUndefined();
    expect((await t.db.query<Any>(`select visibility from episodes where id = $1`, [ep.id])).rows[0].visibility).toBe("public");
    const other = await connect();
    expect((await call("set_date_visibility", { episode_id: ep.id, visibility: "private" }, other)).isError).toBe(true);
  });
});

describe("texting (#219, #223, #226)", () => {
  it("wait_for_text returns their next text, marks it read, and says still_waiting when none comes", async () => {
    const a = await agentWith("Ada Lumen");
    const b = await agentWith("Bo Quill");
    const none = (await call("wait_for_text", { character_id: a.id, with: b.id, timeout_seconds: 1 }, a.ctx)).structuredContent;
    expect(none).toMatchObject({ texts: [], still_waiting: true });
    const [lo, hi] = pairKey(a.id, b.id);
    const bSide = b.id === lo ? "lo" : "hi";
    await t.db.query(
      `insert into couple_texts (character_lo, character_hi, day, seq, who, text, via) values ($1, $2, current_date, 1, $3, 'Still thinking about the maps.', 'agent')`,
      [lo, hi, bSide],
    );
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'Bo texted', $2)`, [
      a.agentId,
      `/couples/${lo}/${hi}#texts`,
    ]);
    const got = (await call("wait_for_text", { character_id: a.id, with: b.id, after: none.after, timeout_seconds: 1 }, a.ctx)).structuredContent;
    expect(got.texts.map((x: Any) => x.text)).toEqual(["Still thinking about the maps."]);
    expect((await t.db.query<Any>(`select read_at from notifications where user_id = $1 and kind = 'texted'`, [a.agentId])).rows[0].read_at).not.toBeNull();
  });

  it("the usual words for a tool's text are read as its own", () => {
    expect(normaliseArgs("reflect_on_date", { text: "x" }).args).toEqual({ reflection: "x" });
    expect(normaliseArgs("send_text", { message: "hi" }).args).toEqual({ text: "hi" });
    expect(normaliseArgs("send_feedback", { feedback: "ok" }).args).toEqual({ message: "ok" });
  });
});

describe("pronouns that disagree with the sheet (#194)", () => {
  it("warns, never refuses", async () => {
    const { ctx, id, created } = await agentWith("Ada Lumen", { pronouns: "they/them", voice: "He talks fast and laughs at his own jokes." });
    expect(created.warnings?.[0]).toMatch(/voice uses he\/him pronouns.*they\/them/);
    const fixed = (await call("update_character", { character_id: id, voice: "Talks fast, laughs at their own jokes." }, ctx)).structuredContent;
    expect(fixed.warnings).toBeUndefined();
  });

  it("text that also uses the character's own pronouns is left alone", () => {
    expect(pronounWarnings({ pronouns: "he/him", bio: "He still texts her ex." })).toEqual([]);
    expect(pronounWarnings({ pronouns: "she/her", voice: "He mumbles." })).toHaveLength(1);
    expect(pronounWarnings({ voice: "He mumbles." })).toEqual([]);
  });
});
