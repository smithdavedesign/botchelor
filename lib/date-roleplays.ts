/**
 * Agreeing on a roleplay for a couple's next date (David, 2026-10-31: "allow users to agree on roleplay. if it's two
 * humans they both need to approve as one can propose the idea. human character with ai is immediately approved. and
 * agent to agent add to the mcp and let them deliberate").
 *
 *   - One owner proposes a roleplay (the show's, lib/roleplays.ts, or one written for the date) and which role their
 *     character plays, with an optional note. The other character's owner agrees, says not this time, or answers with
 *     other terms (a counter), which the first owner then answers: back and forth up to ROLEPLAY_ROUNDS, people on the
 *     couple page and agents over MCP (propose_roleplay, answer_roleplay, my_roleplays).
 *   - The show's own side agrees at once: a house character, a house-run bot's character, or a pair that's both the
 *     booker's. Nobody else has a say, so the proposal is agreed as it's made.
 *   - Once agreed it plays on the pair's next date, whoever books it and however (the show's model, a date agents perform,
 *     a second date, an accepted proposal): roleplayForBooking snapshots it on the date (DateSetup.roleplay.agreed_id),
 *     and that date being written is what uses it up. Either owner can call it off until then. A booking can skip it
 *     (roleplay "none"), which leaves it for the date after.
 *
 * One live roleplay per pair (pending or agreed). A proposal lapses after ROLEPLAY_PROPOSAL_DAYS, an unused agreement
 * after ROLEPLAY_AGREED_DAYS. Blocks always win. The roleplay is framing: the engine decides how the date ends, as ever.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { isHouseBotAgent } from "./house-bots";
import { pairNames, shortName } from "./names";
import { notify } from "./notifications";
import { DELETED_OWNER } from "./rules";
import { checkShowText, excludedTheme } from "./safety";
import { haveDated, swipeGateOn } from "./swipe-gate";
import {
  DATE_ROLEPLAY_NEVER,
  dateRoleplayById,
  fillPremise,
  ROLEPLAY_ANSWERS,
  ROLEPLAY_NOTE_MAX,
  ROLEPLAY_PREMISE_MAX,
  ROLEPLAY_ROLE_MAX,
  ROLEPLAY_TITLE_MAX,
  roleIndex,
  rolesLine,
  sameTerms,
  termsFor,
  type DateRoleplay,
  type RoleplayTerms,
} from "./roleplays";

export const ROLEPLAY_PROPOSAL_DAYS = 7;
export const ROLEPLAY_AGREED_DAYS = 30;
/** A proposal and its counters: after this many rounds the last one can only be agreed to or declined. */
export const ROLEPLAY_ROUNDS = 6;

type Char = { id: string; name: string; owner_id: string | null; is_house: boolean; open_to_dates: boolean };
type Row = {
  id: string;
  character_lo: string;
  character_hi: string;
  proposed_by: string;
  proposer_user: string;
  answerer_user: string | null;
  terms: RoleplayTerms;
  note: string | null;
  counter_of: string | null;
  round: number;
  status: "pending" | "agreed" | "declined" | "countered" | "withdrawn" | "expired" | "used";
  created_at: Date | string;
  decided_at: Date | string | null;
};

const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const DAY = 86_400_000;

async function chars(db: Db, ids: string[]): Promise<Map<string, Char>> {
  const { rows } = await db.query<Char>(`select id, name, owner_id, is_house, open_to_dates from characters where id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function blockedBetween(db: Db, x: string | null, y: string | null): Promise<boolean> {
  if (!x || !y || x === y) return false;
  const { rows } = await db.query(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [x, y]);
  return rows.length > 0;
}

/**
 * Whether the other side is the show's own, or the booker's: a house character, a house-run bot's (one of the show's
 * scripts), or both characters theirs. Then nobody else has a say, and a roleplay is agreed as it's proposed.
 */
export async function agreesAtOnce(db: Db, userId: string, partner: Pick<Char, "is_house" | "owner_id">): Promise<boolean> {
  if (partner.is_house || partner.owner_id === userId) return true;
  return isHouseBotAgent(db, partner.owner_id).catch(() => false);
}

/** Lapsed proposals and agreements expire; an agreement a written date played is used. Lazy: run before every read. */
async function settle(db: Db, lo: string, hi: string): Promise<void> {
  await db.query(
    `update date_roleplays set status = 'expired', decided_at = now()
      where character_lo = $1 and character_hi = $2
        and ((status = 'pending' and created_at < now() - interval '${ROLEPLAY_PROPOSAL_DAYS} days')
          or (status = 'agreed' and decided_at < now() - interval '${ROLEPLAY_AGREED_DAYS} days'))`,
    [lo, hi],
  );
  // Used once a date that played it is written. A date still being written (or performed) holds it, and a date that
  // failed and was removed frees it again: that's why it isn't marked at booking.
  await db.query(
    `update date_roleplays r set status = 'used', episode_id = e.id, decided_at = coalesce(r.decided_at, now())
       from episodes e
      where r.character_lo = $1 and r.character_hi = $2 and r.status = 'agreed' and e.status = 'ready'
        and e.setup->'roleplay'->>'agreed_id' = r.id
        and ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))`,
    [lo, hi],
  );
}

async function liveRow(db: Db, x: string, y: string): Promise<Row | null> {
  const [lo, hi] = pairOf(x, y);
  await settle(db, lo, hi);
  const { rows } = await db.query<Row>(`select * from date_roleplays where character_lo = $1 and character_hi = $2 and status in ('pending', 'agreed') limit 1`, [lo, hi]);
  return rows[0] ?? null;
}

/* ---------------------------------------------------- the view ---------------------------------------------------- */

export type RoleplayView = {
  id: string;
  status: "pending" | "agreed";
  /** The show's id, or "custom"; with its title, icon, roles and who plays roles[0] (`first`). */
  terms: RoleplayTerms;
  /** The premise in their names, and who plays whom ("Ana plays the captain, Ben the stowaway"), or null without roles. */
  premise: string;
  roles_line: string | null;
  note: string | null;
  round: number;
  rounds_left: number;
  proposed_by: { id: string; name: string };
  /** The viewer proposed this round. */
  from_you: boolean;
  /** It waits on the viewer: agree, counter or decline. */
  your_move: boolean;
  /** Agreed at once: the other side is the show's own, or both characters are the booker's. */
  auto: boolean;
  /** A date that plays it is being written or performed right now. */
  playing_now: string | null;
  created_at: string;
  decided_at: string | null;
  /** When it lapses unanswered (pending) or unused (agreed). */
  lapses_at: string;
  /** The rounds before this one, oldest first: who proposed what, and the note that came with it. */
  earlier: { by: string; title: string; note: string | null }[];
};

async function viewOf(db: Db, row: Row, viewerId: string | null, cast: Map<string, Char>): Promise<RoleplayView> {
  const two = [row.character_lo, row.character_hi].map((id) => ({ id, name: cast.get(id)?.name ?? "" }));
  const proposer = cast.get(row.proposed_by);
  const earlier: { by: string; title: string; note: string | null }[] = [];
  for (let at = row.counter_of, guard = 0; at && guard < ROLEPLAY_ROUNDS; guard++) {
    const prev = (await db.query<Row>(`select * from date_roleplays where id = $1`, [at])).rows[0];
    if (!prev) break;
    earlier.unshift({ by: shortName(cast.get(prev.proposed_by)?.name ?? ""), title: prev.terms.title, note: prev.note });
    at = prev.counter_of;
  }
  const playing = row.status === "agreed"
    ? (
        await db.query<{ id: string }>(
          `select id from episodes where status = 'generating' and setup->'roleplay'->>'agreed_id' = $1 limit 1`,
          [row.id],
        )
      ).rows[0]?.id ?? null
    : null;
  const lapses = row.status === "pending" ? new Date(row.created_at).getTime() + ROLEPLAY_PROPOSAL_DAYS * DAY : new Date(row.decided_at ?? row.created_at).getTime() + ROLEPLAY_AGREED_DAYS * DAY;
  return {
    id: row.id,
    status: row.status as "pending" | "agreed",
    terms: row.terms,
    premise: fillPremise(row.terms, two),
    roles_line: rolesLine(row.terms, two),
    note: row.note,
    round: row.round,
    rounds_left: Math.max(0, ROLEPLAY_ROUNDS - row.round),
    proposed_by: { id: row.proposed_by, name: proposer?.name ?? "" },
    from_you: viewerId !== null && row.proposer_user === viewerId,
    your_move: viewerId !== null && row.status === "pending" && row.answerer_user === viewerId,
    auto: row.answerer_user === null,
    playing_now: playing,
    created_at: iso(row.created_at)!,
    decided_at: iso(row.decided_at),
    lapses_at: new Date(lapses).toISOString(),
    earlier,
  };
}

/** The pair's live roleplay (proposed or agreed) as an owner sees it; null for anyone who owns neither, or when none. */
export async function pairRoleplay(db: Db, viewerId: string | null, x: string, y: string): Promise<RoleplayView | null> {
  if (!viewerId) return null;
  const cast = await chars(db, [x, y]);
  if (![...cast.values()].some((c) => c.owner_id === viewerId && !c.is_house)) return null;
  const row = await liveRow(db, x, y);
  return row ? viewOf(db, row, viewerId, cast) : null;
}

/* ---------------------------------------------------- the terms ---------------------------------------------------- */

export type TermsInput = {
  /** One of the show's (DATE_ROLEPLAYS); or `custom` instead. */
  roleplay_id?: string | null;
  /** One written for this date: checked like everything the show airs. */
  custom?: { title?: unknown; premise?: unknown; roles?: unknown } | null;
  /** Which role the proposing side's character plays: 0/1, "first"/"second", or the role's words. Left out: the first. */
  my_role?: unknown;
};

/** A roleplay written for a date: PG, adults, no real people, and none of the never-list. Null when it's fine. */
export function checkCustomRoleplay(t: { title: string; premise: string; roles: [string, string] | null }): string | null {
  const fields = { title: t.title, premise: t.premise, ...(t.roles ? { role_a: t.roles[0], role_b: t.roles[1] } : {}) };
  const r = checkShowText(fields);
  if (!r.ok) {
    return r.reason === "minor"
      ? "That roleplay can't be used: everyone in it is an adult, with nothing suggesting otherwise."
      : r.reason === "real_person"
        ? "That roleplay can't be used: no real or famous people (made-up ones are fine)."
        : "That roleplay can't be used: the show is PG, so nothing sexual and no innuendo.";
  }
  const all = Object.values(fields).join(" ");
  if (excludedTheme(all) || DATE_ROLEPLAY_NEVER.test(all)) {
    return "That roleplay can't be used: two adults who both want to be there, never family, school or a babysitter, nobody with a say over the other's job, and nobody drunk, trapped or kept from saying no.";
  }
  return null;
}

type TermsResult = { ok: true; terms: RoleplayTerms } | { ok: false; status: number; error: string; message: string };

/** The terms an input names, from `meId`'s side (my_role is theirs); a refusal says what was wrong. */
export function resolveTerms(input: TermsInput, meId: string, themId: string): TermsResult {
  const no = (status: number, error: string, message: string): TermsResult => ({ ok: false, status, error, message });
  const firstOf = (roles: readonly [string, string] | null): string | null => {
    if (!roles) return meId;
    if (input.my_role === undefined || input.my_role === null || input.my_role === "") return meId;
    const i = roleIndex(roles, input.my_role);
    if (i === null) return null;
    return i === 0 ? meId : themId;
  };
  if (input.custom && typeof input.custom === "object") {
    const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
    const title = clean(input.custom.title, ROLEPLAY_TITLE_MAX);
    const premise = clean(input.custom.premise, ROLEPLAY_PREMISE_MAX);
    const raw = Array.isArray(input.custom.roles) ? input.custom.roles : null;
    const roles = raw && clean(raw[0], ROLEPLAY_ROLE_MAX) && clean(raw[1], ROLEPLAY_ROLE_MAX) ? ([clean(raw[0], ROLEPLAY_ROLE_MAX), clean(raw[1], ROLEPLAY_ROLE_MAX)] as [string, string]) : null;
    if (!title || premise.length < 20) return no(422, "invalid_roleplay", `A roleplay of your own needs a title and a premise of at least 20 characters (who the two of them are to each other tonight; up to ${ROLEPLAY_PREMISE_MAX}).`);
    const wrong = checkCustomRoleplay({ title, premise, roles });
    if (wrong) return no(422, "roleplay_not_allowed", wrong);
    const first = firstOf(roles);
    if (!first) return no(422, "invalid_role", `my_role names neither role: "${roles![0]}" or "${roles![1]}" (or 0/1).`);
    return { ok: true, terms: { id: "custom", title, icon: "✨", premise, roles, first } };
  }
  const def = dateRoleplayById(typeof input.roleplay_id === "string" ? input.roleplay_id.trim() : null);
  if (!def) return no(422, "unknown_roleplay", "Name one of the show's roleplays by its id (my_roleplays with catalog: true lists them), or write your own with custom: { title, premise, roles? }.");
  const first = firstOf(def.roles);
  if (!first) return no(422, "invalid_role", `my_role names neither role in "${def.title}": "${def.roles![0]}" or "${def.roles![1]}" (or 0/1).`);
  return { ok: true, terms: termsFor(def, first) };
}

function checkNote(raw: unknown): { ok: true; note: string | null } | { ok: false; message: string } {
  const note = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, ROLEPLAY_NOTE_MAX) : "";
  if (!note) return { ok: true, note: null };
  return checkShowText({ note }).ok ? { ok: true, note } : { ok: false, message: "Keep the note PG: no real people, minors or anything sexual." };
}

/* ---------------------------------------------------- proposing ---------------------------------------------------- */

export type RoleplayResult = { ok: true; roleplay: RoleplayView } | { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): RoleplayResult => ({ ok: false, status, error, message });

/**
 * Whether these two can talk roleplay at all: a couple who've dated, a match, or (without the swipe gate) a character
 * that's open to dates. The same pairs that could have a date; nobody can be sent proposals out of the blue.
 */
async function canTalk(db: Db, mine: Char, them: Char): Promise<boolean> {
  if (await haveDated(db, mine.id, them.id)) return true;
  const [lo, hi] = pairOf(mine.id, them.id);
  if ((await db.query(`select 1 from matches where character_lo = $1 and character_hi = $2`, [lo, hi])).rows.length) return true;
  return !swipeGateOn() && them.open_to_dates;
}

/**
 * Proposes a roleplay for the pair's next date: from one of the user's characters to the other one. Agreed at once when
 * the other side is the show's own or the user's; otherwise its owner is told and answers.
 */
export async function proposeRoleplay(
  db: Db,
  userId: string,
  input: TermsInput & { character_id: string; with: string; note?: unknown },
): Promise<RoleplayResult> {
  const cast = await chars(db, [input.character_id, input.with]);
  const mine = cast.get(input.character_id);
  const them = cast.get(input.with);
  if (!mine || mine.owner_id !== userId || mine.is_house) return refuse(404, "character_not_found", "Pick one of your own characters.");
  if (!them || them.id === mine.id) return refuse(404, "partner_not_found", "That character isn't here any more.");
  const auto = await agreesAtOnce(db, userId, them);
  const live = await liveRow(db, mine.id, them.id);
  if (!auto) {
    if (!them.owner_id || them.owner_id === DELETED_OWNER) return refuse(409, "partner_gone", `${shortName(them.name)}'s creator has left the show.`);
    if (await blockedBetween(db, userId, them.owner_id)) return refuse(409, "match_unavailable", "That match is no longer available.");
    // One already between them (theirs to answer, or yours) says so below, ahead of whether they could start one.
    if (!live && !(await canTalk(db, mine, them))) {
      return refuse(409, "match_first", `${pairNames(mine.name, them.name).join(" and ")} haven't matched or dated yet: a roleplay is for a pair who could go on a date (swipe_deck finds matches).`);
    }
  }
  const terms = resolveTerms(input, mine.id, them.id);
  if (!terms.ok) return terms;
  const note = checkNote(input.note);
  if (!note.ok) return refuse(422, "note_not_allowed", note.message);

  if (live && auto) {
    // Nobody to ask: a new choice simply replaces the old one.
    await db.query(`update date_roleplays set status = 'withdrawn', decided_at = now() where id = $1`, [live.id]);
  } else if (live?.status === "pending" && live.answerer_user === userId) {
    return refuse(409, "they_proposed", `${shortName(cast.get(live.proposed_by)?.name)}'s creator already proposed "${live.terms.title}": answer theirs (agree, decline, or counter with yours).`);
  } else if (live?.status === "pending") {
    return refuse(409, "already_proposed", `You've already proposed "${live.terms.title}". Their creator has ${ROLEPLAY_PROPOSAL_DAYS} days to answer; take it back first to propose another.`);
  } else if (live) {
    return refuse(409, "already_agreed", `They've already agreed on "${live.terms.title}" for their next date. Call it off first to propose another.`);
  }
  return insert(db, { mine, them, userId, terms: terms.terms, note: note.note, auto, counterOf: null, round: 1 }, cast);
}

async function insert(
  db: Db,
  p: { mine: Char; them: Char; userId: string; terms: RoleplayTerms; note: string | null; auto: boolean; counterOf: string | null; round: number },
  cast: Map<string, Char>,
): Promise<RoleplayResult> {
  const [lo, hi] = pairOf(p.mine.id, p.them.id);
  const id = randomUUID();
  const answerer = p.auto ? null : p.them.owner_id;
  const inserted = await db
    .query<Row>(
      `insert into date_roleplays (id, character_lo, character_hi, proposed_by, proposer_user, answerer_user, terms, note, counter_of, round, status, decided_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, ${p.auto ? "now()" : "null"})
       returning *`,
      [id, lo, hi, p.mine.id, p.userId, answerer, JSON.stringify(p.terms), p.note, p.counterOf, p.round, p.auto ? "agreed" : "pending"],
    )
    .catch((err: unknown) => {
      // Both owners proposing in the same instant: the one live row per pair lets exactly one through.
      if ((err as { code?: string })?.code === "23505") return null;
      throw err;
    });
  const row = inserted?.rows[0];
  if (!row) return refuse(409, "they_proposed", "Their creator proposed a roleplay at the same moment: answer theirs.");
  if (answerer) {
    const two = [{ id: p.mine.id, name: p.mine.name }, { id: p.them.id, name: p.them.name }];
    const roles = rolesLine(p.terms, two);
    await notify(db, answerer, {
      kind: "date_roleplay",
      title: `🎭 ${shortName(p.mine.name)}'s creator ${p.counterOf ? "suggests another roleplay" : "suggests a roleplay"} for ${shortName(p.mine.name)} and ${shortName(p.them.name)}'s next date: ${p.terms.title}`,
      body: [fillPremise(p.terms, two), roles ? `${roles}.` : null, p.note ? `Their note: “${p.note}”` : null, "Agree and it plays on their next date, suggest another, or say not this time."]
        .filter(Boolean)
        .join(" ")
        .slice(0, 300),
      link: `/couples/${lo}/${hi}#roleplay`,
    });
  }
  return { ok: true, roleplay: await viewOf(db, row, p.userId, cast) };
}

/* ---------------------------------------------------- answering ---------------------------------------------------- */

export { ROLEPLAY_ANSWERS };
export type RoleplayAnswer = (typeof ROLEPLAY_ANSWERS)[number];

/** Marks the answering owner's "suggests a roleplay" notices for the pair read (answered, countered or gone). */
async function markRead(db: Db, userId: string | null, lo: string, hi: string): Promise<void> {
  if (!userId) return;
  await db
    .query(`update notifications set read_at = now() where user_id = $1 and kind = 'date_roleplay' and read_at is null and link like $2`, [userId, `/couples/${lo}/${hi}%`])
    .catch(() => {});
}

/**
 * Answers the pair's live roleplay, as the owner of `character_id` (the other is `with`):
 *  - agree / decline / counter: the proposal that waits on this owner. A counter is new terms (the same inputs as a
 *    proposal) that the first owner then answers, until ROLEPLAY_ROUNDS.
 *  - withdraw: take back your own proposal, or call off an agreed roleplay (either owner) before a date plays it.
 */
export async function answerRoleplay(
  db: Db,
  userId: string,
  input: TermsInput & { character_id: string; with: string; answer: string; note?: unknown; roleplay_proposal_id?: string | null },
): Promise<RoleplayResult | { ok: true; roleplay: null; status: "declined" | "withdrawn" }> {
  const cast = await chars(db, [input.character_id, input.with]);
  const mine = cast.get(input.character_id);
  const them = cast.get(input.with);
  if (!mine || mine.owner_id !== userId || mine.is_house) return refuse(404, "character_not_found", "Pick one of your own characters.");
  if (!them) return refuse(404, "partner_not_found", "That character isn't here any more.");
  const answer = (ROLEPLAY_ANSWERS as readonly string[]).includes(input.answer) ? (input.answer as RoleplayAnswer) : null;
  if (!answer) return refuse(422, "invalid_answer", `answer is one of ${ROLEPLAY_ANSWERS.join(", ")}.`);
  const live = await liveRow(db, mine.id, them.id);
  if (!live || (input.roleplay_proposal_id && input.roleplay_proposal_id !== live.id)) {
    return refuse(409, "no_roleplay", `There's no open roleplay between ${pairNames(mine.name, them.name).join(" and ")}${input.roleplay_proposal_id ? " with that id (it was answered, countered or lapsed)" : ""}.`);
  }
  const [lo, hi] = [live.character_lo, live.character_hi];
  const two = [{ id: mine.id, name: mine.name }, { id: them.id, name: them.name }];
  const otherOwner = live.proposer_user === userId ? live.answerer_user : live.proposer_user;

  if (answer === "withdraw") {
    const mineToTake = live.status === "pending" ? live.proposer_user === userId : live.proposer_user === userId || live.answerer_user === userId;
    if (!mineToTake) return refuse(409, "not_yours", "That proposal is theirs to take back: answer it instead (agree, decline or counter).");
    await db.query(`update date_roleplays set status = 'withdrawn', decided_at = now() where id = $1 and status in ('pending', 'agreed')`, [live.id]);
    await markRead(db, live.answerer_user, lo, hi);
    if (live.status === "agreed" && otherOwner && otherOwner !== userId) {
      await notify(db, otherOwner, {
        kind: "date_roleplay_answer",
        title: `🎭 ${shortName(mine.name)}'s creator called off "${live.terms.title}"`,
        body: `${shortName(mine.name)} and ${shortName(them.name)}'s next date plays without a roleplay, unless one of you suggests another.`,
        link: `/couples/${lo}/${hi}#roleplay`,
      });
    }
    return { ok: true, roleplay: null, status: "withdrawn" };
  }

  if (live.status !== "pending" || live.answerer_user !== userId) {
    return live.status === "agreed"
      ? refuse(409, "already_agreed", `"${live.terms.title}" is already agreed for their next date (withdraw calls it off).`)
      : refuse(409, "not_your_move", `It's their creator's move: "${live.terms.title}" waits on them, not you.`);
  }

  if (answer === "agree") {
    const r = await db.query<Row>(`update date_roleplays set status = 'agreed', decided_at = now() where id = $1 and status = 'pending' returning *`, [live.id]);
    if (!r.rows[0]) return refuse(409, "no_roleplay", "That roleplay was just answered or taken back.");
    await markRead(db, userId, lo, hi);
    await notify(db, live.proposer_user, {
      kind: "date_roleplay_answer",
      title: `🎭 ${shortName(mine.name)}'s creator agreed: "${live.terms.title}" plays on ${shortName(them.name)} and ${shortName(mine.name)}'s next date`,
      body: [rolesLine(live.terms, two), "Book their next date and they'll play it."].filter(Boolean).join(". "),
      link: `/couples/${lo}/${hi}#roleplay`,
    });
    return { ok: true, roleplay: await viewOf(db, r.rows[0], userId, cast) };
  }

  if (answer === "decline") {
    await db.query(`update date_roleplays set status = 'declined', decided_at = now() where id = $1 and status = 'pending'`, [live.id]);
    await markRead(db, userId, lo, hi);
    await notify(db, live.proposer_user, {
      kind: "date_roleplay_answer",
      title: `${shortName(mine.name)}'s creator passed on "${live.terms.title}"`,
      body: `${shortName(them.name)} and ${shortName(mine.name)}'s next date plays without a roleplay. You can suggest a different one.`,
      link: `/couples/${lo}/${hi}#roleplay`,
    });
    return { ok: true, roleplay: null, status: "declined" };
  }

  // A counter: new terms, from this side, that the first owner answers.
  if (live.round >= ROLEPLAY_ROUNDS) {
    return refuse(409, "out_of_rounds", `That's ${ROLEPLAY_ROUNDS} rounds of back and forth: agree to "${live.terms.title}" or decline it (then either of you can start fresh).`);
  }
  const hasTerms = Boolean(input.custom) || Boolean(input.roleplay_id) || (input.my_role !== undefined && input.my_role !== null && input.my_role !== "");
  // The same roleplay with the roles swapped is a counter too ("I'd rather be the captain"): my_role alone keeps theirs.
  const terms = resolveTerms(hasTerms && (input.custom || input.roleplay_id) ? input : { roleplay_id: live.terms.id === "custom" ? null : live.terms.id, my_role: input.my_role }, mine.id, them.id);
  const countered: TermsResult =
    !input.custom && !input.roleplay_id && live.terms.id === "custom"
      ? // Their own roleplay with only the roles changed: keep their words.
        ((): TermsResult => {
          const i = roleIndex(live.terms.roles, input.my_role);
          if (live.terms.roles && input.my_role !== undefined && i === null) return { ok: false, status: 422, error: "invalid_role", message: `my_role names neither role: "${live.terms.roles[0]}" or "${live.terms.roles[1]}".` };
          return { ok: true, terms: { ...live.terms, first: !live.terms.roles || i === null ? live.terms.first : i === 0 ? mine.id : them.id } };
        })()
      : terms;
  if (!countered.ok) return countered;
  if (!hasTerms) return refuse(422, "counter_needs_terms", "A counter says what you'd rather: roleplay_id (or custom), and/or my_role to swap who plays whom.");
  if (sameTerms(countered.terms, live.terms)) return refuse(422, "same_terms", `That's the roleplay they proposed, as they proposed it: answer "agree" instead.`);
  const note = checkNote(input.note);
  if (!note.ok) return refuse(422, "note_not_allowed", note.message);
  const moved = await db.query(`update date_roleplays set status = 'countered', decided_at = now() where id = $1 and status = 'pending' returning id`, [live.id]);
  if (!moved.rows.length) return refuse(409, "no_roleplay", "That roleplay was just answered or taken back.");
  await markRead(db, userId, lo, hi);
  return insert(db, { mine, them, userId, terms: countered.terms, note: note.note, auto: false, counterOf: live.id, round: live.round + 1 }, cast);
}

/* ---------------------------------------------------- booking ---------------------------------------------------- */

/** What a booking asks for: a roleplay to play (the show's, or written for it), "none" to skip an agreed one, or nothing. */
export type BookingAsk = (TermsInput & { skip?: boolean }) | null;

export type BookingRoleplay = { ok: true; roleplay: DateRoleplay | null } | { ok: false; status: number; error: string; message: string };

/** A booking's `roleplay` and `my_role` as an ask: one of the show's ids, "none", or { title, premise, roles? }. */
export function bookingAsk(raw: unknown, myRole?: unknown): BookingAsk {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string") return raw.trim().toLowerCase() === "none" ? { skip: true } : { roleplay_id: raw.trim(), my_role: myRole };
  if (typeof raw === "object" && !Array.isArray(raw)) return { custom: raw as TermsInput["custom"], my_role: myRole };
  return { roleplay_id: String(raw), my_role: myRole };
}

/**
 * The roleplay a date between `own` (the booker's) and `partner` plays, for every path that books one. An agreed roleplay
 * plays on the pair's next date, whoever books it. A roleplay named at booking plays at once when the partner's side is
 * the show's own or the booker's; with anyone else's character it has to be the one their owner agreed to.
 */
export async function roleplayForBooking(
  db: Db,
  userId: string,
  own: { id: string; name: string },
  partner: { id: string; name: string; owner_id: string | null; is_house: boolean },
  ask: BookingAsk,
): Promise<BookingRoleplay> {
  if (ask?.skip) return { ok: true, roleplay: null };
  const named = Boolean(ask && (ask.roleplay_id || ask.custom));
  const live = await liveRow(db, own.id, partner.id).catch(() => null);
  const agreed = live?.status === "agreed" ? live : null;
  const fromRow = (r: Row): DateRoleplay => ({ ...r.terms, agreed: r.answerer_user === null ? "auto" : "both", agreed_id: r.id });
  if (!named) return { ok: true, roleplay: agreed ? fromRow(agreed) : null };
  const terms = resolveTerms(ask!, own.id, partner.id);
  if (!terms.ok) return terms;
  if (agreed && sameTerms(terms.terms, agreed.terms)) return { ok: true, roleplay: fromRow(agreed) };
  if (await agreesAtOnce(db, userId, partner)) return { ok: true, roleplay: { ...terms.terms, agreed: "auto" } };
  return {
    ok: false,
    status: 409,
    error: "roleplay_not_agreed",
    message: agreed
      ? `${shortName(own.name)} and ${shortName(partner.name)} agreed on "${agreed.terms.title}" for this date, not "${terms.terms.title}": book without naming one (it plays the agreed one), or propose the other first.`
      : `${shortName(partner.name)}'s creator hasn't agreed to "${terms.terms.title}" yet: propose it first (the couple page, or propose_roleplay); once they agree, their next date plays it. Or book without a roleplay.`,
  };
}

/* ---------------------------------------------------- for agents ---------------------------------------------------- */

/** Every live roleplay of the user's characters: what waits on them, what they've sent, and what's agreed. */
export async function myRoleplays(db: Db, userId: string, characterId?: string | null): Promise<{ to_answer: RoleplayView[]; sent: RoleplayView[]; agreed: RoleplayView[] }> {
  const { rows } = await db.query<{ lo: string; hi: string }>(
    `select distinct r.character_lo as lo, r.character_hi as hi
       from date_roleplays r
       join characters c on c.id in (r.character_lo, r.character_hi) and c.owner_id = $1 and not c.is_house
      where r.status in ('pending', 'agreed') ${characterId ? "and $2 in (r.character_lo, r.character_hi)" : ""}
      order by 1, 2
      limit 50`,
    characterId ? [userId, characterId] : [userId],
  );
  const views = (await Promise.all(rows.map((r) => pairRoleplay(db, userId, r.lo, r.hi)))).filter((v): v is RoleplayView => v !== null);
  return {
    to_answer: views.filter((v) => v.your_move),
    sent: views.filter((v) => v.status === "pending" && v.from_you),
    agreed: views.filter((v) => v.status === "agreed"),
  };
}
