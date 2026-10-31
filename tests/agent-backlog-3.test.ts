import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { getDealbreakerQuiz } from "@/lib/mechanics";
import { rescueStuckJob } from "@/lib/jobs";
import { pairKey } from "@/lib/relationships";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The agent-feedback issues from the 10-run loop (2026-10-18): #250, #251, #253, #255, #258, #259, #263–#267, #269, #272.
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
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-backlog-3-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const c = (await call("create_character", validCharacter({ name, keep_name: true, ...extra }), ctx)).structuredContent;
  return { ctx, agentId: c.agent_id as string, id: c.character.id as string, created: c };
}

const line = { dialogue: "So, what's the strangest map you've drawn?", action: "", emotion: "curious", interest_signal: 0.6 };

describe("own dates say what happened (#250, #251, #263, #272)", () => {
  it("a refused turn leads with accepted: false and why; a good one says accepted: true", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: id, partner_id: b, visibility: "private" }, ctx)).structuredContent;
    expect(step.private_note).toMatch(/costs nothing/);
    expect(step.private_note).not.toMatch(/used one of your free dates/);
    const refused = (await call("submit_own_date_step", { episode_id: step.step.episode_id, output: { dialogue: "" } }, ctx)).structuredContent;
    expect(refused).toMatchObject({ accepted: false, rejected: expect.any(String), message: expect.stringMatching(/^Not handed in: .*Send a corrected reply/) });
    const ok = (await call("submit_own_date_step", { episode_id: step.step.episode_id, output: line }, ctx)).structuredContent;
    expect(ok.accepted).toBe(true);
  });

  it("wait_for_my_turn says how long it waited; my_status lists the open own date", async () => {
    const a = await agentWith("Ada Lumen");
    const b = await agentWith("Bo Quill", { open_to_dates: true });
    const step = (await call("start_own_date", { character_id: a.id, partner_id: b.id }, a.ctx)).structuredContent.step;
    await call("submit_own_date_step", { episode_id: step.episode_id, output: line }, a.ctx);
    const w = (await call("wait_for_my_turn", { episode_id: step.episode_id, timeout_seconds: 1 }, a.ctx)).structuredContent;
    expect(w).toMatchObject({ still_waiting: true, retry_after_seconds: 5, waited_seconds: expect.any(Number) });
    expect(w.waited_seconds).toBeGreaterThanOrEqual(1);
    const status = (await call("my_status", {}, a.ctx)).structuredContent;
    expect(status.open_own_dates).toEqual([{ episode_id: step.episode_id, with: "Bo Quill", your_move: false, quiet_minutes: 0 }]);
  });
});

describe("show dates say what they mean (#255, #267, #253)", () => {
  it("a public date says it's public and when it airs", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const r = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent;
    expect(r.public_note).toMatch(/^Public: .*airs on its own about \d+ minutes.*set_date_visibility/);
  });

  it("making a date public after its window says it airs within moments", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "private" }, ctx)).structuredContent.episode;
    await t.db.query(`update episodes set created_at = now() - interval '2 hours', revealed_at = null where id = $1`, [ep.id]);
    const r = (await call("set_date_visibility", { episode_id: ep.id, visibility: "public" }, ctx)).structuredContent;
    expect(r.note).toMatch(/window has already closed, so it airs within moments/);
  });

  it("a generation job that died is picked up again; one that's fine is left alone", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    expect(await rescueStuckJob(t.db, ep.id)).toBe(false);
    await t.db.query(`update generation_jobs set status = 'running', leased_until = now() - interval '1 minute' where episode_id = $1`, [ep.id]);
    expect(await rescueStuckJob(t.db, ep.id)).toBe(true);
  });
});

describe("matches (#258, #259, #264)", () => {
  it("answering a match marks its notification read, and an agreed match says which tool books what", async () => {
    const a = await agentWith("Ada Lumen");
    const b = await agentWith("Bo Quill");
    const [lo, hi] = pairKey(a.id, b.id);
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, null, true), ($1, $2, null, true) on conflict do nothing`, [lo, hi]);
    if (lo === b.id) await t.db.query(`update matches set yes_lo = true, yes_hi = null where character_lo = $1`, [lo]);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'matched', 'Match', $2)`, [a.agentId, `/messages/${lo}/${hi}`]);
    const r = (await call("answer_match", { character_id: a.id, with: b.id, yes: true }, a.ctx)).structuredContent;
    // #1024: the free start_own_date first, and go_on_date says it spends one of today's shared show dates.
    expect(r.next).toMatch(/start_own_date: you play your character.*free.*go_on_date: the show's model plays both sides.*one of today's shared show dates/s);
    expect((await t.db.query<Any>(`select read_at from notifications where user_id = $1 and kind = 'matched'`, [a.agentId])).rows[0].read_at).not.toBeNull();
  });

  it("guess_dealbreaker never uses the guesser's own character's dealbreaker as a decoy", async () => {
    const { ctx, agentId } = await agentWith("Ada Lumen", { dealbreaker: "Anyone who alphabetises spices" });
    const other = await agentWith("Bo Quill");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: other.id, partner_id: HOUSE_PARTNER_ID }, other.ctx)).structuredContent.episode;
    const quiz = await getDealbreakerQuiz(t.db, ep.id, agentId);
    expect(quiz!.options.map((o: Any) => (typeof o === "string" ? o : o.text))).not.toContain("Anyone who alphabetises spices");
    void ctx;
  });
});

describe("what was dropped and near-twins (#265, #266)", () => {
  it("ignored arguments lead the reply as a warning, and open_afterglow takes character_id", async () => {
    const { ctx, id, agentId } = await agentWith("Ada Lumen");
    const r = (await call("my_characters", { colour: "blue", agent_id: agentId }, ctx)).structuredContent;
    expect(Object.keys(r)[0]).toBe("warning");
    expect(r.warning).toMatch(/^Ignored: colour \(my_characters takes: /);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    const a = (await call("open_afterglow", { episode_id: ep.id, character_id: id }, ctx)).structuredContent;
    expect(a.ignored_arguments).toBeUndefined();
  });

  it("a near-twin on the show leads the create reply as a warning", async () => {
    await agentWith("Ada Lumen");
    const twin = await agentWith("Cy Marr");
    expect(twin.created.warning).toMatch(/reads a lot like Ada Lumen/);
  });
});
