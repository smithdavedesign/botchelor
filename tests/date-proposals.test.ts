import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as closeProposalRoute, POST as proposeRoute } from "@/app/api/couples/[a]/[b]/proposal/route";
import { nextDate, proposeDate } from "@/lib/date-proposals";
import type { SideOutcome } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage } from "@/lib/mcp";
import { listNotifications } from "@/lib/notifications";
import { pairKey } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
const WHOLE_ROSTER = HOUSE_CHARACTERS.map((c) => c.id); // what the test harness deals (tests/helpers.ts)
afterAll(async () => {
  setSeasonCastForTests(WHOLE_ROSTER);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests(WHOLE_ROSTER);
});

async function date(own: string, partner: string, cookie: string, wants: [boolean, boolean], extra: Any = {}) {
  scriptOutcome({ ending: wants[0] && wants[1] ? "second_date" : "friends", sides: [side(wants[0]), side(wants[1])] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: own, partner_id: partner, ...extra }, cookie);
  return { status: res.status, body: (await res.json()) as Any };
}
const couple = (x: string, y: string) => pairKey(x, y);
const propose = async (x: string, y: string, cookie: string, character_id: string) => {
  const [a, b] = couple(x, y);
  const res = await proposeRoute(new Request(`${BASE_URL}/api/couples/${a}/${b}/proposal`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ character_id }) }), { params: Promise.resolve({ a, b }) });
  return { status: res.status, body: (await res.json()) as Any };
};
const close = async (x: string, y: string, cookie: string, proposal_id: string) => {
  const [a, b] = couple(x, y);
  const res = await closeProposalRoute(new Request(`${BASE_URL}/api/couples/${a}/${b}/proposal`, { method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ proposal_id }) }));
  return { status: res.status, body: (await res.json()) as Any };
};

describe("the next date, from a couple's page", () => {
  it("after a mutual date it's their second date; after one that wasn't, another date with a house character", async () => {
    const me = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const first = await date(cass.id, HOUSE_PARTNER_ID, me, [true, true]);
    let next = (await nextDate(t.db, userIdOf(me), cass.id, HOUSE_PARTNER_ID, first.body.id, []))!;
    expect(next.option.kind).toBe("second_date");
    expect(next.mine.id).toBe(cass.id);

    const meh = await date(cass.id, HOUSE_PARTNER_ID, me, [true, false]);
    next = (await nextDate(t.db, userIdOf(me), cass.id, HOUSE_PARTNER_ID, meh.body.id, []))!;
    expect(next.option).toEqual({ kind: "date", after: "not_mutual" });
    expect(await nextDate(t.db, userIdOf(newUserCookie()), cass.id, HOUSE_PARTNER_ID, meh.body.id, [])).toBeNull(); // not an owner
  });

  it("a couple can always meet again: a house character they've dated is bookable even off this week's cast", async () => {
    const me = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const other = HOUSE_CHARACTERS.find((h) => h.id !== HOUSE_PARTNER_ID)!.id;
    setSeasonCastForTests([HOUSE_PARTNER_ID, other]);
    expect((await date(cass.id, other, me, [true, false])).status).toBe(200);

    setSeasonCastForTests([HOUSE_PARTNER_ID, HOUSE_CHARACTERS.find((h) => h.id !== HOUSE_PARTNER_ID && h.id !== other)!.id]);
    expect((await date(cass.id, other, me, [true, false])).status).toBe(200); // dated before: still bookable
    const stranger = HOUSE_CHARACTERS.find((h) => ![HOUSE_PARTNER_ID, other].includes(h.id))!.id;
    if (stranger !== HOUSE_CHARACTERS.find((h) => h.id !== HOUSE_PARTNER_ID && h.id !== other)!.id) {
      expect((await date(cass.id, stranger, me, [true, false])).status).toBe(422); // never met, not on the show this week
    }
  });
});

describe("proposing a date to another owner's character", () => {
  async function twoOwners() {
    const me = newUserCookie();
    const them = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const otto = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), them)).json();
    return { me, them, cass, otto };
  }

  it("a closed character can't be booked, only proposed to; accepting books it and tells the proposer", async () => {
    const { me, them, cass, otto } = await twoOwners();
    expect((await date(cass.id, otto.id, me, [true, true])).status).toBe(422); // not open to dates

    let next = (await nextDate(t.db, userIdOf(me), cass.id, otto.id, null, []))!;
    expect(next.option).toMatchObject({ kind: "propose", mine_pending: null, theirs_pending: null });

    const sent = await propose(cass.id, otto.id, me, cass.id);
    expect(sent.status).toBe(201);
    expect((await propose(cass.id, otto.id, me, cass.id)).body.error).toBe("already_proposed");
    const inbox = await listNotifications(t.db, userIdOf(them));
    expect(inbox[0]).toMatchObject({ kind: "date_proposal", title: "💌 Cass wants a date with Otto" });

    next = (await nextDate(t.db, userIdOf(me), cass.id, otto.id, null, []))!;
    expect(next.option).toMatchObject({ kind: "propose", mine_pending: { id: sent.body.proposal.id } });
    const theirs = (await nextDate(t.db, userIdOf(them), cass.id, otto.id, null, []))!;
    expect(theirs.mine.id).toBe(otto.id);
    expect(theirs.option).toMatchObject({ kind: "propose", theirs_pending: { id: sent.body.proposal.id } });

    // Someone else can't use the proposal, and a wrong id is refused before anything is booked.
    const outsider = newUserCookie();
    const ines = await (await api.createCharacter(validCharacter({ name: "Ines Alvarez" }), outsider)).json();
    expect((await date(ines.id, cass.id, outsider, [true, true], { proposal_id: sent.body.proposal.id })).status).toBe(409);
    expect((await date(otto.id, cass.id, them, [true, true], { proposal_id: "nope" })).status).toBe(409);

    const booked = await date(otto.id, cass.id, them, [true, true], { proposal_id: sent.body.proposal.id });
    expect(booked.status).toBe(200);
    const row = (await t.db.query<Any>(`select status, episode_id from date_proposals where id = $1`, [sent.body.proposal.id])).rows[0];
    expect(row).toEqual({ status: "accepted", episode_id: booked.body.id });
    expect((await listNotifications(t.db, userIdOf(me)))[0]).toMatchObject({ kind: "date_accepted", link: `/episodes/${booked.body.id}` });
    // Accepted is used up.
    expect((await date(otto.id, cass.id, them, [true, true], { proposal_id: sent.body.proposal.id })).status).toBe(409);
  });

  it("the other owner can say not this time, and the proposer can take it back", async () => {
    const { me, them, cass, otto } = await twoOwners();
    const sent = await propose(cass.id, otto.id, me, cass.id);
    expect((await close(cass.id, otto.id, newUserCookie(), sent.body.proposal.id)).status).toBe(409); // not theirs
    expect((await close(cass.id, otto.id, them, sent.body.proposal.id)).body.status).toBe("declined");
    expect((await listNotifications(t.db, userIdOf(me)))[0]).toMatchObject({ kind: "date_proposal_declined" });

    const again = await propose(cass.id, otto.id, me, cass.id);
    expect(again.status).toBe(201);
    expect((await close(cass.id, otto.id, me, again.body.proposal.id)).body.status).toBe("cancelled");
    expect((await nextDate(t.db, userIdOf(them), cass.id, otto.id, null, []))!.option).toMatchObject({ kind: "propose", theirs_pending: null });
  });

  it("only to a closed character someone else owns; never across a block; not your own pair twice", async () => {
    const { me, them, cass, otto } = await twoOwners();
    // Open to dates: just book it.
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [otto.id]);
    expect((await proposeDate(t.db, userIdOf(me), cass.id, otto.id))).toMatchObject({ ok: false, error: "just_book" });
    expect((await nextDate(t.db, userIdOf(me), cass.id, otto.id, null, []))!.option).toEqual({ kind: "date", after: "none" });
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [otto.id]);
    // Not someone else's character to propose with, and a house character can be booked directly.
    expect((await proposeDate(t.db, userIdOf(them), cass.id, otto.id))).toMatchObject({ ok: false, error: "character_not_found" });
    expect((await proposeDate(t.db, userIdOf(me), cass.id, HOUSE_PARTNER_ID))).toMatchObject({ ok: false, error: "just_book" });
    // They already proposed: accept theirs.
    expect((await proposeDate(t.db, userIdOf(them), otto.id, cass.id)).ok).toBe(true);
    expect((await proposeDate(t.db, userIdOf(me), cass.id, otto.id))).toMatchObject({ ok: false, error: "they_proposed" });
    // A block between the owners wins.
    const ep = await date(cass.id, HOUSE_PARTNER_ID, me, [true, false]);
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [userIdOf(them), ep.body.id, userIdOf(me)]);
    const fresh = newUserCookie();
    const nell = await (await api.createCharacter(validCharacter({ name: "Nell Park" }), fresh)).json();
    expect((await proposeDate(t.db, userIdOf(fresh), nell.id, otto.id)).ok).toBe(true); // others still can
    await t.db.query(`delete from date_proposals`);
    expect((await proposeDate(t.db, userIdOf(me), cass.id, otto.id))).toMatchObject({ ok: false, error: "match_unavailable" });
    expect((await nextDate(t.db, userIdOf(me), cass.id, otto.id, null, []))!.option.kind).toBe("unavailable");
  });
});

describe("agents propose and answer dates too", () => {
  const tool = async (name: string, args: Any) => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as Any;
    return res.result as Any;
  };

  it("propose_date, then answer_date_proposal books it", async () => {
    const me = newUserCookie();
    const them = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const otto = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), them)).json();
    const sent = await tool("propose_date", { character_id: cass.id, with: otto.id, agent_id: userIdOf(me) });
    expect(sent.isError).toBeFalsy();
    expect(sent.structuredContent.proposal.status).toBe("pending");
    expect((await tool("answer_date_proposal", { character_id: cass.id, with: otto.id, accept: true, agent_id: userIdOf(me) })).isError).toBe(true);

    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const booked = await tool("answer_date_proposal", { character_id: otto.id, with: cass.id, accept: true, agent_id: userIdOf(them) });
    expect(booked.isError).toBeFalsy();
    expect(booked.structuredContent.episode.id).toBeTruthy();
    expect((await t.db.query<Any>(`select status from date_proposals`)).rows[0].status).toBe("accepted");
  });
});
