import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { siblingEpisode, DOUBLE_VENUE } from "@/lib/group-dates";
import { api, episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter, newUserCookie } from "./helpers";
import { seasonCastIds } from "@/lib/season-cast";
import { airEpisode } from "@/lib/air";
import { sharedTable } from "@/lib/house-matchmaker";
import { runDueMixers } from "@/lib/group-dates-run";
import { GET as doublesGet, POST as doublesPost } from "@/app/api/doubles/route";
import { GET as inviteGet, POST as invitePost } from "@/app/api/doubles/[id]/route";
import { loadCharacterMemory, remembered } from "@/lib/memory";

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
const send = async (method: string, params: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  (await send("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "double-test", version: "1" } }, ctx);
  return { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
/** An agent and one character of its own. */
async function agent(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const made = (await call("create_character", { ...validCharacter({ name }), extras: PROFILE, ...extra }, ctx)).structuredContent;
  return { ctx, id: made.character.id as string, agentId: made.agent_id as string };
}
const house2 = () => seasonCastIds().find((id) => id !== HOUSE_PARTNER_ID)!;
const house3 = () => seasonCastIds().filter((id) => id !== HOUSE_PARTNER_ID)[1]!;

describe("double dates (lib/group-dates)", () => {
  it("a self-double books both tables at once, at the booth for four, each knowing the other couple", async () => {
    const a = await agent("Juni Marsh");
    const second = (await call("create_character", { ...validCharacter({ name: "Lotte Hale" }), extras: PROFILE, agent_id: a.agentId }, a.ctx)).structuredContent
      .character.id as string;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const r = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: second, with_partner: house2(), agent_id: a.agentId },
      a.ctx,
    );
    expect(r.isError).toBeUndefined();
    const { episode_a, episode_b } = r.structuredContent.booked;
    const rows = (await t.db.query<Any>(`select id, group_id, setup->>'venue' as venue, setup->>'table' as table from episodes order by created_at`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((x: Any) => x.id).sort()).toEqual([episode_a, episode_b].sort());
    expect(rows[0].group_id).toBe(rows[1].group_id);
    expect(rows[0].group_id).not.toBeNull();
    for (const row of rows) {
      expect(row.venue).toBe(DOUBLE_VENUE);
      expect(row.table).toMatch(/double date/);
      expect(row.table).toMatch(/share your table/);
    }
    // Each table's line names the OTHER couple, not itself.
    expect(rows.find((x: Any) => x.id === episode_a)!.table).toMatch(/Lotte/);
    expect(rows.find((x: Any) => x.id === episode_b)!.table).toMatch(/Juni/);
    // One booker, one notice.
    const notes = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'double_date'`, [a.agentId])).rows;
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/booked/);
    // Each episode's page can point at the other table.
    expect((await siblingEpisode(t.db, episode_a))?.episode_id).toBe(episode_b);
  });

  it("an invite books both tables when the other booker accepts, and a decline says not this time", async () => {
    const a = await agent("Juni Marsh");
    const b = await agent("Pia Voss");
    const invite = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: b.id, with_partner: house2(), agent_id: a.agentId },
      a.ctx,
    );
    expect(invite.isError).toBeUndefined();
    const nightId = invite.structuredContent.invited;
    expect(nightId).toBeTruthy();
    expect((await t.db.query<Any>(`select status from group_nights where id = $1`, [nightId])).rows[0].status).toBe("invited");
    const asked = (await t.db.query<Any>(`select body from notifications where user_id = $1 and kind = 'double_invite'`, [b.agentId])).rows;
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toContain(nightId);

    // The wrong agent can't answer it.
    expect((await call("double_date", { accept: nightId, agent_id: a.agentId }, a.ctx)).isError).toBe(true);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const accepted = await call("double_date", { accept: nightId, agent_id: b.agentId }, b.ctx);
    expect(accepted.isError).toBeUndefined();
    const { your_table, their_table } = accepted.structuredContent.booked;
    const night = (await t.db.query<Any>(`select * from group_nights where id = $1`, [nightId])).rows[0];
    expect(night.status).toBe("booked");
    expect([night.episode_a, night.episode_b].sort()).toEqual([their_table, your_table].sort());
    // Each booker paid for and owns its own table.
    const creators = (await t.db.query<Any>(`select id, creator_id from episodes`)).rows;
    expect(creators.find((x: Any) => x.id === their_table)!.creator_id).toBe(a.agentId);
    expect(creators.find((x: Any) => x.id === your_table)!.creator_id).toBe(b.agentId);

    // A fresh invite, declined: the proposer hears, nothing books.
    const again = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: b.id, with_partner: house2(), agent_id: a.agentId },
      a.ctx,
    );
    const declined = await call("double_date", { decline: again.structuredContent.invited, agent_id: b.agentId }, b.ctx);
    expect(declined.isError).toBeUndefined();
    const no = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'double_date' and title like '%Not this time%'`, [a.agentId])).rows;
    expect(no).toHaveLength(1);
  });

  it("refuses a house booker, a repeated character, and a table that isn't the night's", async () => {
    const a = await agent("Juni Marsh");
    const housed = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: house2(), with_partner: house3(), agent_id: a.agentId },
      a.ctx,
    );
    expect(housed.isError).toBe(true);
    expect(housed.content[0].text).toMatch(/house cast/);
    const doubled = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: a.id, with_partner: house2(), agent_id: a.agentId },
      a.ctx,
    );
    expect(doubled.isError).toBe(true);
    expect(doubled.content[0].text).toMatch(/four different characters/);
    // The booking route refuses a group_night that doesn't exist or isn't this couple's.
    const cookie = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter({ name: "Wren Kestrel" }), cookie)).json();
    const res = await api.createEpisode({ character_id: mine.id, partner_id: HOUSE_PARTNER_ID, group_night: crypto.randomUUID() }, cookie);
    expect(res.status).toBe(404);
    expect(userIdOf(cookie)).toBeTruthy();
  });

  it("when the other table can't book, the booked date goes ahead solo and both hear why", async () => {
    const a = await agent("Juni Marsh");
    const b = await agent("Pia Voss");
    const x = await agent("Sol Vega", { open_to_dates: true });
    const invite = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: b.id, with_partner: x.id, agent_id: a.agentId },
      a.ctx,
    );
    const nightId = invite.structuredContent.invited;
    // Sol closes to dates before the invite is answered: B's table can no longer book.
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [x.id]);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const accepted = await call("double_date", { accept: nightId, agent_id: b.agentId }, b.ctx);
    expect(accepted.isError).toBe(true);
    expect(accepted.content[0].text).toMatch(/other couple's table|couldn't be booked/);
    const night = (await t.db.query<Any>(`select * from group_nights where id = $1`, [nightId])).rows[0];
    expect(night.status).toBe("half_booked");
    expect(night.episode_a).not.toBeNull();
    // The solo date stands, untied from the night.
    const episode = (await t.db.query<Any>(`select group_id from episodes where id = $1`, [night.episode_a])).rows[0];
    expect(episode.group_id).toBeNull();
    const told = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'double_date'`, [a.agentId])).rows;
    expect(told.some((n: Any) => /fell through/.test(n.title))).toBe(true);
  });
});

describe("the table is remembered (group dates PR B)", () => {
  it("once both tables air, everyone at the table remembers everyone, and the matchmaker can tell", async () => {
    const a = await agent("Juni Marsh");
    const second = (await call("create_character", { ...validCharacter({ name: "Lotte Hale" }), extras: PROFILE, agent_id: a.agentId }, a.ctx)).structuredContent
      .character.id as string;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const r = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: second, with_partner: house2(), agent_id: a.agentId },
      a.ctx,
    );
    const { episode_a, episode_b } = r.structuredContent.booked;

    // One table aired: nobody "met" anyone yet — the other table is still unaired.
    expect(await airEpisode(t.db, episode_a, a.agentId)).not.toBeNull();
    const early = await loadCharacterMemory(t.db, a.id);
    expect(early?.met ?? []).toHaveLength(0);

    // Both aired: each character at the table remembers the OTHER couple — who they were with, and how it ended.
    expect(await airEpisode(t.db, episode_b, a.agentId)).not.toBeNull();
    const mine = await loadCharacterMemory(t.db, a.id);
    expect((mine?.met ?? []).map((m) => m.id).sort()).toEqual([second, house2()].sort());
    const across = mine!.met!.find((m) => m.id === second)!;
    expect(across.with_name).toBeTruthy();
    expect(across.venue).toBe(DOUBLE_VENUE);
    // The other table's couple remembers this one too (their memories rebuilt when this table aired).
    const theirs = await loadCharacterMemory(t.db, second);
    expect((theirs?.met ?? []).map((m) => m.id).sort()).toEqual([a.id, HOUSE_PARTNER_ID].sort());

    // A later date between cross-table characters carries the meeting into the prompt — nothing private, one line.
    const block = remembered({ memory: mine }, second);
    expect(block).not.toBeNull();
    expect(block!.times).toBe(0);
    expect(String(block!.you_met_once)).toMatch(/you've met: a group night/);
    expect(String(block!.you_met_once)).toMatch(/double date/);

    // The matchmaker's observed-chemistry check: cross-table pairs count, same-table partners don't (they dated).
    expect(await sharedTable(t.db, a.id, second)).toBe(true);
    expect(await sharedTable(t.db, a.id, house2())).toBe(true);
    expect(await sharedTable(t.db, a.id, HOUSE_PARTNER_ID)).toBe(false);
  });
});

describe("mixers (group dates M2)", () => {
  it("four singles join, the night runs a circle of speed dates, and after airing everyone joins everyone's memory", async () => {
    const singles = [await agent("Juni Marsh"), await agent("Pia Voss"), await agent("Sol Vega"), await agent("Kit Crag")];
    for (const s of singles) {
      const joined = await call("mixer", { join: s.id, agent_id: s.agentId }, s.ctx);
      expect(joined.isError).toBeUndefined();
    }
    const open = (await call("mixer", { list: true, agent_id: singles[0].agentId }, singles[0].ctx)).structuredContent;
    expect(open.mixer.singles).toHaveLength(4);

    // Doors still open: not yet. Past the doors window: it runs, one booked speed date per single.
    expect(await runDueMixers(t.db, new Date(Date.now() + 60_000))).toMatchObject({ ran: 0, waiting: 1 });
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson(), episodeJson(), episodeJson()]);
    const run = await runDueMixers(t.db, new Date(Date.now() + 31 * 60_000));
    expect(run).toMatchObject({ ran: 1, booked: 4, failed: 0 });

    const eps = (await t.db.query<Any>(`select id, creator_id, character_a, character_b, group_id, setup->>'format' as format, setup->>'venue' as venue, setup->>'table' as table from episodes`)).rows;
    expect(eps).toHaveLength(4);
    expect(new Set(eps.map((e: Any) => e.group_id)).size).toBe(1);
    expect(new Set(eps.map((e: Any) => e.venue)).size).toBe(1);
    expect(new Set(eps.map((e: Any) => e.creator_id)).size).toBe(4); // each single books exactly one rotation
    for (const e of eps) {
      expect(e.format).toBe("speed_date");
      expect(e.table).toMatch(/speed-dating mixer/);
    }
    // A circle: each character appears in exactly two rotations.
    const appearances = new Map<string, number>();
    for (const e of eps) for (const c of [e.character_a, e.character_b]) appearances.set(c, (appearances.get(c) ?? 0) + 1);
    for (const s of singles) expect(appearances.get(s.id)).toBe(2);
    // The wrap tells each single and asks for the reflection (David: remember who they liked).
    const note = (await t.db.query<Any>(`select body from notifications where user_id = $1 and kind = 'mixer'`, [singles[0].agentId])).rows;
    expect(note).toHaveLength(1);
    expect(note[0].body).toMatch(/reflect/);

    // Air all four; then each single's memory holds its two dates as people, and the one it missed as met.
    for (const e of eps) expect(await airEpisode(t.db, e.id, e.creator_id)).not.toBeNull();
    const mine = await loadCharacterMemory(t.db, singles[0].id);
    const dated = new Set(eps.filter((e: Any) => [e.character_a, e.character_b].includes(singles[0].id)).flatMap((e: Any) => [e.character_a, e.character_b]));
    const missed = singles.map((s) => s.id).find((id) => !dated.has(id))!;
    expect((mine?.people ?? []).map((pn) => pn.id).sort()).toEqual([...dated].filter((id) => id !== singles[0].id).sort());
    expect((mine?.met ?? []).map((m) => m.id)).toEqual([missed]);
    expect(await sharedTable(t.db, singles[0].id, missed)).toBe(true);

    // David 2026-10-25: the character saves its own take on who it liked, and a later first date carries it.
    const taken = await call(
      "remember_meeting",
      { character_id: singles[0].id, about: missed, note: "Sharp, funny, kept everyone's drinks straight. Ask about the lighthouse story.", agent_id: singles[0].agentId },
      singles[0].ctx,
    );
    expect(taken.isError).toBeUndefined();
    const withTake = await loadCharacterMemory(t.db, singles[0].id);
    expect(withTake!.met![0].your_take).toMatch(/lighthouse/);
    const block = remembered({ memory: withTake }, missed);
    expect(String(block!.you_met_once)).toMatch(/Your take at the time: .*lighthouse/);
    // Someone it DATED takes reflect_on_date, not a met note.
    const datedOne = [...dated].find((id) => id !== singles[0].id)!;
    const no = await call("remember_meeting", { character_id: singles[0].id, about: datedOne, note: "nope", agent_id: singles[0].agentId }, singles[0].ctx);
    expect(no.isError).toBe(true);
    expect(no.content[0].text).toMatch(/reflect/);
  });

  it("a mixer that never fills is called off free; leaving before it runs works; the same character can't join twice", async () => {
    const a = await agent("Juni Marsh");
    const b = await agent("Pia Voss");
    expect((await call("mixer", { join: a.id, agent_id: a.agentId }, a.ctx)).isError).toBeUndefined();
    expect((await call("mixer", { join: a.id, agent_id: a.agentId }, a.ctx)).isError).toBe(true); // already in
    expect((await call("mixer", { join: b.id, agent_id: b.agentId }, b.ctx)).isError).toBeUndefined();
    expect((await call("mixer", { leave: b.id, agent_id: b.agentId }, b.ctx)).isError).toBeUndefined();
    // Too few, too old: called off, told, nothing spent.
    expect(await runDueMixers(t.db, new Date(Date.now() + 25 * 60 * 60_000))).toMatchObject({ cancelled: 1 });
    expect((await t.db.query<Any>(`select count(*)::int as n from episodes`)).rows[0].n).toBe(0);
    const note = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'mixer'`, [a.agentId])).rows;
    expect(note).toHaveLength(1);
    expect(note[0].title).toMatch(/called off/);
  });
});

describe("the web's doubles (M1b)", () => {
  const webReq = (path: string, cookie: string, body?: unknown) =>
    new Request(`http://test.local${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("the thread's picker books a self-double, and the options never offer the thread's own pair", async () => {
    const cookie = newUserCookie();
    const c1 = await (await api.createCharacter(validCharacter({ name: "Wren Kestrel" }), cookie)).json();
    const c2 = await (await api.createCharacter(validCharacter({ name: "Moss Elder" }), cookie)).json();
    const options = (await (await doublesGet(webReq(`/api/doubles?excluding=${c1.id},${HOUSE_PARTNER_ID}`, cookie))).json()) as Any;
    expect(options.options.map((o: Any) => o.character_id)).toEqual([c2.id]);
    expect(options.options[0].partner_id).not.toBe(HOUSE_PARTNER_ID);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const res = await doublesPost(
      webReq("/api/doubles", cookie, { character_id: c1.id, partner_id: HOUSE_PARTNER_ID, with_character: c2.id, with_partner: options.options[0].partner_id }),
    );
    expect(res.status).toBe(201);
    const booked = (await res.json()) as Any;
    const rows = (await t.db.query<Any>(`select id, group_id from episodes`)).rows;
    expect(rows.map((r: Any) => r.id).sort()).toEqual([booked.episode_a, booked.episode_b].sort());
    expect(rows[0].group_id).toBe(rows[1].group_id);
  });

  it("a person answers an agent's invite at /doubles/[id]: the view names both couples, accept books both", async () => {
    const a = await agent("Juni Marsh");
    const cookie = newUserCookie();
    const theirs = await (await api.createCharacter(validCharacter({ name: "Sol Vega" }), cookie)).json();
    const invite = await call(
      "double_date",
      { character_id: a.id, partner_id: HOUSE_PARTNER_ID, with_character: theirs.id, with_partner: house2(), agent_id: a.agentId },
      a.ctx,
    );
    const nightId = invite.structuredContent.invited;
    const view = (await (await inviteGet(webReq(`/api/doubles/${nightId}`, cookie), { params: Promise.resolve({ id: nightId }) })).json()) as Any;
    expect(view.yours_to_answer).toBe(true);
    expect(view.couple_a.join(" ")).toMatch(/Juni/);
    expect(view.couple_b.join(" ")).toMatch(/Sol/);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const res = await invitePost(webReq(`/api/doubles/${nightId}`, cookie, { action: "accept" }), { params: Promise.resolve({ id: nightId }) });
    expect(res.status).toBe(200);
    const booked = (await res.json()) as Any;
    expect((await t.db.query<Any>(`select creator_id from episodes where id = $1`, [booked.episode_b])).rows[0].creator_id).toBe(userIdOf(cookie));
    // Settled: answering again is a 409.
    const again = await invitePost(webReq(`/api/doubles/${nightId}`, cookie, { action: "decline" }), { params: Promise.resolve({ id: nightId }) });
    expect(again.status).toBe(409);
  });
});
