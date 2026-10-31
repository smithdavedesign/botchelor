import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { airDueDates } from "@/lib/air";
import { listNotifications } from "@/lib/notifications";
import { api, episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1032 (nobody was told their own date aired) and #1033 (stage_up and get_relationships named different stages).
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
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;

async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-aired-notice-test" } }, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  const r = await call("create_character", validCharacter({ name, ...extra }), session);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx: session, agentId: r.structuredContent.agent_id as string, id: r.structuredContent.character.id as string };
}

/** A house date booked over MCP, ready, not aired (pastWindow moves its booking back past the prediction window). */
async function houseDate(ctx: McpContext, characterId: string, ending: "friends" | "second_date" | "disaster" = "friends", extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const r = await call("go_on_date", { character_id: characterId, partner_id: HOUSE_PARTNER_ID, again: true, ...extra }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent.episode.id as string;
}
/** Moves dates' bookings back past the window, in order (each a minute after the one before), so they're due. */
async function pastWindow(...ids: string[]) {
  for (const [i, id] of ids.entries()) await t.db.query(`update episodes set created_at = now() - interval '1 hour' + $2 * interval '1 minute' where id = $1`, [id, i]);
}

const aired = async (userId: string) => (await listNotifications(t.db, userId)).filter((n) => n.kind === "date_aired");

describe("the owners hear their date aired (#1032)", () => {
  it("a date that airs on its own tells its owner once, in my_status's new_since, without the ending", async () => {
    const A = await agentWith("Ada Lumen");
    const ep = await houseDate(A.ctx, A.id);
    const before = (await call("my_status", {}, A.ctx)).structuredContent;
    await pastWindow(ep);
    expect((await airDueDates(t.db)).map((d) => d.id)).toEqual([ep]);
    const after = (await call("my_status", { since: before.cursor }, A.ctx)).structuredContent;
    expect(after.new_since).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "date_aired", title: expect.stringMatching(/^📺 Ada × .*: your date aired$/) })]));
    const notices = await aired(A.agentId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ link: `/episodes/${ep}`, body: expect.stringContaining(`Episode ${ep}.`) });
    expect(notices[0].body!.length).toBeLessThanOrEqual(300);
    expect(notices[0].body).not.toMatch(/friends/i);
    // Airing is once: running the job again tells nobody anything more.
    await airDueDates(t.db);
    expect(await aired(A.agentId)).toHaveLength(1);
  });

  it("the host who airs it themselves (air_date, the reveal route) isn't told what they just did", async () => {
    const A = await agentWith("Ada Lumen");
    const first = await houseDate(A.ctx, A.id);
    await pastWindow(first);
    const r = (await call("air_date", { episode_id: first }, A.ctx)).structuredContent;
    expect(r.aired).toBe(true);
    const second = await houseDate(A.ctx, A.id);
    await pastWindow(second);
    expect((await api.reveal(second, `bz_uid=${A.agentId}`)).status).toBe(200);
    expect(await aired(A.agentId)).toEqual([]);
  });

  it("the other character's owner hears it when the host airs it", async () => {
    const extras = { open_to_dates: true, extras: { prompts: [{ id: "simple_pleasures", answer: "A window seat and nowhere to be." }, { id: "geek_out", answer: "Old maps, and the places on them." }], hobbies: ["Hiking"] } };
    const A = await agentWith("Ada Lumen", extras);
    const B = await agentWith("Bo Quill", extras);
    await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const r = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    if (r.isError) throw new Error(r.content[0].text);
    const ep = r.structuredContent.episode.id as string;
    await pastWindow(ep);
    expect((await call("air_date", { episode_id: ep }, A.ctx)).structuredContent.aired).toBe(true);
    expect(await aired(A.agentId)).toEqual([]);
    expect(await aired(B.agentId)).toEqual([expect.objectContaining({ link: `/episodes/${ep}`, title: "📺 Ada × Bo: your date aired" })]);
  });

  it("an owner told of a step up by that airing gets no second notice for it", async () => {
    const A = await agentWith("Ada Lumen");
    await pastWindow(await houseDate(A.ctx, A.id, "second_date"));
    await airDueDates(t.db);
    const inbox = await listNotifications(t.db, A.agentId);
    expect(inbox.filter((n) => n.kind === "stage_up")).toHaveLength(1);
    expect(inbox.filter((n) => n.kind === "date_aired")).toEqual([]);
  });
});

describe("stage_up and get_relationships name the same stage (#1033)", () => {
  it("an owner whose stage counts more than the public record hears both, and get_relationships says which is which", async () => {
    const A = await agentWith("Ada Lumen");
    // A public date that ends in a second date (not aired yet), then an unlisted disaster that airs first.
    const pub = await houseDate(A.ctx, A.id, "second_date");
    const unlisted = await houseDate(A.ctx, A.id, "disaster", { visibility: "unlisted" });
    await pastWindow(pub, unlisted);
    await airDueDates(t.db);
    const stageUp = (await listNotifications(t.db, A.agentId)).filter((n) => n.kind === "stage_up");
    expect(stageUp).toHaveLength(1);
    expect(stageUp[0].title).toMatch(/✨ Sparks \(public record\)$/);
    expect(stageUp[0].body).toMatch(/Counting every date you can see, they're 💔 Exes/);

    const mine = (await call("get_relationships", { character_id: A.id }, A.ctx)).structuredContent.relationships[0];
    expect(mine).toMatchObject({ stage: "exes", public_stage: "✨ Sparks", public_stage_note: expect.stringMatching(/stage_up notice/) });
    // Asked from the other side (the house character's id), the same owner reads the same pair the same way.
    const theirs = (await call("get_relationships", { character_id: HOUSE_PARTNER_ID, with: A.id }, A.ctx)).structuredContent.relationships[0];
    const fromHouse = (await call("get_relationships", { character_id: HOUSE_PARTNER_ID }, A.ctx)).structuredContent.relationships.find((r: Any) => r.with.id === A.id);
    expect(theirs).toMatchObject({ stage: "exes", public_stage: "✨ Sparks" });
    expect(fromHouse).toMatchObject({ stage: mine.stage, dates: mine.dates, public_stage: "✨ Sparks" });
  });

  it("a stranger reads the public stage the notice names", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    await pastWindow(await houseDate(A.ctx, A.id, "second_date"));
    await airDueDates(t.db);
    const stageUp = (await listNotifications(t.db, A.agentId)).find((n) => n.kind === "stage_up")!;
    expect(stageUp.title).toMatch(/: ✨ Sparks$/);
    const seen = (await call("get_relationships", { character_id: A.id }, B.ctx)).structuredContent.relationships[0];
    expect(seen.stage).toBe("sparks");
    expect(seen.public_stage).toBeUndefined();
  });
});
