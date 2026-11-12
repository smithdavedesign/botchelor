import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as takeRoute } from "@/app/api/double-links/[code]/route";
import { POST as linkRoute } from "@/app/api/double-links/route";
import { doubleLinkOptions, ensureDoubleLink, LINK_DAYS, loadDoubleLink, OPEN_LINKS_MAX, takeDoubleLink } from "@/lib/double-links";
import { DOUBLE_VENUE, dealtHouseDate } from "@/lib/group-dates";
import { handleMcpMessage, MCP_SERVER_INFO, type McpContext } from "@/lib/mcp";
import { TOOL_DEFS } from "@/lib/mcp/tool-defs";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { seasonCastIds } from "@/lib/season-cast";
import { weekAt } from "@/lib/seasons";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

// "Bring a friend" double-date links (lib/double-links.ts, the 2026-11-07 audit's item 12): a couple's link that
// whoever takes it books, bringing their character and a house date.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
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

async function person(name: string, extra: Record<string, unknown> = {}) {
  const cookie = newUserCookie();
  const c = await (await api.createCharacter(validCharacter({ name, ...extra }), cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: c.id as string };
}
const req = (path: string, cookie: string, body: unknown) =>
  new Request(`http://test.local${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const take = (code: string, cookie: string, characterId: string) =>
  takeRoute(req(`/api/double-links/${code}`, cookie, { character_id: characterId }), { params: Promise.resolve({ code }) });
const leaveDates = (userId: string, left: number) =>
  t.db.query(
    `insert into free_episode_usage (user_id, season_id, used) values ($1, $2, $3) on conflict (user_id, season_id) do update set used = $3`,
    [userId, weekAt(new Date()).id, FREE_EPISODES_PER_SEASON - left],
  );
/** The analytics lines written so far (lib/analytics.ts logs one JSON line per event). */
const tracked = (event: string): Any[] =>
  vi
    .mocked(console.log)
    .mock.calls.map((c) => {
      try {
        return JSON.parse(String(c[0]));
      } catch {
        return null;
      }
    })
    .filter((x) => x?.event === event);

describe("double-date links", () => {
  it("a couple's owner shares one stable link; a newcomer brings a character and a house date, and both tables book", async () => {
    const host = await person("Juni Marsh");
    const made = await linkRoute(req("/api/double-links", host.cookie, { character_id: host.id, partner_id: HOUSE_PARTNER_ID }));
    expect(made.status).toBe(201);
    const link = (await made.json()) as Any;
    // Handed out tagged (?ref=double), so the by-channel table counts its visitors as double_link (2026-11-11).
    expect(link.url).toMatch(new RegExp(`/double/${link.code}\\?ref=double$`));
    // The same link every time (one open link per couple).
    const again = await linkRoute(req("/api/double-links", host.cookie, { character_id: host.id, partner_id: HOUSE_PARTNER_ID }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as Any).code).toBe(link.code);
    expect(tracked("double_link_made")).toHaveLength(1);

    const friend = await person("Pia Voss"); // made after the link: a new creator, the number the audit wants
    const options = await doubleLinkOptions(t.db, friend.userId, { character_id: host.id, partner_id: HOUSE_PARTNER_ID });
    const houseDate = dealtHouseDate(friend.id, [host.id, HOUSE_PARTNER_ID]);
    expect(options).toEqual([expect.objectContaining({ character_id: friend.id, partner_id: houseDate })]);
    expect(houseDate).not.toBe(HOUSE_PARTNER_ID);

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const res = await take(link.code, friend.cookie, friend.id);
    expect(res.status).toBe(201);
    const booked = (await res.json()) as Any;
    expect(booked.watch).toBe(`/episodes/${booked.episode_b}?play=1`);

    const night = (await t.db.query<Any>(`select * from group_nights where id = $1`, [booked.night])).rows[0];
    expect(night).toMatchObject({ kind: "double", status: "booked", created_by: host.userId, invite_to: friend.userId, venue: DOUBLE_VENUE });
    expect(night.couple_a).toEqual({ character_id: host.id, partner_id: HOUSE_PARTNER_ID });
    expect(night.couple_b).toEqual({ character_id: friend.id, partner_id: houseDate });
    // Each booker paid for and owns its own table, at the booth for four.
    const eps = (await t.db.query<Any>(`select id, creator_id, group_id, setup->>'venue' as venue from episodes`)).rows;
    expect(eps).toHaveLength(2);
    expect(eps.find((e: Any) => e.id === booked.episode_a)!.creator_id).toBe(host.userId);
    expect(eps.find((e: Any) => e.id === booked.episode_b)!.creator_id).toBe(friend.userId);
    expect(eps.every((e: Any) => e.venue === DOUBLE_VENUE && e.group_id === eps[0].group_id)).toBe(true);

    // The host hears who took it (in place of the usual booked notice); the friend gets the usual one.
    const hostNotes = (await t.db.query<Any>(`select title, body, link from notifications where user_id = $1 and kind = 'double_date'`, [host.userId])).rows;
    expect(hostNotes).toHaveLength(1);
    expect(hostNotes[0].title).toMatch(/Pia took your double-date link/);
    expect(hostNotes[0].link).toBe(`/episodes/${booked.episode_a}`);
    const friendNotes = (await t.db.query<Any>(`select title from notifications where user_id = $1 and kind = 'double_date'`, [friend.userId])).rows;
    expect(friendNotes.map((n: Any) => n.title)).toEqual(["💞💞 Your double date is booked"]);
    expect(tracked("double_link_taken")).toEqual([expect.objectContaining({ code: link.code, night: booked.night, new_creator: true })]);

    // Used: one night per link. Taking it again is closed, and a fresh link can be made for the couple.
    expect((await loadDoubleLink(t.db, link.code))!.status).toBe("used");
    const other = await person("Sol Vega");
    expect((await take(link.code, other.cookie, other.id)).status).toBe(404);
    const fresh = (await ensureDoubleLink(t.db, host.userId, host.id, HOUSE_PARTNER_ID)) as Any;
    expect(fresh).toMatchObject({ ok: true, made: true });
    expect(fresh.code).not.toBe(link.code);
  });

  it("refuses: someone else's or a house couple, a private character, your own link, a taken or seated character, and across a block", async () => {
    const host = await person("Juni Marsh");
    const stranger = await person("Pim Alder");
    expect(await ensureDoubleLink(t.db, host.userId, HOUSE_PARTNER_ID, seasonCastIds()[1])).toMatchObject({ ok: false, status: 404 });
    expect(await ensureDoubleLink(t.db, host.userId, stranger.id, HOUSE_PARTNER_ID)).toMatchObject({ ok: false, status: 404 });
    expect(await ensureDoubleLink(t.db, host.userId, host.id, host.id)).toMatchObject({ ok: false, error: "same_character" });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [stranger.id]);
    expect(await ensureDoubleLink(t.db, stranger.userId, stranger.id, HOUSE_PARTNER_ID)).toMatchObject({ ok: false, error: "private" });

    const link = (await ensureDoubleLink(t.db, host.userId, host.id, HOUSE_PARTNER_ID)) as Any;
    const second = await api.createCharacter(validCharacter({ name: "Lotte Hale" }), `bz_uid=${host.userId}`);
    expect(await takeDoubleLink(t.db, host.userId, link.code, ((await second.json()) as Any).id)).toMatchObject({ ok: false, error: "own_link" });

    const friend = await person("Sol Vega");
    // Someone else's character, or one already at the table, can't be brought.
    expect(await takeDoubleLink(t.db, friend.userId, link.code, host.id)).toMatchObject({ ok: false, error: "character_not_found" });
    expect(await takeDoubleLink(t.db, friend.userId, link.code, HOUSE_PARTNER_ID)).toMatchObject({ ok: false, error: "character_not_found" });

    // A block between the two owners: the link reads as closed (never revealing the block), and nothing is made.
    const { episode } = await setupEpisode("friends");
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [host.userId, episode.id, friend.userId]);
    expect(await takeDoubleLink(t.db, friend.userId, link.code, friend.id)).toMatchObject({ ok: false, error: "link_not_found" });
    expect((await t.db.query<Any>(`select count(*)::int as n from group_nights`)).rows[0].n).toBe(0);
    expect((await loadDoubleLink(t.db, link.code))!.status).toBe("open");
  });

  it("checks both sides' dates before anything is made: nothing spent, and the link stays open", async () => {
    const host = await person("Juni Marsh");
    const link = (await ensureDoubleLink(t.db, host.userId, host.id, HOUSE_PARTNER_ID)) as Any;
    const friend = await person("Pia Voss");

    await leaveDates(friend.userId, 0);
    const broke = await take(link.code, friend.cookie, friend.id);
    expect(broke.status).toBe(402);
    expect(((await broke.json()) as Any).message).toMatch(/spends one of your dates, and you have none left/);

    await leaveDates(friend.userId, 1);
    await leaveDates(host.userId, 0);
    const hostBroke = await take(link.code, friend.cookie, friend.id);
    expect(hostBroke.status).toBe(409);
    expect(((await hostBroke.json()) as Any).message).toMatch(/Juni's creator is out of dates/);

    expect((await t.db.query<Any>(`select count(*)::int as n from group_nights`)).rows[0].n).toBe(0);
    expect((await t.db.query<Any>(`select count(*)::int as n from episodes`)).rows[0].n).toBe(0);
    expect((await loadDoubleLink(t.db, link.code))!.status).toBe("open");

    // With a date back on both sides, the same link books.
    await leaveDates(host.userId, 1);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    expect((await take(link.code, friend.cookie, friend.id)).status).toBe(201);
  });

  it("closes when turned off or after LINK_DAYS, and caps how many one person keeps open", async () => {
    const host = await person("Juni Marsh");
    const link = (await ensureDoubleLink(t.db, host.userId, host.id, HOUSE_PARTNER_ID)) as Any;
    const off = await linkRoute(req("/api/double-links", host.cookie, { character_id: host.id, partner_id: HOUSE_PARTNER_ID, revoke: true }));
    expect(off.status).toBe(200);
    expect((await loadDoubleLink(t.db, link.code))!.status).toBe("closed");
    const friend = await person("Pia Voss");
    expect((await take(link.code, friend.cookie, friend.id)).status).toBe(404);

    // A week on, an open link has run out; asking again makes a new one in its place.
    const second = (await ensureDoubleLink(t.db, host.userId, host.id, HOUSE_PARTNER_ID)) as Any;
    const later = new Date(Date.now() + (LINK_DAYS + 1) * 24 * 60 * 60_000);
    expect((await loadDoubleLink(t.db, second.code, later))!.status).toBe("expired");
    const third = (await ensureDoubleLink(t.db, host.userId, host.id, HOUSE_PARTNER_ID, later)) as Any;
    expect(third).toMatchObject({ ok: true, made: true });
    expect(third.code).not.toBe(second.code);

    // At most OPEN_LINKS_MAX open at once.
    const cast = seasonCastIds().filter((id) => id !== HOUSE_PARTNER_ID);
    let refused: Any = null;
    for (let i = 0; i < OPEN_LINKS_MAX + 1 && i < cast.length; i++) {
      const r = (await ensureDoubleLink(t.db, host.userId, host.id, cast[i], later)) as Any;
      if (!r.ok) refused = r;
    }
    expect(refused).toMatchObject({ ok: false, error: "too_many_links" });
  });

  it("an agent's human gets a share link over MCP (double_date share_link, 2.26.0)", async () => {
    expect(MCP_SERVER_INFO.version.localeCompare("2.26.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
    const def = TOOL_DEFS.find((d) => d.name === "double_date")!;
    expect(Object.keys((def.inputSchema as Any).properties)).toContain("share_link");

    const ctx: McpContext = { userAgent: "test-agent/1.0" };
    const send = (method: string, params: Record<string, unknown>) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx) as Promise<Any>;
    await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "double-link-test", version: "1" } });
    const session: McpContext = { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
    const call = async (name: string, args: Record<string, unknown>) =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session)) as Any).result;
    const made = (await call("create_character", validCharacter({ name: "Juni Marsh" }))).structuredContent;
    const r = await call("double_date", { share_link: true, character_id: made.character.id, partner_id: HOUSE_PARTNER_ID, agent_id: made.agent_id });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.share_link).toMatch(/\/double\/[a-z0-9]{12}$/);
    expect(r.structuredContent.note).toMatch(/never post it yourself/);
    const code = r.structuredContent.share_link.split("/").pop();
    expect((await loadDoubleLink(t.db, code))).toMatchObject({ status: "open", created_by: made.agent_id, character_id: made.character.id });
  });
});
