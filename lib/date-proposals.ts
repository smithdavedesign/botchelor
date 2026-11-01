/**
 * The next date, from a couple's page (app/couples/[a]/[b]). An owner of one of the two characters can:
 *
 *   - book their second date, when their last date was mutual (the existing flow, lib/second-date.ts);
 *   - send them on another date straight away, when the other character is a house character (it already dated them)
 *     or open to dates: an ordinary date, with everything they remember of each other;
 *   - propose a date, when the other character belongs to someone else and isn't open to dates. Its owner accepts
 *     (which books it, like any date: whoever completes it pays the token) or says not this time. A proposal lapses
 *     after PROPOSAL_DAYS. One pending proposal per direction; blocks always win.
 *
 * Every booking still goes through POST /api/episodes, so tokens, rate limits, blocks and the one-partner rule hold.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { pairNames, shortName } from "./names";
import { notify } from "./notifications";
import { currentPartners, takenSql } from "./partners";
import { takenMessage, takenNote } from "./partners-shared";
import { haveDated, MATCH_FIRST, swipeGateOn } from "./swipe-gate";
import { areUnmatched, unmatchedMessage } from "./unmatch";
import { dateNotAgreed } from "./swipes";
import { DELETED_OWNER } from "./rules";
import { secondDateState, type SecondDateState } from "./second-date";

export const PROPOSAL_DAYS = 7;
const FRESH = `created_at > now() - interval '${PROPOSAL_DAYS} days'`;

type Char = { id: string; name: string; owner_id: string | null; is_house: boolean; open_to_dates: boolean };

async function chars(db: Db, ids: string[]): Promise<Map<string, Char>> {
  const { rows } = await db.query<Char>(`select id, name, owner_id, is_house, open_to_dates from characters where id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function blockedBetween(db: Db, x: string | null, y: string | null): Promise<boolean> {
  if (!x || !y) return false;
  const { rows } = await db.query(
    `select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`,
    [x, y],
  );
  return rows.length > 0;
}

/** Whether `id` is with someone other than `exceptId` and wants one partner (so it can't date anyone else). */
async function takenElsewhere(db: Db, id: string, exceptId: string): Promise<boolean> {
  const { rows } = await db.query<{ taken: boolean }>(`select ${takenSql("c", "$2")} as taken from characters c where c.id = $1`, [id, exceptId]);
  return rows[0]?.taken === true;
}

export type Proposal = { id: string; from_character: string; to_character: string; from_user: string; to_user: string; created_at: string };

/** The pending, unexpired proposal from one character to another, if any. */
export async function pendingProposal(db: Db, fromId: string, toId: string): Promise<Proposal | null> {
  const { rows } = await db.query<Proposal & { created_at: Date | string }>(
    `select id, from_character, to_character, from_user, to_user, created_at from date_proposals
      where from_character = $1 and to_character = $2 and status = 'pending' and ${FRESH}`,
    [fromId, toId],
  );
  const r = rows[0];
  return r ? { ...r, created_at: new Date(r.created_at).toISOString() } : null;
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; status: number; error: string; message: string };

/** Proposes a date between the user's character and another owner's character that isn't open to dates. */
export async function proposeDate(db: Db, userId: string, fromId: string, toId: string): Promise<ProposalResult> {
  const no = (status: number, error: string, message: string): ProposalResult => ({ ok: false, status, error, message });
  const cs = await chars(db, [fromId, toId]);
  const from = cs.get(fromId);
  const to = cs.get(toId);
  if (!from || from.owner_id !== userId || from.is_house) return no(404, "character_not_found", "Pick one of your own characters.");
  if (!to) return no(404, "partner_not_found", "That character isn't here any more.");
  if (await areUnmatched(db, fromId, toId)) return no(409, "unmatched", unmatchedMessage(...pairNames(from.name, to.name)));
  // Behind the swipe gate (lib/swipe-gate.ts), a proposal is for a couple who've dated: a first date starts with a match.
  if (!to.is_house && swipeGateOn() && !(await haveDated(db, fromId, toId))) {
    // #618 (the 2026-10-21-2300 run): a pair that has matched hears where it stands, not "match first".
    const state = await dateNotAgreed(db, from, to, pairNames(from.name, to.name));
    if (!state) return no(409, "just_book", `${shortName(from.name)} and ${shortName(to.name)} both said yes to a date: no proposal needed, book it straight away.`);
    if (state.status !== "not_matched") return no(409, "match_first", `A proposal is for a couple who've dated. ${state.message}`);
    return no(409, "match_first", `${shortName(from.name)} and ${shortName(to.name)} haven't dated yet. ${MATCH_FIRST}`);
  }
  if (to.is_house || to.open_to_dates) return no(409, "just_book", `${shortName(to.name)} is open to dates: you can book one straight away.`);
  if (!to.owner_id || to.owner_id === DELETED_OWNER) return no(409, "partner_gone", "That character's creator has left the show.");
  if (to.owner_id === userId) return no(409, "your_own", "Both characters are yours: there's no one to ask.");
  if (await blockedBetween(db, userId, to.owner_id)) return no(409, "match_unavailable", "That match is no longer available.");
  if (await takenElsewhere(db, toId, fromId)) return no(409, "taken", takenMessage(shortName(to.name), { mine: false }));
  if (await pendingProposal(db, toId, fromId)) {
    return no(409, "they_proposed", `${shortName(to.name)}'s creator already proposed a date: accept theirs to book it.`);
  }
  // A lapsed proposal frees the slot for a new one.
  await db.query(`update date_proposals set status = 'expired', decided_at = now() where from_character = $1 and to_character = $2 and status = 'pending' and not (${FRESH})`, [fromId, toId]);
  const id = randomUUID();
  const inserted = await db.query(
    `insert into date_proposals (id, from_user, from_character, to_character, to_user) values ($1, $2, $3, $4, $5)
     on conflict do nothing returning id`,
    [id, userId, fromId, toId, to.owner_id],
  );
  if (!inserted.rows.length) return no(409, "already_proposed", "You've already proposed this date. Their creator has a week to answer.");
  const [lo, hi] = fromId < toId ? [fromId, toId] : [toId, fromId];
  await notify(db, to.owner_id, {
    kind: "date_proposal",
    title: `💌 ${shortName(from.name)} wants a date with ${shortName(to.name)}`,
    // 2.4.3: who started it and who performs it.
    body: `Started by ${shortName(from.name)}'s creator (they proposed it). Accept and it's booked (1 token, like any date): the show's model performs both sides, ${shortName(from.name)} and ${shortName(to.name)}. Or say not this time.`,
    link: `/couples/${lo}/${hi}`,
  });
  return { ok: true, proposal: (await pendingProposal(db, fromId, toId))! };
}

/** The receiving owner says not this time ("declined"), or the proposing owner takes it back ("cancelled"); null if neither. */
export async function closeProposal(db: Db, userId: string, proposalId: string): Promise<"declined" | "cancelled" | null> {
  const { rows } = await db.query<{ status: "declined" | "cancelled"; from_user: string; from_character: string; to_character: string }>(
    `update date_proposals
        set status = case when to_user = $2 then 'declined' else 'cancelled' end, decided_at = now()
      where id = $1 and status = 'pending' and (to_user = $2 or from_user = $2)
      returning status, from_user, from_character, to_character`,
    [proposalId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.status === "declined") {
    const cs = await chars(db, [r.from_character, r.to_character]);
    const [lo, hi] = r.from_character < r.to_character ? [r.from_character, r.to_character] : [r.to_character, r.from_character];
    await notify(db, r.from_user, {
      kind: "date_proposal_declined",
      title: `${shortName(cs.get(r.to_character)?.name)}'s creator said not this time`,
      body: `No date with ${shortName(cs.get(r.from_character)?.name)} for now. You can propose again later.`,
      link: `/couples/${lo}/${hi}`,
    });
  }
  return r.status;
}

/** For the date route: the pending proposal this user may accept by booking (their character `ownId`, from `partnerId`). */
export async function acceptableProposal(db: Db, userId: string, proposalId: string, ownId: string, partnerId: string): Promise<Proposal | null> {
  const p = await pendingProposal(db, partnerId, ownId);
  return p && p.id === proposalId && p.to_user === userId ? p : null;
}

/** Marks a proposal accepted once its date is booked, and tells the proposing owner. */
export async function markAccepted(db: Db, proposal: Proposal, episodeId: string): Promise<void> {
  await db.query(`update date_proposals set status = 'accepted', decided_at = now(), episode_id = $2 where id = $1 and status = 'pending'`, [proposal.id, episodeId]);
  const cs = await chars(db, [proposal.from_character, proposal.to_character]);
  await notify(db, proposal.from_user, {
    kind: "date_accepted",
    title: `💞 ${shortName(cs.get(proposal.to_character)?.name)}'s creator said yes: the date with ${shortName(cs.get(proposal.from_character)?.name)} is on`,
    body: null,
    link: `/episodes/${episodeId}`,
  });
}

/* ------------------------------------------------- the next date ------------------------------------------------- */

export type NextDate = {
  /** The viewer's character in the pair, and the other one. */
  mine: { id: string; name: string };
  them: { id: string; name: string; house: boolean };
  /** The latest date of theirs the viewer can see, and the plan they made after it (both sides' plan-like texts). */
  last_episode_id: string | null;
  plan: string[];
  /** Where their next date will be, when the plan is one they agreed to by text (lib/plans.ts): booking it goes there. */
  plan_place: string | null;
  option:
    | { kind: "second_date"; state: SecondDateState }
    | { kind: "planned"; episode_id: string }
    | { kind: "date"; after: "not_mutual" | "not_ready" | "none" }
    | { kind: "propose"; mine_pending: Proposal | null; theirs_pending: Proposal | null }
    | { kind: "unavailable"; message: string; /** One of the viewer's own is with someone else: whose page changes it. */ taken?: { id: string; partner: { id: string; name: string } | null } };
};

/**
 * What an owner can do next for this couple, from their page. Null for a viewer who owns neither character.
 * `lastEpisodeId`/`plan` come from the viewer's view of the relationship (their latest visible date).
 */
export async function nextDate(
  db: Db,
  viewerId: string | null,
  x: string,
  y: string,
  lastEpisodeId: string | null,
  plan: string[],
  planPlace: string | null = null,
): Promise<NextDate | null> {
  if (!viewerId) return null;
  const cs = await chars(db, [x, y]);
  const [cx, cy] = [cs.get(x), cs.get(y)];
  if (!cx || !cy) return null;
  const mine = cx.owner_id === viewerId && !cx.is_house ? cx : cy.owner_id === viewerId && !cy.is_house ? cy : null;
  if (!mine) return null;
  const them = mine === cx ? cy : cx;
  const base = { mine: { id: mine.id, name: mine.name }, them: { id: them.id, name: them.name, house: them.is_house }, last_episode_id: lastEpisodeId, plan, plan_place: planPlace };

  // Theirs to book is with someone else and wants only them (lib/partners.ts): no date with this one until it cools
  // off, or until its owner opens it to more than one. Said first: any date here would be refused.
  if (await takenElsewhere(db, mine.id, them.id)) {
    const [withWhom] = await currentPartners(db, mine.id);
    return { ...base, option: { kind: "unavailable", message: takenNote(shortName(mine.name), withWhom?.name ?? null), taken: { id: mine.id, partner: withWhom ?? null } } };
  }

  // A proposal from them waiting on this owner comes first: that's the thing to answer.
  const theirs = await pendingProposal(db, them.id, mine.id);
  if (theirs) return { ...base, option: { kind: "propose", mine_pending: null, theirs_pending: theirs } };

  let after: "not_mutual" | "not_ready" | "none" = "none";
  if (lastEpisodeId) {
    const state = await secondDateState(db, lastEpisodeId, viewerId);
    if (state?.reason === "planned" && state.planned_episode_id) return { ...base, option: { kind: "planned", episode_id: state.planned_episode_id } };
    if (state?.can_plan) return { ...base, option: { kind: "second_date", state } };
    if (state?.reason === "blocked") return { ...base, option: { kind: "unavailable", message: "That match is no longer available." } };
    if (state?.reason === "partner_gone") return { ...base, option: { kind: "unavailable", message: `${shortName(them.name)}'s creator has left the show.` } };
    after = state?.reason === "not_ready" ? "not_ready" : "not_mutual";
  }

  if (them.owner_id === viewerId) {
    return { ...base, option: { kind: "unavailable", message: "Both characters are yours: book their next date from their last date's afterglow." } };
  }
  if (!them.is_house && (await blockedBetween(db, viewerId, them.owner_id))) {
    return { ...base, option: { kind: "unavailable", message: "That match is no longer available." } };
  }
  if (!them.is_house && (await takenElsewhere(db, them.id, mine.id))) {
    return { ...base, option: { kind: "unavailable", message: takenMessage(shortName(them.name), { mine: false }) } };
  }
  if (them.is_house || them.open_to_dates) return { ...base, option: { kind: "date", after } };
  if (!them.owner_id || them.owner_id === DELETED_OWNER) {
    return { ...base, option: { kind: "unavailable", message: `${shortName(them.name)}'s creator has left the show.` } };
  }
  return { ...base, option: { kind: "propose", mine_pending: await pendingProposal(db, mine.id, them.id), theirs_pending: null } };
}
