import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { llmsFullText } from "@/lib/agents-full";
import { llmsText } from "@/lib/agents";
import { airEpisode } from "@/lib/air";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { EXCLUSIVE_SOON } from "@/lib/mcp/constants";
import { BOOKED_ENDING_NOTE, ENDING_RULE, normaliseArgs, otherCharacterAlias, OWN_ENDING_NOTE } from "@/lib/mcp/dispatcher";
import { MCP_RESOURCES } from "@/lib/mcp/resources";
import { resetSubscriptionsForTests, SUBSCRIBABLE } from "@/lib/mcp-subscriptions";
import { notify } from "@/lib/notifications";
import { conceptTerms, type SheetDraft, termWeights, twinWhy } from "@/lib/originality";
import { warnWhenSparksOut } from "@/lib/partners";
import { refreshAndAnnounce } from "@/lib/relationship-events";
import { stageOf } from "@/lib/relationships";
import { ENDING_LABELS } from "@/lib/rules";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.9.0, from the 2026-10-22-0610 run (the launchd morning run: two uninstructed visitors on 2.8.0, 8 and 8 overall; MCP
// 8.5 and 8). Run folder: ~/.botchelor-loop/runs/2026-10-22-0610. Two regressions (2.8.0's stale your_move wakes, 2.7.0's
// exclusive_soon ahead of the airing), #654 the advertised resources, #632's comment (a finished own date's result), one set of
// names for the other character, #655 the near-twin the look-alike check missed, and the ending said before booking.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetSubscriptionsForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const HOUSE = HOUSE_CHARACTERS[0];
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(client = "botchelor-run-0610-test"): Promise<McpContext & { init: Any }> {
  const ctx: McpContext = {};
  const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx)).result;
  return { sessionId: ctx.issuedSessionId, init };
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
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string };
}
type Agent = Awaited<ReturnType<typeof agentWith>>;
/** Two agents' characters that matched and both said yes to a date. */
async function agreed(a = "Ottoline Prewitt", b = "Hestia Moonwhistle") {
  const A = await agentWith(a);
  const B = await agentWith(b);
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
  await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
  return { A, B };
}
/** A date with one of the house cast on the show's model, written inline (the test harness). */
async function houseDate(ctx: McpContext, characterId: string, ending: "second_date" | "friends" | "disaster" = "friends", extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending });
  scriptedModel([episodeJson(), episodeJson()]);
  const r = await call("go_on_date", { character_id: characterId, partner_id: HOUSE.id, ...extra }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent;
}
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the sea, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });
const later = (ms: number, fn: () => Promise<unknown>) => new Promise<void>((resolve, reject) => setTimeout(() => void fn().then(() => resolve(), reject), ms));
/** A starts a two-agent date with B's character and plays the first line: B's move. */
async function startsAndPlays(A: Agent, B: Agent, extra: Record<string, unknown> = {}): Promise<string> {
  const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, ...extra }, A.ctx)).structuredContent.step.episode_id as string;
  await call("submit_own_date_step", { episode_id: id, output: line(1) }, A.ctx);
  return id;
}
const cursorOf = async (B: Agent): Promise<string> => (await call("my_status", {}, B.ctx)).structuredContent.cursor;
const pair = (x: string, y: string) => [x, y].sort() as [string, string];

it("is MCP 2.9.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.9.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("1. your_move only when it's yours (2.8.0's yourMoveWake fired on stale notices)", () => {
  it("reproduces run 0610: after a two-agent date finishes, a my_status since from before it waits instead of saying your_move; the other agent's wake is its finished date (new), not a move", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const [sinceA, sinceB] = [await cursorOf(A), await cursorOf(B)];
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    for (let i = 0; i < 6; i++) await call("submit_own_date_step", { episode_id: id, output: line(i) }, (i % 2 === 0 ? A : B).ctx);
    expect((await t.db.query<Any>(`select status from episodes where id = $1`, [id])).rows[0].status).toBe("ready");
    // B's turn notices were written and then read as B played: newer than since, but history now.
    expect((await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = $1 and kind = 'own_date_turn' and read_at > created_at`, [B.agentId])).rows[0].n).toBeGreaterThan(0);
    const t0 = Date.now();
    const b = (await call("my_status", { since: sinceB, wait_seconds: 3 }, B.ctx)).structuredContent;
    expect(b.returned_because).toBe("timeout");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2500);
    expect(b.new_since).toEqual([]);
    expect(b.heads_up).toBeUndefined();
    // B's last line finished it, so A heard it's done: that's real news (new), and the turn notices aren't in it.
    const a = (await call("my_status", { since: sinceA, wait_seconds: 3 }, A.ctx)).structuredContent;
    expect(a).toMatchObject({ returned_because: "new", woke_for: ["own_date_done"] });
    expect(a.new_since.map((i: Any) => i.kind)).toEqual(["own_date_ready"]);
  });

  it("an invite already played doesn't wake a wait, even with its notice unread again", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = await startsAndPlays(A, B);
    await call("submit_own_date_step", { episode_id: id, output: line(2) }, B.ctx);
    // A's move now. B's invite, unread again and never shown (as a notice that raced the line would be), isn't a move.
    await t.db.query(`update notifications set read_at = null, heads_up_at = null where user_id = $1 and kind = 'own_date_invite'`, [B.agentId]);
    const t0 = Date.now();
    const r = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 3 }, B.ctx)).structuredContent;
    expect(r.returned_because).toBe("timeout");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2500);
    expect(r.heads_up).toBeUndefined();
  });

  it("an invite already answered (called off) doesn't wake a wait", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    expect((await call("decline_own_date", { episode_id: id }, B.ctx)).structuredContent.declined).toBe(true);
    await t.db.query(`update notifications set read_at = null, heads_up_at = null where user_id = $1 and kind = 'own_date_invite'`, [B.agentId]);
    const r = (await call("get_episode", { episode_id: (await houseDate(B.ctx, B.id)).episode.id, wait_seconds: 3 }, B.ctx)).structuredContent;
    expect(r.returned_because).not.toBe("your_move");
    const w = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 2 }, B.ctx)).structuredContent;
    expect(w.returned_because).toBe("timeout");
  });

  it("a date both said yes to that's been booked since doesn't wake a wait, even when its notice lands late; my_status (since) doesn't call it news", async () => {
    const { A, B } = await agreed();
    // B books it (the show plays it): the pair has a date now.
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const booked = await call("go_on_date", { character_id: B.id, partner_id: A.id }, B.ctx);
    expect(booked.isError).toBeUndefined();
    const since = await cursorOf(B);
    const [lo, hi] = pair(A.id, B.id);
    // A date_agreed that raced the booking lands during the wait.
    const late = later(500, () => notify(t.db, B.agentId, { kind: "date_agreed", title: "📅 Ottoline Prewitt and Hestia Moonwhistle want to go on a date", body: "Book it with go_on_date.", link: `/messages/${lo}/${hi}` }));
    const t0 = Date.now();
    const r = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 3 }, B.ctx)).structuredContent;
    await late;
    expect(r.returned_because).toBe("timeout");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2500);
    const s = (await call("my_status", { since, wait_seconds: 2 }, B.ctx)).structuredContent;
    expect(s.returned_because).toBe("timeout");
    expect(s.new_since).toEqual([]);
    // A date agreed with nothing booked yet is still a move, and still wakes (the control).
    const C = await agentWith("Cassia Wren");
    await call("swipe", { character_id: C.id, target_id: B.id, like: true }, C.ctx);
    await call("swipe", { character_id: B.id, target_id: C.id, like: true }, B.ctx);
    await call("answer_match", { character_id: B.id, with: C.id, yes: true }, B.ctx);
    const yes = later(500, () => call("answer_match", { character_id: C.id, with: B.id, yes: true }, C.ctx));
    const woke = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 6 }, B.ctx)).structuredContent;
    await yes;
    expect(woke).toMatchObject({ returned_because: "your_move", woke_for: ["date_agreed"] });
    expect(woke.heads_up[0]).toMatchObject({ kind: "date_agreed", character_id: B.id, with: C.id });
  });

  it("a 'your move' notice still unread but no longer pending doesn't make my_status your_move, nor end its wait", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const since = await cursorOf(B);
    const id = await startsAndPlays(A, B);
    await call("submit_own_date_step", { episode_id: id, output: line(2) }, B.ctx);
    // B moved; its turn and invite notices, unread again (a sweep not run yet): newer than since, but nothing waits on B.
    await t.db.query(`update notifications set read_at = null where user_id = $1 and kind in ('own_date_turn', 'own_date_invite')`, [B.agentId]);
    const s = (await call("my_status", { since, wait_seconds: 2 }, B.ctx)).structuredContent;
    expect(s.returned_because).toBe("timeout");
    expect(s.new_since).toEqual([]);
    expect(s.your_move_note).toBeUndefined();
  });

  it("my_notifications: a stale move notice neither ends the wait nor reads as your_move", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = await startsAndPlays(A, B);
    await call("submit_own_date_step", { episode_id: id, output: line(2) }, B.ctx);
    const late = later(500, () => notify(t.db, B.agentId, { kind: "own_date_turn", title: "🎭 Your move", body: `Two-agent date ${id}: the other side has moved.`, link: null }));
    const t0 = Date.now();
    const r = (await call("my_notifications", { wait_seconds: 3 }, B.ctx)).structuredContent;
    await late;
    expect(r.returned_because).toBe("timeout");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2500);
    expect(r.new).toEqual([]);
  });

  it("the real thing still wakes every wait at once, heads_up first: your move on a live date (the control)", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const since = await cursorOf(B);
    const started = later(500, () => startsAndPlays(A, B));
    const s = (await call("my_status", { since, wait_seconds: 8 }, B.ctx)).structuredContent;
    await started;
    expect(s.returned_because).toBe("your_move");
    expect(s.heads_up[0]).toMatchObject({ your_move: true, character_id: B.id });
  });

  it("read_texts with with: their text you hadn't read comes back in items, whatever the cursor, and says so (#620: '[] right after Odalys had texted')", async () => {
    const { A, B } = await agreed();
    await call("send_text", { character_id: A.id, to: B.id, text: "Bring a barometer and an opinion about knots." }, A.ctx);
    const [lo, hi] = pair(A.id, B.id);
    const at = (await t.db.query<{ at: Date }>(`select created_at as at from couple_texts where character_lo = $1 and character_hi = $2`, [lo, hi])).rows[0].at;
    // A cursor past the text (my_status's, a moment later): the text came before it, but B never read it.
    const after = new Date(new Date(at).getTime() + 1000).toISOString();
    const r = (await call("read_texts", { character_id: B.id, with: A.id, after, wait_seconds: 5 }, B.ctx)).structuredContent;
    expect(r.returned_because).toBe("at_start");
    expect(r.items.map((i: Any) => i.text)).toEqual(["Bring a barometer and an opinion about knots."]);
    expect(r.unread_note).toMatch(/hadn't read yet are in items too, though they're older than your cursor/);
    // Read now: the next wait from that cursor waits.
    const again = (await call("read_texts", { character_id: B.id, with: A.id, after, wait_seconds: 2 }, B.ctx)).structuredContent;
    expect(again).toMatchObject({ returned_because: "timeout", items: [] });
  });

  it("read_texts with with: a wake returns the thread and says why; a text that comes in during the wait is in items", async () => {
    const { A, B } = await agreed();
    await call("send_text", { character_id: A.id, to: B.id, text: "Ten past slack water, the east jetty?" }, A.ctx);
    await call("read_texts", { character_id: B.id, with: A.id }, B.ctx);
    scriptOutcome({ ending: "friends" });
    const started = later(500, () => startsAndPlays(A, B));
    const r = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 8 }, B.ctx)).structuredContent;
    await started;
    expect(Object.keys(r)[0]).toBe("heads_up");
    expect(r).toMatchObject({ returned_because: "your_move", items: [], still_waiting: true });
    expect(r.items_note).toMatch(/^Nothing new from them yet; this wait returned because something needs you now \(heads_up\)/);
    expect(r.thread.map((x: Any) => x.text)).toEqual(["Ten past slack water, the east jetty?"]);
    // A text during a wait: items has it.
    const C = await agentWith("Cassia Wren");
    await call("swipe", { character_id: C.id, target_id: B.id, like: true }, C.ctx);
    await call("swipe", { character_id: B.id, target_id: C.id, like: true }, B.ctx);
    const texted = later(500, () => call("send_text", { character_id: C.id, to: B.id, text: "Is the glass falling where you are?" }, C.ctx));
    const got = (await call("read_texts", { character_id: B.id, with: C.id, wait_seconds: 8 }, B.ctx)).structuredContent;
    await texted;
    expect(got.items.map((i: Any) => i.text)).toEqual(["Is the glass falling where you are?"]);
    expect(got.returned_because).toBe("new");
  });
});

describe("2. exclusive_soon when the date that makes it true airs, once", () => {
  const count = async (agentId: string) => (await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = $1 and kind = 'exclusive_soon'`, [agentId])).rows[0].n;

  it("reproduces run 0610: written, nothing (2.7.0 warned here, before the airing); aired, one warning, leading that call's reply; never again", async () => {
    const A = await agentWith("Thaddeus Quillfeather", { partner_style: "one" });
    const booked = await houseDate(A.ctx, A.id, "second_date");
    expect((booked.heads_up ?? []).some((h: Any) => h.kind === "exclusive_soon")).toBe(false);
    expect(await count(A.agentId)).toBe(0);
    const before = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(before.exclusive_soon).toBeUndefined();
    expect((before.heads_up ?? []).some((h: Any) => h.kind === "exclusive_soon")).toBe(false);
    // It airs: the warning goes out, and leads the next reply.
    await airEpisode(t.db, booked.episode.id, A.agentId);
    expect(await count(A.agentId)).toBe(1);
    const next = (await call("my_dates", {}, A.ctx)).structuredContent;
    expect(next.heads_up[0]).toMatchObject({ kind: "exclusive_soon", character_id: A.id, what: `⏳ Thaddeus is one date from going exclusive with ${HOUSE.name}` });
    expect((await call("my_status", {}, A.ctx)).structuredContent.exclusive_soon).toEqual([expect.objectContaining({ character_id: A.id, with: expect.objectContaining({ id: HOUSE.id }) })]);
    // The marker holds the date it went out for, so another pass (any airing path, a refresh) never sends it again.
    expect((await t.db.query<Any>(`select exclusive_warned_for from relationships`)).rows[0].exclusive_warned_for).toBe(booked.episode.id);
    await refreshAndAnnounce(t.db, A.id, HOUSE.id, { episodeId: booked.episode.id });
    expect(await warnWhenSparksOut(t.db, A.id, HOUSE.id)).toBe(0);
    expect(await count(A.agentId)).toBe(1);
  });

  it("a private date never airs: its warning goes out when it's written, once", async () => {
    const A = await agentWith("Thaddeus Quillfeather", { partner_style: "one" });
    const booked = await houseDate(A.ctx, A.id, "second_date", { visibility: "private" });
    expect(await count(A.agentId)).toBe(1);
    expect(booked.heads_up).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "exclusive_soon", character_id: A.id })]));
    expect(await warnWhenSparksOut(t.db, A.id, HOUSE.id)).toBe(0);
    expect(await count(A.agentId)).toBe(1);
  });

  it("a warning 2.8.0 already sent when the date was written isn't sent again when it airs", async () => {
    const A = await agentWith("Thaddeus Quillfeather", { partner_style: "one" });
    const booked = await houseDate(A.ctx, A.id, "second_date");
    await notify(t.db, A.agentId, { kind: "exclusive_soon", title: `⏳ Thaddeus is one date from going exclusive with ${HOUSE.name}`, body: "Sparks.", link: `/characters/${A.id}` });
    await airEpisode(t.db, booked.episode.id, A.agentId);
    expect(await count(A.agentId)).toBe(1);
  });

  it("get_relationships says when the stage counts a date that hasn't aired: which one, when it airs, and the stage on aired dates alone", async () => {
    const A = await agentWith("Odalys Oyelaran", { partner_style: "open" });
    const first = await houseDate(A.ctx, A.id, "second_date");
    await airEpisode(t.db, first.episode.id, A.agentId);
    const second = await houseDate(A.ctx, A.id, "second_date");
    const secondId = second.episode?.id ?? second.second_date_of;
    expect(secondId).toBeTruthy();
    const unaired = (await t.db.query<{ id: string }>(`select id from episodes where creator_id = $1 and revealed_at is null`, [A.agentId])).rows[0].id;
    const rel = (await call("get_relationships", { character_id: A.id, with: HOUSE.id }, A.ctx)).structuredContent.relationships[0];
    expect(rel.stage).toBe("dating");
    expect(rel.stage_on_aired_dates).toBe("✨ Sparks");
    expect(rel.stage_note).toMatch(new RegExp(`^Dating counts their 2nd date \\(${unaired}\\), which airs (at|once it's finished, no sooner than) \\d{4}-\\d\\d-\\d\\dT[^;]+; on aired dates alone, they're Sparks\\.$`));
    // Everyone else sees only the aired one.
    const C = await agentWith("Cassia Wren");
    const theirs = (await call("get_relationships", { character_id: A.id, with: HOUSE.id }, C.ctx)).structuredContent.relationships[0];
    expect(theirs.stage).toBe("sparks");
    expect(theirs.stage_note).toBeUndefined();
  });

  it("the wording matches the rule (lib/relationships.ts stageOf): Sparks is one second date, Dating two in a row; 'one great date can be enough' was off by one", () => {
    expect(stageOf(["second_date"])).toBe("sparks");
    expect(stageOf(["second_date", "second_date"])).toBe("dating");
    const style = (MCP_TOOLS.find((x) => x.name === "create_character")!.inputSchema as Any).properties.partner_style.description;
    expect(style).toMatch(/one: once it's in a Dating couple \(two second dates in a row\) it closes to other dates/);
    for (const text of [style, llmsText(), llmsFullText()]) expect(text).not.toMatch(/one great date/);
    expect(EXCLUSIVE_SOON).toMatch(/these are Sparks with someone, so one more date that ends in a second date makes a Dating couple/);
  });
});

describe("3. #654: every resource initialize advertises is listed and readable", () => {
  it("both subscribable resources are in resources/list, and every listed resource reads", async () => {
    const ctx = await connect();
    expect(ctx.init._meta["botchelor/subscribable_resources"]).toEqual([...SUBSCRIBABLE]);
    const listed = (await rpc("resources/list", {}, ctx)).result.resources;
    for (const uri of SUBSCRIBABLE) expect(listed.map((r: Any) => r.uri)).toContain(uri);
    for (const r of MCP_RESOURCES) {
      const got = (await rpc("resources/read", { uri: r.uri }, ctx)).result;
      expect({ uri: r.uri, ok: Boolean(got?.contents?.[0]?.text) }).toEqual({ uri: r.uri, ok: true });
      expect(got.contents[0].mimeType).toBe(r.mimeType);
    }
    expect((await rpc("resources/read", { uri: "botchelor://docs/llms-full" }, ctx)).result.contents[0].text).toBe(llmsFullText());
  });

  it("feed/airing: a public date about to air is in next without its ending; once it airs it's in just_aired with it, and subscribers hear", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "second_date");
    const read = async () => JSON.parse((await rpc("resources/read", { uri: "botchelor://feed/airing" })).result.contents[0].text);
    const before = await read();
    const entry = before.next.find((e: Any) => e.episode_id === booked.episode.id);
    expect(entry).toMatchObject({ characters: [expect.objectContaining({ id: A.id }), expect.objectContaining({ id: HOUSE.id })], airs_at: expect.any(String), share_path: `/episodes/${booked.episode.id}` });
    expect(entry.ending).toBeUndefined();
    expect(JSON.stringify(before.next)).not.toMatch(/second_date/);
    expect(before.note).toMatch(/predictions on each close when it airs/);
    const ctx = await connect();
    await rpc("resources/subscribe", { uri: "botchelor://feed/airing" }, ctx);
    await airEpisode(t.db, booked.episode.id, A.agentId);
    const after = await read();
    expect(after.next.some((e: Any) => e.episode_id === booked.episode.id)).toBe(false);
    expect(after.just_aired[0]).toMatchObject({ episode_id: booked.episode.id, ending: "second_date", ending_label: ENDING_LABELS.second_date });
    // The next reply on that session carries the update (no stream open here).
    expect((await call("my_status", {}, ctx))._meta["botchelor/pending_updates"]).toEqual(["botchelor://feed/airing"]);
  });
});

describe("4. #632's comment: a finished own date returns its result (main's #659) and the calls that fit next", () => {
  async function ownPair() {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    return { ctx, a, b };
  }

  it("get_own_date_step on a done date: the ending, box score, why, how it opened and closed, the share path, then next_calls: get_episode, sliding_doors, plan_second_date as a preview", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "second_date" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, outputs: [line(0), line(1), line(2), line(3), line(4), line(5)] }, ctx);
    expect((await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx)).structuredContent.stage).toBe("done");
    const got = (await call("get_own_date_step", { episode_id: id }, ctx)).structuredContent;
    expect(got.stage).toBe("done");
    expect(got.summary).toMatch(/^Done: Ada Lumen and Bo Quill's date ended: A second date \(second_date\)\. result: why, the box score's final numbers and the best line/);
    const keys = Object.keys(got);
    expect(keys.indexOf("result")).toBe(keys.indexOf("summary") + 1);
    // 2.10.0 (the 2026-10-22-0800 run): how the see_again wishes counted sits beside the result, then the calls.
    expect(keys.indexOf("wishes")).toBe(keys.indexOf("result") + 1);
    expect(keys.indexOf("next_calls")).toBe(keys.indexOf("wishes") + 1);
    expect(got.result).toMatchObject({ ending: "second_date", share_path: `/episodes/${id}`, lines_in_all: 6 });
    expect(got.result.box_score).toEqual({ chemistry: 60, attraction: 55, trust: 50, awkwardness: 30 });
    expect(got.result.why).toMatch(/^A second date: /);
    expect(got.result.highlights).toHaveLength(4);
    expect(got.next_calls.map((c: Any) => c.tool)).toEqual(["get_episode", "sliding_doors", "plan_second_date", "reflect_on_date", "reflect_on_date"]);
    expect(got.next_calls[2].args).toEqual({ episode_id: id, preview: true });
    // Scored and explained the same way as a date the show writes: what get_episode's summary says.
    const ep = (await call("get_episode", { episode_id: id, summary: true }, ctx)).structuredContent.episode;
    expect(got.result.why).toBe(ep.why);
    expect(got.result.box_score).toEqual(ep.box_score);
    // The sliding_doors it suggests works for the one who set it up.
    expect((await call("sliding_doors", got.next_calls[1].args, ctx)).isError).toBeUndefined();
  });

  it("on a two-agent date both agents get the result; sliding_doors is offered to the agent that set it up only", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    for (let i = 0; i < 6; i++) await call("submit_own_date_step", { episode_id: id, output: line(i) }, (i % 2 === 0 ? A : B).ctx);
    const theirs = (await call("get_own_date_step", { episode_id: id }, B.ctx)).structuredContent;
    expect(theirs.result).toMatchObject({ ending: "friends" });
    expect(theirs.next_calls.map((c: Any) => c.tool)).not.toContain("sliding_doors");
    expect(theirs.next_calls.map((c: Any) => c.tool)).not.toContain("plan_second_date");
    const mine = (await call("get_own_date_step", { episode_id: id }, A.ctx)).structuredContent;
    expect(mine.next_calls.map((c: Any) => c.tool)).toContain("sliding_doors");
  });

  it("autoplay's finished date (already a summary) reads as its own result, box score and all", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    const turn = (i: number) => JSON.stringify({ dialogue: `Autoplayed line ${i} about the tide tables and the ferry.`, action: "", emotion: "warm", interest_signal: 0.6 });
    scriptedModel([turn(0), turn(1), turn(2), turn(3), turn(4), turn(5), episodeJson()]);
    const played = (await call("autoplay_own_date", { episode_id: id }, ctx)).structuredContent;
    expect(played.stage).toBe("done");
    expect(played.result).toMatchObject({ ending: "friends", why: expect.stringMatching(/^Just friends: /) });
    expect(played.result.box_score).toEqual({ chemistry: 60, attraction: 55, trust: 50, awkwardness: 30 });
  });
});

describe("5. one name for the other character, with a guard against collisions", () => {
  it("follow_couple takes a and b (it said '\"with\" is required'), and says how it read them", async () => {
    const A = await agentWith("Ada Lumen");
    const C = await agentWith("Cassia Wren");
    const none = await call("follow_couple", { a: A.id, b: HOUSE.id }, C.ctx);
    expect(none.content[0].text).not.toMatch(/"with" is required/);
    expect(none.content[0].text).toMatch(/You can follow a couple once one of their public dates has aired/);
    const booked = await houseDate(A.ctx, A.id);
    await airEpisode(t.db, booked.episode.id, A.agentId);
    const ok = (await call("follow_couple", { a: A.id, b: HOUSE.id }, C.ctx)).structuredContent;
    expect(ok.read_arguments_as).toEqual(expect.arrayContaining(["a → character_id", "b → with"]));
    expect(ok.couple).toBeTruthy();
  });

  it("predict takes ending as pick; go_on_date takes partner as partner_id; read_texts and swipe take each other's names", async () => {
    const A = await agentWith("Ada Lumen");
    const C = await agentWith("Cassia Wren");
    const booked = await houseDate(A.ctx, A.id);
    const p = (await call("predict", { episode_id: booked.episode.id, ending: "friends" }, C.ctx)).structuredContent;
    expect(p.prediction).toMatchObject({ pick: "friends" });
    expect(p.read_arguments_as).toContain("ending → pick");
    const preview = (await call("go_on_date", { character_id: A.id, partner: HOUSE.id, preview: true }, A.ctx)).structuredContent;
    expect(preview.with.id).toBe(HOUSE.id);
    expect(preview.read_arguments_as).toContain("partner → partner_id");
    expect(normaliseArgs("read_texts", { character_id: "x", partner_id: "y" })).toEqual({ args: { character_id: "x", with: "y" }, aliased: ["partner_id → with"] });
    expect(normaliseArgs("swipe", { character_id: "x", partner: "y", like: true }).args).toEqual({ character_id: "x", target_id: "y", like: true });
    expect(normaliseArgs("predict_arc", { character_a: "x", character_b: "y", pick: "yes" }).args).toEqual({ character_id: "x", with: "y", pick: "yes" });
  });

  it("the guard: send_text's from is the sender, never the one it texts; a tool with two names for other characters maps neither", async () => {
    const { A, B } = await agreed();
    const sent = (await call("send_text", { from: A.id, to: B.id, text: "Knots at dawn?" }, A.ctx)).structuredContent;
    expect(sent.read_arguments_as).toContain("from → character_id");
    const wrong = await call("send_text", { character_id: A.id, from: B.id, text: "Knots at dawn?" }, A.ctx);
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0].text).toMatch(/"to" is required/);
    expect(otherCharacterAlias(new Set(["character_id", "with", "partner_id"]), { partner: "x" })).toBeNull();
    expect(otherCharacterAlias(new Set(["character_id", "with"]), { partner: "x" })).toEqual({ from: "partner", to: "with" });
    expect(otherCharacterAlias(new Set(["character_id", "to"]), { from: "x" }, new Set(["from"]))).toBeNull();
    expect(otherCharacterAlias(new Set(["character_id", "with"]), { with: "y", partner: "x" })).toBeNull();
  });
});

describe("6. #655: the look-alike check finds a same-hook twin made minutes earlier", () => {
  // The two sheets from the run, as saved (lighthouse, tide tables and barometers, each worded its own way).
  const ODALYS = {
    name: "Odalys Oyelaran", age: 41, bio: "A lighthouse-lamp restorer who narrates her own life in maritime weather warnings.",
    traits: ["dry", "meticulous", "secretly sentimental"], want: "someone who will sit through a whole storm without checking their phone",
    dealbreaker: "people who say they are fine with silence and then fill it", open_to_dates: true, attest: true,
    extras: { hobbies: ["barometer collecting", "tide-table poetry"], prompts: [{ id: "geek_out", answer: "Fresnel lens prisms and how one bulb becomes a beam" }, { id: "simple_pleasures", answer: "Tea going cold because the barometer is more interesting" }] },
  };
  const THADDEUS = {
    name: "Thaddeus Quillfeather", age: 47, bio: "A retired lighthouse-keeper turned municipal tide-table auditor who still narrates his commute in nautical bearings.",
    traits: ["pedantic", "tender", "superstitious"], want: "someone who will argue about knots with him without winning", dealbreaker: "anyone who whistles on a boat", open_to_dates: true, attest: true,
    extras: { hobbies: ["knot tying", "barometer collecting"], prompts: [{ id: "geek_out", answer: "Tide tables and the exact moment slack water turns" }, { id: "simple_pleasures", answer: "Thermos tea on a cold jetty" }] },
  };

  it("reproduces run 0610: Thaddeus, minutes after Odalys, is told about her before and at the save, with the idea they share; the score drops", async () => {
    const one = await connect();
    expect((await call("create_character", ODALYS, one)).isError).toBeUndefined();
    const two = await connect();
    const check = (await call("create_character", { ...THADDEUS, check_only: true }, two)).structuredContent;
    expect(check.look_alikes).toEqual([expect.objectContaining({ name: "Odalys Oyelaran", run_by: "agent" })]);
    expect(check.shared_archetype).toMatchObject({ idea: expect.stringMatching(/tide|lighthouse|narrat|nautical|barometer/), characters: 1 });
    expect(check.warning).toMatch(/reads a lot like Odalys Oyelaran .*Another agent's character made in the last 24 hours shares "[^"]+" with it: agents on one model often invent the same character/);
    const saved = (await call("create_character", THADDEUS, two)).structuredContent;
    expect(saved.originality.similar).toEqual([expect.objectContaining({ name: "Odalys Oyelaran", kind: "concept" })]);
    expect(saved.originality.score).toBeLessThan(70);
    expect(saved.warning).toMatch(/^Saved, but it reads a lot like Odalys Oyelaran/);
  });

  it("the sea trope reads as one concept however it's worded (maritime and nautical, lightkeeper and lighthouse, tidal and tide); the house cast still has no twins", () => {
    const [odalys, thaddeus] = [ODALYS as SheetDraft, THADDEUS as SheetDraft];
    // maritime (Odalys) and nautical (Thaddeus) meet; the profile's barometers and tide tables count as concepts (main's #658).
    expect([...conceptTerms(odalys)]).toEqual(expect.arrayContaining(["nautical", "barometer", "tide table"]));
    expect([...conceptTerms(thaddeus)]).toEqual(expect.arrayContaining(["nautical", "barometer", "tide table"]));
    expect([...conceptTerms({ bio: "A lightkeeper who logs the tidal surge." })]).toEqual(expect.arrayContaining(["lighthouse", "tide"]));
    type Sheet = SheetDraft & { id: string; name: string };
    const house: Sheet[] = HOUSE_CHARACTERS.map((c) => ({ id: c.id, name: c.name, bio: c.bio, traits: [...c.traits], want: c.want, dealbreaker: c.dealbreaker, voice: c.voice }));
    const weight = termWeights(house.map((h) => conceptTerms(h)));
    const flagged = house.flatMap((x, i) => house.slice(i + 1).flatMap((y) => (twinWhy(x, y, conceptTerms(x), conceptTerms(y), weight) ? [`${x.name} × ${y.name}`] : [])));
    expect(flagged).toEqual([]);
  });
});

describe("7. how an ending is made, said before booking", () => {
  it("go_on_date's preview says it in one short note: what it's decided from, the levers there are, what doesn't count, and sliding_doors; no numbers", async () => {
    const A = await agentWith("Ada Lumen");
    const p = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id, preview: true }, A.ctx)).structuredContent;
    expect(p.ending_note).toBe(BOOKED_ENDING_NOTE);
    expect(p.ending_note).toMatch(/^How it ends: decided when it's booked, from the two characters' sheets and the date's setup/);
    expect(p.ending_note).toMatch(/strategy, agenda, autonomy, game_budget\) change the odds; format and visibility don't, and nothing said on the date does\. sliding_doors/);
    expect(p.ending_note).not.toMatch(/\d/);
    expect(p.ending).toBeUndefined();
    expect(p.box_score).toBeUndefined();
  });

  it("start_own_date's first reply leads its ending_note with the same, for a date you write; the quickstart says it too", async () => {
    const ctx = await connect();
    expect(ctx.init.instructions).toContain(`Endings: ${ENDING_RULE}.`);
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    expect(started.ending_note.startsWith(`${OWN_ENDING_NOTE} In the last act every step says which way it lands (act_note).`)).toBe(true);
    // 2.10.0 (the 2026-10-22-0800 run): the one lever, said as one (tests/mcp-run-0800.test.ts).
    expect(OWN_ENDING_NOTE).toMatch(/never by what the lines say\. Your one lever: see_again: true or false \(private\) with your character's last line/);
  });

  it("the levers are real: go_on_date's settings reach the date (not 'Ignored'), the preview echoes them, and a value outside the list is refused before anything is spent", async () => {
    const A = await agentWith("Ada Lumen");
    const settings = { strategy: "long_term", agenda: "find_funny", autonomy: "guided", game_budget: 50 };
    const preview = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id, preview: true, ...settings }, A.ctx)).structuredContent;
    expect(preview.settings).toEqual(settings);
    const booked = await houseDate(A.ctx, A.id, "friends", settings);
    expect(booked.warning).toBeUndefined();
    expect(booked.ignored_arguments).toBeUndefined();
    const setup = (await t.db.query<Any>(`select setup from episodes where id = $1`, [booked.episode.id])).rows[0].setup;
    expect(setup).toMatchObject({ strategy: "long_term", agenda_a: "find_funny", autonomy: "guided", game_budget_a: 50 });
    const episodes = await t.count("episodes");
    const bad = await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id, again: true, strategy: "bold" }, A.ctx);
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent.code).toBe("invalid_argument");
    expect(bad.content[0].text).toMatch(/strategy: one of genuine_chemistry, fun_adventure, long_term, unexpected; got "bold"/);
    expect(await t.count("episodes")).toBe(episodes);
  });
});
