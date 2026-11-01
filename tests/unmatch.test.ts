import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as unmatchRoute } from "@/app/api/matches/route";
import { exportAccount } from "@/lib/account";
import { acceptDateLink, ensureDateLink } from "@/lib/date-invites";
import { proposeDate } from "@/lib/date-proposals";
import { proposeRoleplay } from "@/lib/date-roleplays";
import { listThreads } from "@/lib/inbox";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { Model } from "@/lib/model";
import { previewOwnDate } from "@/lib/own-date";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { createMatch, deckFor, matchView, startMatchChat, swipe } from "@/lib/swipes";
import { sendText } from "@/lib/texting";
import { areUnmatched, unmatch, unmatchedFor } from "@/lib/unmatch";
import { api, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSwipeGateForTests(false); // the shared harness's default
  vi.restoreAllMocks();
});

const rpc = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

/** A person and their character: open to dates, with a dating profile. */
async function person(name: string) {
  const cookie = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name, extras: PROFILE, open_to_dates: true }), cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string, name };
}

/** An agent and its character (made over MCP), open to dates, with a dating profile. */
async function agent(name: string) {
  const made = (await rpc("create_character", { ...validCharacter({ name }), extras: PROFILE, open_to_dates: true })).structuredContent;
  return { userId: made.agent_id as string, id: made.character.id as string, name };
}

/** Both liked: a match, and both said yes to a date. */
async function agree(x: { userId: string; id: string }, y: { userId: string; id: string }) {
  await swipe(t.db, x.userId, x.id, y.id, true);
  await swipe(t.db, y.userId, y.id, x.id, true);
  await t.db.query(`update matches set yes_lo = true, yes_hi = true`);
}

async function book(cookie: string, body: Record<string, unknown>) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode(body, cookie);
  return { status: res.status, body: (await res.json()) as Any };
}

const partnerOf = async (episodeId: string) =>
  (await t.db.query<{ character_b: string }>(`select character_b from episodes where id = $1`, [episodeId])).rows[0].character_b;
const threadsOf = async (userId: string, characterId: string) => {
  const inbox = await listThreads(t.db, userId, characterId);
  return [...(inbox?.fresh ?? []), ...(inbox?.conversations ?? [])].map((th) => th.with.id);
};
/** Unread notices pointing at the pair's thread or couple page. */
const unreadAbout = async (userId: string, x: string, y: string) => {
  const [lo, hi] = x < y ? [x, y] : [y, x];
  return (
    await t.db.query<{ n: number }>(
      `select count(*)::int as n from notifications where user_id = $1 and read_at is null and (starts_with(link, $2) or starts_with(link, $3))`,
      [userId, `/messages/${lo}/${hi}`, `/couples/${lo}/${hi}`],
    )
  ).rows[0].n;
};
const noModel: Model = {
  async complete() {
    throw new Error("an unmatched pair's chat calls no model");
  },
};

describe("unmatching (lib/unmatch.ts)", () => {
  it("either owner ends a match from its thread, for good: it leaves both Matches, its notices are read, and they don't text", async () => {
    const cass = await person("Cass Vega");
    const otto = await person("Otto Fenn");
    await swipe(t.db, cass.userId, cass.id, otto.id, true);
    expect(await swipe(t.db, otto.userId, otto.id, cass.id, true)).toMatchObject({ ok: true, match: expect.any(Object) });
    expect(await sendText(t.db, { userId: cass.userId, from: cass.id, to: otto.id, text: "Old maps, huh? Which one first?" })).toMatchObject({ ok: true });
    expect(await threadsOf(otto.userId, otto.id)).toContain(cass.id);
    expect(await unreadAbout(otto.userId, cass.id, otto.id)).toBeGreaterThan(0);

    // Only one of the two's owners, and only a match.
    const pim = await person("Pim Alder");
    expect(await unmatch(t.db, pim.userId, cass.id, otto.id)).toMatchObject({ ok: false, status: 404, error: "not_your_character" });
    expect(await unmatch(t.db, cass.userId, cass.id, pim.id)).toMatchObject({ ok: false, status: 404, error: "no_match" });

    expect(await unmatch(t.db, otto.userId, otto.id, cass.id)).toEqual({ ok: true, with: { id: cass.id, name: "Cass Vega" } });
    expect(await matchView(t.db, cass.id, otto.id)).toBeNull();
    expect(await areUnmatched(t.db, otto.id, cass.id)).toBe(true);
    expect(await unmatch(t.db, cass.userId, cass.id, otto.id)).toMatchObject({ ok: false, status: 409, error: "already_unmatched" });

    for (const [me, them] of [
      [cass, otto],
      [otto, cass],
    ]) {
      expect(await threadsOf(me.userId, me.id)).not.toContain(them.id);
      expect(await unreadAbout(me.userId, me.id, them.id)).toBe(0);
      expect(await sendText(t.db, { userId: me.userId, from: me.id, to: them.id, text: "Still there?" })).toMatchObject({ ok: false, status: 409, error: "unmatched" });
    }
    expect(await startMatchChat(t.db, cass.id, otto.id, noModel)).toBe(0);

    // An old link to the thread tells each owner from their own side; nobody else.
    expect(await unmatchedFor(t.db, cass.userId, otto.id, cass.id)).toEqual({ self: cass.id, names: ["Cass", "Otto"] });
    expect(await unmatchedFor(t.db, otto.userId, cass.id, otto.id)).toEqual({ self: otto.id, names: ["Otto", "Cass"] });
    expect(await unmatchedFor(t.db, pim.userId, cass.id, otto.id)).toBeNull();
    // It's in both owners' account exports, with whose side ended it.
    for (const me of [cass, otto]) expect((await exportAccount(t.db, me.userId)).unmatches).toEqual([expect.objectContaining({ by_character: otto.id })]);
  });

  it("nothing pairs them again: not the deck, a swipe, a date link, a proposal, a roleplay, nor a booking with or without the gate", async () => {
    const cass = await person("Cass Vega");
    const otto = await person("Otto Fenn");
    await agree(cass, otto);
    // A roleplay waiting for their next date goes with the match.
    expect(await proposeRoleplay(t.db, cass.userId, { character_id: cass.id, with: otto.id, roleplay_id: "castaways" })).toMatchObject({ ok: true });
    expect(await unmatch(t.db, cass.userId, cass.id, otto.id)).toMatchObject({ ok: true });
    expect((await t.db.query<Any>(`select status from date_roleplays`)).rows).toEqual([{ status: "withdrawn" }]);

    for (const [me, them] of [
      [cass, otto],
      [otto, cass],
    ]) {
      const deck = await deckFor(t.db, me.userId, me.id);
      if (!deck.ok) throw new Error(deck.message);
      expect(deck.cards.map((c) => c.id)).not.toContain(them.id);
    }
    await t.db.query(`delete from swipes`); // even with the old swipes gone
    expect(await swipe(t.db, cass.userId, cass.id, otto.id, true)).toMatchObject({ ok: false, error: "not_in_deck", message: expect.stringMatching(/unmatched, and that's for good/) });
    expect(await createMatch(t.db, cass.id, otto.id)).toBeNull();
    const link = await ensureDateLink(t.db, otto.userId, otto.id);
    if (!link.ok) throw new Error(link.message);
    expect(await acceptDateLink(t.db, cass.userId, link.code, cass.id)).toMatchObject({ ok: false, error: "link_not_found" });
    expect(await matchView(t.db, cass.id, otto.id)).toBeNull();

    expect(await proposeDate(t.db, cass.userId, cass.id, otto.id)).toMatchObject({ ok: false, status: 409, error: "unmatched" });
    expect(await proposeRoleplay(t.db, otto.userId, { character_id: otto.id, with: cass.id, roleplay_id: "castaways" })).toMatchObject({ ok: false, status: 409, error: "unmatched" });
    for (const gate of [false, true]) {
      setSwipeGateForTests(gate);
      const date = await book(cass.cookie, { character_id: cass.id, partner_id: otto.id });
      expect(date).toMatchObject({ status: 409, body: { error: "unmatched", message: "Cass and Otto unmatched, so they don't text or go on dates any more." } });
    }
    // A blind date (without the gate, any open character of someone else's) never draws them either.
    setSwipeGateForTests(false);
    const blind = await book(cass.cookie, { character_id: cass.id, blind: true });
    expect(blind.status).toBe(200);
    expect(await partnerOf(blind.body.id)).toBe(HOUSE_PARTNER_ID);
  });

  it("a house character unmatched doesn't date that character again, nor turn up blind; it still dates everyone else", async () => {
    const cass = await person("Cass Vega");
    expect(await swipe(t.db, cass.userId, cass.id, HOUSE_PARTNER_ID, true)).toMatchObject({ ok: true, match: expect.any(Object) }); // likes back at once
    expect(await unmatch(t.db, cass.userId, cass.id, HOUSE_PARTNER_ID)).toMatchObject({ ok: true });
    expect((await book(cass.cookie, { character_id: cass.id, partner_id: HOUSE_PARTNER_ID })).body).toMatchObject({ error: "unmatched" });
    expect(await proposeRoleplay(t.db, cass.userId, { character_id: cass.id, with: HOUSE_PARTNER_ID, roleplay_id: "stowaway" })).toMatchObject({ ok: false, error: "unmatched" });
    // The cast here is that one face, so there's nobody left for a blind date: said, not a crash.
    setSwipeGateForTests(true);
    expect(await book(cass.cookie, { character_id: cass.id, blind: true })).toMatchObject({ status: 422, body: { error: "partner_not_available" } });

    const pim = await person("Pim Alder");
    expect((await book(pim.cookie, { character_id: pim.id, partner_id: HOUSE_PARTNER_ID })).status).toBe(200);
  });

  it("not once they've dated (they're a couple: a block does that), nor while their date is being filmed", async () => {
    const cass = await person("Cass Vega");
    const otto = await person("Otto Fenn");
    await agree(cass, otto);
    const date = await book(cass.cookie, { character_id: cass.id, partner_id: otto.id });
    expect(date.status).toBe(200);
    expect(await unmatch(t.db, otto.userId, otto.id, cass.id)).toMatchObject({ ok: false, status: 409, error: "dated", message: expect.stringMatching(/block from that date's page/) });

    // The same date still being written (generation runs inline here, so it's set back to that).
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [date.body.id]);
    await t.db.query(`delete from relationships`);
    expect(await unmatch(t.db, otto.userId, otto.id, cass.id)).toMatchObject({ ok: false, status: 409, error: "date_booked" });
    expect(await matchView(t.db, cass.id, otto.id)).not.toBeNull();
  });

  it("two agents' characters that unmatched can't perform a date of their own", async () => {
    const a = await agent("Hesper Vale");
    const b = await agent("Brannoch Reed");
    await agree(a, b);
    expect(await unmatch(t.db, b.userId, b.id, a.id)).toMatchObject({ ok: true });
    expect(await previewOwnDate(t.db, a.userId, { character_id: a.id, partner_id: b.id })).toMatchObject({ ok: false, status: 409, error: "unmatched" });
  });

  it("DELETE /api/matches unmatches one of your characters, and nobody else's", async () => {
    const cass = await person("Cass Vega");
    const otto = await person("Otto Fenn");
    await agree(cass, otto);
    const call = (body: unknown, cookie: string) => unmatchRoute(jsonRequest("/api/matches", body, { cookie, method: "DELETE" }));

    expect((await call({ character_id: cass.id }, cass.cookie)).status).toBe(422);
    const theirs = await call({ character_id: otto.id, with: cass.id }, cass.cookie);
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toMatchObject({ error: "not_your_character" });
    const mine = await call({ character_id: cass.id, with: otto.id }, cass.cookie);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ unmatched: { id: otto.id, name: "Otto Fenn" } });
  });
});
