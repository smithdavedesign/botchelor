import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, HOUSE_BOT_LABEL, type McpContext } from "@/lib/mcp";
import { notify } from "@/lib/notifications";
import { siteUrl } from "@/lib/site";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// What 40 visitor agents asked for in 20 loop runs (2026-10-20): auto-play, check_only, summaries, a free preview,
// live-agent filters, a "wait for anything", prediction history, a second-date hint, export, and the bugs they hit.
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

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(client = "botchelor-ten-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: client } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const turnJson = (i: number) => JSON.stringify({ dialogue: `Line ${i}: tell me something true about the sea, and something false.`, action: "", emotion: "warm", interest_signal: 0.6 });
const line = { dialogue: "So, what's the strangest map you've drawn?", action: "", emotion: "curious", interest_signal: 0.6 };

async function twoOfMine() {
  const ctx = await connect();
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
  return { ctx, a, b };
}

describe("autoplay_own_date: the show plays the rest", () => {
  it("plays every remaining line and writes the recap in one call (both sides of your own two characters)", async () => {
    const { ctx, a, b } = await twoOfMine();
    const started = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    expect(started.how_long_tip).toMatch(/autoplay_own_date/);
    await call("submit_own_date_step", { episode_id: started.step.episode_id, output: line }, ctx);
    // A speed date is six lines: one handed in, five for the show, then its recap.
    scriptedModel([...Array.from({ length: 5 }, (_, i) => turnJson(i)), episodeJson()]);
    const r = (await call("autoplay_own_date", { episode_id: started.step.episode_id }, ctx)).structuredContent;
    expect(r.autoplay).toBe("both");
    expect(r.step.stage).toBe("done");
    const row = (await t.db.query<{ status: string; n: number; at: Date | null }>(`select status, jsonb_array_length(transcript) as n, handed_over_at as at from episodes where id = $1`, [started.step.episode_id])).rows[0];
    expect(row.status).toBe("ready");
    expect(row.at).not.toBeNull(); // counts as one of the agents' daily show-model dates
  });

  it("plays one side while you write the other", async () => {
    const { ctx, a, b } = await twoOfMine();
    const started = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    scriptedModel([turnJson(1)]);
    const r = (await call("autoplay_own_date", { episode_id: started.episode_id, side: "b" }, ctx)).structuredContent;
    // Ada (a) is up first and is still yours: nothing was played yet, and it's your turn.
    expect(r.step).toMatchObject({ stage: "turn", side: "a" });
    const after = (await call("submit_own_date_step", { episode_id: started.episode_id, output: line }, ctx)).structuredContent.step;
    // Bo's line came from the show; your next line (Ada's) is up.
    expect(after).toMatchObject({ stage: "turn", side: "a", turn: 2 });
  });

  it("on a two-agent date plays only your own side", async () => {
    const a = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), a)).structuredContent.character.id;
    const b = await connect();
    const theirs = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, open_to_dates: true }), b)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: mine, partner_id: theirs }, a)).structuredContent.step;
    expect((await call("autoplay_own_date", { episode_id: step.episode_id, side: "both" }, a)).isError).toBe(true);
    scriptedModel([turnJson(1)]);
    const r = (await call("autoplay_own_date", { episode_id: step.episode_id, side: "mine" }, a)).structuredContent;
    expect(r.step.stage).toBe("waiting"); // the show played Ada's line; now it's Bo's agent's move
  });
});

describe("check_only on a step", () => {
  it("says whether a line would be accepted, and hands nothing in", async () => {
    const { ctx, a, b } = await twoOfMine();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const ok = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line, check_only: true }, ctx)).structuredContent;
    expect(ok).toMatchObject({ checked: true, would_accept: true });
    const bad = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: "" }, check_only: true }, ctx)).structuredContent;
    expect(bad.accepted).toBe(false);
    const n = (await t.db.query<{ n: number }>(`select jsonb_array_length(transcript) as n from episodes where id = $1`, [step.episode_id])).rows[0].n;
    expect(n).toBe(0);
  });
});

describe("dates you can see before and after", () => {
  it("go_on_date preview books nothing and spends nothing", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const before = (await call("my_status", {}, ctx)).structuredContent.dates_left.total;
    const p = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(p).toMatchObject({ preview: true, booked: false, with: { id: HOUSE_PARTNER_ID } });
    expect(p.cost).toMatch(/one date/);
    expect((await t.db.query(`select 1 from episodes`)).rows).toHaveLength(0);
    expect((await call("my_status", {}, ctx)).structuredContent.dates_left.total).toBe(before);
  });

  it("get_episode summary: just the result", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent;
    const s = (await call("get_episode", { episode_id: booked.episode.id, summary: true }, ctx)).structuredContent;
    expect(s.summary_note).toMatch(/result only/);
    const e = s.episode ?? s;
    expect(e.transcript).toBeUndefined();
    expect(e.scenes).toBeUndefined();
    expect(e.id).toBe(booked.episode.id);
  });

  it("export_character gives back a sheet create_character takes", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen", extras: PROFILE, soul: { values: "honesty" } }), ctx)).structuredContent.character.id;
    const out = (await call("export_character", { character_id: id }, ctx)).structuredContent.character;
    expect(out).toMatchObject({ name: "Ada Lumen", extras: { hobbies: ["Hiking", "Old maps"] }, soul: { values: "honesty" }, attest: true });
    const again = await call("create_character", { ...out, keep_name: true }, ctx);
    expect(again.isError).toBeUndefined();
  });
});

describe("my_status: what's new, who's on, how I did", () => {
  it("returns what's new since a cursor, and waits for it", async () => {
    const ctx = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx);
    const first = (await call("my_status", {}, ctx)).structuredContent;
    const who = first.agent_id ?? (await t.db.query<{ owner_id: string }>(`select owner_id from characters limit 1`)).rows[0].owner_id;
    setTimeout(() => void notify(t.db, who, { kind: "texted", title: "Bo texted", body: "hi", link: null }), 300);
    const waited = (await call("my_status", { since: first.cursor, wait_seconds: 3 }, ctx)).structuredContent;
    expect(waited.new_since).toEqual([expect.objectContaining({ kind: "texted", title: "Bo texted" })]);
    expect(waited.cursor).toBe(waited.new_since[0].at);
  });

  it("counts other agents on now (not the house-run bots), and reports predictions", async () => {
    const me = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), me);
    const other = await connect("some-agent");
    await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), other);
    const bot = await connect("botchelor-loop-swipe-back");
    await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true }), bot);
    const s = (await call("my_status", {}, me)).structuredContent;
    expect(s.agents_on_now).toBe(1);
    expect(s.live_agents_characters.map((c: Any) => c.name)).toEqual(["Bo Quill"]);
  });
});

describe("swipe_deck only:", () => {
  it("live_agents and agents leave out the house-run bots", async () => {
    const bot = await connect("botchelor-loop-swipe-back");
    await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, open_to_dates: true, extras: PROFILE }), bot);
    const live = await connect("some-agent");
    await call("create_character", validCharacter({ name: "Tobiah Ferreira", keep_name: true, open_to_dates: true, extras: PROFILE }), live);
    const me = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), me)).structuredContent.character.id;
    const names = async (only?: string) => ((await call("swipe_deck", { character_id: mine, ...(only ? { only } : {}) }, me)).structuredContent.cards as Any[]).map((c) => c.name);
    expect(await names()).toEqual(expect.arrayContaining(["Ines Varga-Holm", "Tobiah Ferreira"]));
    expect(await names("live_agents")).toEqual(["Tobiah Ferreira"]);
    expect(await names("agents")).toEqual(["Tobiah Ferreira"]);
    expect(await names("people")).toEqual([]);
  });

  it("start_own_date says when the other side is a house-run bot", async () => {
    const bot = await connect("botchelor-loop-swipe-back");
    const ines = (await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, open_to_dates: true }), bot)).structuredContent.character.id;
    const me = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), me)).structuredContent.character.id;
    const r = (await call("start_own_date", { character_id: mine, partner_id: ines }, me)).structuredContent;
    expect(r.other_side).toMatch(new RegExp(HOUSE_BOT_LABEL.split(":")[0]));
  });
});

describe("the sharp edges visitors hit", () => {
  it("a rejected line on a two-agent date doesn't show the ending", async () => {
    const a = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), a)).structuredContent.character.id;
    const b = await connect();
    const theirs = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, open_to_dates: true }), b)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: mine, partner_id: theirs }, a)).structuredContent.step;
    expect(step.ending).toBeUndefined();
    const refused = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: "" } }, a)).structuredContent;
    expect(refused.accepted).toBe(false);
    expect(refused.step.ending).toBeUndefined();
    expect(JSON.stringify(refused.step)).not.toMatch(/ending_label/);
  });

  it("a GET of ?tools=all lists every tool; a plain GET still says to POST", async () => {
    const { GET } = await import("@/app/api/mcp/route");
    const all = await GET(new Request("http://localhost/api/mcp?tools=all"));
    expect(all.status).toBe(200);
    expect((await all.json()).tools.length).toBeGreaterThan(40);
    expect((await GET(new Request("http://localhost/api/mcp"))).status).toBe(405);
  });

  it("go_on_date asks before booking the same house character twice in a row", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "private" }, ctx);
    const again = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx);
    expect(again.isError).toBe(true);
    expect(again.structuredContent.error).toMatch(/again: true/);
  });

  it("my_matches works without character_id when you have one character", async () => {
    const ctx = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx);
    const r = await call("my_matches", {}, ctx);
    expect(r.isError).toBeUndefined();
  });

  it("waiting_for_you isn't repeated on every reply once it's been said", async () => {
    const a = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), a)).structuredContent.character.id;
    const b = await connect();
    const theirs = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true, extras: PROFILE }), b)).structuredContent.character.id;
    await call("swipe", { character_id: theirs, target_id: mine, like: true }, b);
    await call("swipe", { character_id: mine, target_id: theirs, like: true }, a);
    // The swipe that made the match says so; the next replies don't repeat it while nothing's changed.
    const swiped = (await call("get_leaderboard", {}, a)).structuredContent;
    const again = (await call("get_leaderboard", {}, a)).structuredContent;
    expect(swiped.waiting_for_you).toBeUndefined();
    expect(again.waiting_for_you).toBeUndefined();
    expect((await call("my_status", {}, a)).structuredContent.waiting_for_you).toBeTruthy();
  });

  it("links point at the server they're on (SITE_URL), not localhost:3000", () => {
    expect(siteUrl({ SITE_URL: "http://127.0.0.1:4420/" })).toBe("http://127.0.0.1:4420");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "botchelor.com", SITE_URL: "http://x" })).toBe("https://botchelor.com");
  });
});
