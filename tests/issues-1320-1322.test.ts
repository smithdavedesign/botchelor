import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// From the 2026-11-04-0610 run: a house-run bot's character is never "their agent" (#1320), a place dealt as a library set
// says so and that a named place wins over the last-two rule, and an accept_move that moved nothing says why (#1322).
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
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(client = "issues-1320-1322-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
async function make(ctx: McpContext, name: string, extra: Record<string, unknown> = {}) {
  const made = await call("create_character", validCharacter({ name, keep_name: true, open_to_dates: true, ...extra }), ctx);
  if (made.isError) throw new Error(made.content[0].text);
  return { ctx, agentId: made.structuredContent.agent_id as string, id: made.structuredContent.character.id as string };
}
const agent = async (name: string, client?: string) => make(await connect(client), name);
/** A house-run bot: its session's client is one of the show's own scripts (lib/house-bots.ts). */
const bot = (name: string) => agent(name, "botchelor-loop-crowd");
async function agreed(a: { ctx: McpContext; id: string }, b: { ctx: McpContext; id: string }) {
  await call("swipe", { character_id: a.id, target_id: b.id, like: true }, a.ctx);
  await call("swipe", { character_id: b.id, target_id: a.id, like: true }, b.ctx);
  await call("answer_match", { character_id: a.id, with: b.id, yes: true }, a.ctx);
  await call("answer_match", { character_id: b.id, with: a.id, yes: true }, b.ctx);
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me something true about the tide, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });

describe("#1320: a house-run bot's character is never 'their agent'", () => {
  it("a date you start with a bot's character: heads_up says the show's script plays it", async () => {
    const me = await agent("Ottoline Brackwater");
    const odile = await bot("Odile Brannock");
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: me.id, partner_id: odile.id }, me.ctx)).structuredContent;
    expect(started.episode_id).toBeTruthy();
    const status = (await call("my_status", {}, me.ctx)).structuredContent;
    const h = status.heads_up.find((x: Any) => x.episode_id === started.episode_id);
    expect(h).toMatchObject({ kind: "own_date_your_move", played_by: "house_bot", your_move: true });
    expect(h.what).toMatch(/^Your two-agent date with Odile Brannock waits on you \(free: you perform Ottoline, the show's script plays Odile \(a house-run bot's character, not another agent\); turn 1 of \d+\)\. It's your move/);
    expect(h.what).not.toMatch(/their agent/);
    const own = (await call("my_own_dates", {}, me.ctx)).structuredContent.dates.find((d: Any) => d.episode_id === started.episode_id);
    expect(own).toMatchObject({ partner_bot: true, partner_note: expect.stringMatching(/^Odile is a house-run bot's character/) });
    expect(own.partner_last_seen_minutes).toBeUndefined();
  });

  it("a bot that asks your character out: the invite, heads_up and the waiting step all say it's the show's script", async () => {
    const odile = await bot("Odile Brannock");
    const me = await agent("Ottoline Brackwater");
    await agreed(odile, me);
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: odile.id, partner_id: me.id }, odile.ctx)).structuredContent.step.episode_id as string;
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, odile.ctx);
    const invite = (await t.db.query<{ body: string }>(`select body from notifications where user_id = $1 and kind = 'own_date_invite'`, [me.agentId])).rows[0];
    expect(invite.body).toMatch(/^Two-agent date \S+, started by Odile, a house-run bot's character \(one of the show's own scripts, not another agent\): its lines come on their own\. Ottoline: you perform/);
    expect(invite.body).not.toMatch(/their agent/);
    const h = (await call("my_status", {}, me.ctx)).structuredContent.heads_up.find((x: Any) => x.episode_id === id);
    expect(h).toMatchObject({ kind: "own_date_started", started_by: "Odile Brannock (a house-run bot's character)", played_by: "house_bot" });
    expect(h.what).toMatch(/^Odile Brannock, a house-run bot's character, started a two-agent date with your Ottoline Brackwater \(free: you perform Ottoline, the show's script plays Odile/);
    // Your line in, it's the bot's: the wait names it as one, and doesn't offer to play both sides (the bot started it).
    await call("submit_own_date_step", { episode_id: id, output: line(2) }, me.ctx);
    const step = (await call("get_own_date_step", { episode_id: id }, me.ctx)).structuredContent;
    const wait = step.step ?? step;
    expect(wait).toMatchObject({ stage: "waiting", played_by: "house_bot", started_by_bot: true });
    expect(wait.instructions).toMatch(/^Odile Brannock's move \(a house-run bot plays it automatically, quiet \d+ min\)\. get_own_date_step with wait_seconds waits for yours\. If it stays quiet 3 minutes, the show's model takes over Odile Brannock's side on its own\.$/);
    const full = (await call("get_own_date_step", { episode_id: id, compact: false }, me.ctx)).structuredContent;
    expect((full.step ?? full).instructions).toMatch(/^Odile Brannock is a house-run bot's character \(one of the show's own scripts, not another agent\): its turn comes automatically/);
    expect((full.step ?? full).instructions).not.toMatch(/side: "both"/);
  });

  it("another agent's character still reads as their agent", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    await agreed(a, b);
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: a.id, partner_id: b.id }, a.ctx)).structuredContent;
    const h = (await call("my_status", {}, a.ctx)).structuredContent.heads_up.find((x: Any) => x.episode_id === started.episode_id);
    expect(h.what).toMatch(/their agent performs Bo/);
    expect(h.played_by).toBeUndefined();
  });
});

describe("#1322: a place and a move say what became of them", () => {
  it("free words dealt as a library set name the set, and say a named place wins over the last-two rule", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    const c = await agent("Cy Marsh");
    const first = (await call("start_own_date", { character_id: a.id, partner_id: b.id, format: "speed_date", place: "the pier" }, a.ctx)).structuredContent;
    expect(first.place_used).toBe("mapped");
    const preview = (await call("start_own_date", { character_id: a.id, partner_id: c.id, format: "speed_date", place: "a harbour wall at low tide", preview: true }, a.ctx)).structuredContent;
    expect(preview.venue_note).toBe(
      `Where you said (place): "a harbour wall at low tide" is dealt as The pier at night, the closest set the show has. A place you name wins over the show's rule of avoiding either one's last two venues.`,
    );
    const again = (await call("start_own_date", { character_id: a.id, partner_id: c.id, format: "speed_date", place: "a harbour wall at low tide" }, a.ctx)).structuredContent;
    expect(again).toMatchObject({
      place_used: "mapped",
      place_note:
        `Your place "a harbour wall at low tide" is dealt as The pier at night: the closest set the show has (a place it has no set for keeps your words). ` +
        `That's the set of one of their last two dates: a place you name wins over the show's rule of dealing somewhere new.`,
    });
    // With no place, the preview says a place you name can be one of those two.
    const d = await agent("Di Fenwick");
    const dealt = (await call("start_own_date", { character_id: a.id, partner_id: d.id, format: "speed_date", preview: true }, a.ctx)).structuredContent;
    expect(dealt.venue_note).toMatch(/sets it instead, even one of those two: a place you name wins over that rule\.$/);
  });

  it("accept_move with nothing to accept says so: no suggestion pending, or a date with no moves", async () => {
    const ctx = await connect();
    const a = await make(ctx, "Ada Lumen");
    const b = await make(ctx, "Bo Quill");
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a.id, partner_id: b.id }, ctx)).structuredContent.step.episode_id as string;
    const r = (await call("submit_own_date_step", { episode_id: id, output: line(1, { accept_move: true }) }, ctx)).structuredContent;
    expect(r.accepted).toBe(true);
    expect(r.move_ignored).toMatch(/^accept_move did nothing: there was no suggestion to answer \(Bo's last line proposed no move the show took: a move counts only with "move" set and the place said in that line\), so the date stays at .+\. To go somewhere, suggest it yourself/);
    // false (stay) with nothing pending is no news.
    const stay = (await call("submit_own_date_step", { episode_id: id, output: line(2, { accept_move: false }) }, ctx)).structuredContent;
    expect(stay.move_ignored).toBeUndefined();

    const c = await make(ctx, "Cy Marsh");
    const quick = (await call("start_own_date", { character_id: a.id, partner_id: c.id, format: "speed_date" }, ctx)).structuredContent.step.episode_id as string;
    const s = (await call("submit_own_date_step", { episode_id: quick, output: line(1, { accept_move: true }) }, ctx)).structuredContent;
    expect(s.move_ignored).toMatch(/^accept_move did nothing: this date doesn't change places \(it has no moves\), so it stays at .+\.$/);
  });
});
