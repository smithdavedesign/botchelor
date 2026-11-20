/**
 * What an owner says about their own character's circle (docs/PRDs/social-network.md section 6.2, Phase 2b), on the
 * character page's "Their people" or through their agent's MCP tools: off-screen people, places in the shared world,
 * and ties to other characters. Every path that declares for a person comes through here, so the rules are one set:
 *
 *  - **Their own characters:** people (up to the cap), places (lives, works, regular, studied), and ties between two of
 *    their own characters of any kind, conflict too. These are live at once.
 *  - **Someone else's character:** a warm kind only (family, friends, work, love history). The tie starts `proposed`,
 *    the other owner is told (the inbox, a push, an email if they asked for them) and says yes or no on their
 *    character's page. No answer in PROPOSAL_DAYS and it lapses (`declined`, nobody answered: lapseProposals, hourly).
 *    At most PROPOSALS_PER_DAY a day per person (lib/limits.ts); a no stands for REASK_DAYS.
 *  - **Never:** a conflict about someone else's character (those come only from what aired), a tie to the house or the
 *    show's own cast (they take ties from the show only: its generator, an admin, what aired), a tie to someone's
 *    private character, family between two who have dated, romance between family.
 *  - **The words:** every name, note, story and place name passes the show's text check (checkShowText).
 *
 * Each refusal says why in words a person can read, and a status a route can return as it is.
 */
import type { Db } from "../db";
import { overLimit, SOCIAL_PROPOSE_LIMITS } from "../limits";
import { portraitPathSql } from "../portrait-sql";
import { shortName } from "../names";
import { notify, type NotificationKind } from "../notifications";
import { DELETED_OWNER } from "../rules";
import { checkShowText } from "../safety";
import { notPersonaSql } from "../step-in-shared";
import { ourIdsCached, pairClash, pairHistory, showCharacterIds, worldMenu, type WorldMenu } from "./circles";
import { TIE_KINDS, type TieKindId } from "./kinds";
import { addPerson, checkPerson, getPerson, removePerson, updatePerson } from "./people";
import { ensurePlace, getPlaceByKey, MEMBER_SINCE_MAX, PLACE_NAME_MAX, removeMembership, setMembership, slugify } from "./places";
import { egoNetwork } from "./read";
import {
  canonicalTie,
  isDeclaredRole,
  kindFromWords,
  mayDeclarePerson,
  mayDeclareTie,
  NEW_PLACE_FOR,
  parseChoice,
  ROLE_PLACES,
  ROLE_WORDS,
  tieFromWords,
  tieLine,
  type DeclaredRole,
} from "./relations";
import { socialDeclareOn } from "./switch";
import { findTie, getTie, removeTie, setStatus, SINCE_MAX, STORY_MAX, upsertTie } from "./ties";
import { ensureWorld, NEIGHBOURHOODS, WORLD_CITY } from "./world";
import { PEOPLE_CAP, type Layer, type PlaceKind, type SocialNode, type SocialPerson, type Tie, type TieRefusal, type Visibility } from "./types";

type Env = Record<string, string | undefined>;

/** Who's declaring: a person on the site (`owner`), or their agent over MCP (`agent`), and the account. */
export type DeclareBy = { userId: string; source: "owner" | "agent" };
/** A refusal a route or a tool returns as it is: an HTTP status, a code, and why in words. */
export type Refusal = { ok: false; status: number; error: string; message: string };
const no = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

/** A proposal to someone else's character waits this long for an answer, then lapses. */
export const PROPOSAL_DAYS = 14;
/** After a no (or a lapse), the same tie can't be asked for again for this long. */
export const REASK_DAYS = 30;
/** The most places a character is declared at in each role: one home, two jobs, three regular spots, two schools. */
export const ROLE_CAPS: Record<DeclaredRole, number> = { lives: 1, works: 2, regular: 3, studied: 2 };
/** Who a declared item is shown to: everyone, or only the owner (and, for a tie, the other end's owner). */
export type DeclaredVisibility = Extract<Visibility, "public" | "owner">;

const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const first = (c: { name: string }): string => shortName(c.name) || c.name;

/* ---------------------------------------------------- characters ---------------------------------------------------- */

type CharRow = { id: string; name: string; owner_id: string | null; is_house: boolean; visibility: string; created_via: string | null; listed: boolean };

async function charactersOf(db: Db, ids: readonly (string | null)[]): Promise<Map<string, CharRow>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const { rows } = await db.query<CharRow>(
    `select c.id, c.name, c.owner_id, c.is_house, c.visibility, c.created_via,
            (c.owner_id is distinct from $2 and ${notPersonaSql("c")}) as listed
       from characters c where c.id = any($1::text[])`,
    [wanted, DELETED_OWNER],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Whether one of these two people blocked the other (the site's blocks: never a proposal across one). */
async function blockedBetween(db: Db, x: string, y: string | null): Promise<boolean> {
  if (!y) return false;
  const { rows } = await db.query(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [x, y]);
  return rows.length > 0;
}

/**
 * Whether a character's circle is the show's to write: the house, or the show's own agent cast (lib/social/circles.ts),
 * which is only ever made over MCP, so a character made on the site never costs the wider read.
 */
async function isShows(db: Db, c: CharRow): Promise<boolean> {
  if (c.is_house) return true;
  if (c.created_via !== "mcp") return false;
  return (await showCharacterIds(db, [c.id], { ours: await ourIdsCached(db) })).has(c.id);
}

/** The character `by` may declare for: theirs, listed, and not one of the show's (the show writes those). */
async function editable(db: Db, by: DeclareBy, characterId: string, env: Env): Promise<{ ok: true; c: CharRow } | Refusal> {
  if (!socialDeclareOn(env)) return no(409, "off", "People and ties can't be changed right now.");
  const c = (await charactersOf(db, [characterId])).get(characterId);
  if (!c || !c.listed || c.owner_id !== by.userId) return no(404, "character_not_found", "No character of yours with that id.");
  if (await isShows(db, c)) return no(409, "show_character", `${first(c)} is one of the show's: the show writes their people.`);
  return { ok: true, c };
}

/* ------------------------------------------------------ words ------------------------------------------------------ */

/** A tie's story and "since" as kept, or why not: too long, or the show's text check. */
function tieText(story: string | null | undefined, since: string | null | undefined): { ok: true; story: string | null; since: string | null } | Refusal {
  const s = clean(story);
  const n = clean(since);
  if (s.length > STORY_MAX) return no(422, "too_long", `The story is up to ${STORY_MAX} characters.`);
  if (n.length > SINCE_MAX) return no(422, "too_long", `"Since" is up to ${SINCE_MAX} characters.`);
  const fields: Record<string, string> = {};
  if (s) fields.story = s;
  if (n) fields.since = n;
  if (Object.keys(fields).length && !checkShowText(fields).ok) return unsafe();
  return { ok: true, story: s || null, since: n || null };
}

const unsafe = (): Refusal => no(422, "unsafe_text", "That doesn't pass the show's check. Try other words.");

function personRefusal(reason: string, holder: { name: string }): Refusal {
  switch (reason) {
    case "cap":
      return no(409, "people_cap", `${first(holder)} has ${PEOPLE_CAP} people already: take one off first.`);
    case "empty":
      return no(422, "invalid_name", "They need a name.");
    case "too_long":
      return no(422, "too_long", "Names are up to 40 characters, pronouns 20 and notes 160.");
    case "unsafe":
      return unsafe();
    case "off":
      return no(409, "off", "People and ties can't be changed right now.");
    default:
      return no(404, "person_not_found", "No one of theirs with that id.");
  }
}

function tieRefusal(reason: TieRefusal, kind: TieKindId): Refusal {
  const d = TIE_KINDS[kind];
  switch (reason) {
    case "exclusive":
      return no(409, "exclusive", d.exclusive === 1 ? `One ${d.words.to} each: one of them has theirs already.` : `${d.exclusive} ${d.words.pair} at most each: one of them has as many already.`);
    case "too_long":
      return no(422, "too_long", `The story is up to ${STORY_MAX} characters, and "since" up to ${SINCE_MAX}.`);
    case "unsafe":
      return unsafe();
    case "self":
      return no(422, "self", "A character can't be tied to themselves.");
    case "unknown_kind":
      return no(422, "invalid_relation", "That isn't a relation we know.");
    case "off":
      return no(409, "off", "People and ties can't be changed right now.");
    default:
      return no(404, "not_found", "No such tie.");
  }
}

/** The relation an owner gives an off-screen person: a kind's id (the form's list), or free words ("mum", "older sister"). */
function personKindOf(relation: string, by: DeclareBy): TieKindId | null {
  const choice = parseChoice(clean(relation));
  const kind = choice && !choice.reversed ? choice.kind : kindFromWords(relation);
  return kind && mayDeclarePerson(kind, by.source) ? kind : null;
}

/* ------------------------------------------------------ people ------------------------------------------------------ */

/** An off-screen person as an owner gives them: a name and a relation (a kind's id or words), and the rest optional. */
export type PersonIn = {
  name: string;
  relation: string;
  pronouns?: string | null;
  note?: string | null;
  deceased?: boolean;
  visibility?: DeclaredVisibility;
  story?: string | null;
  since?: string | null;
};

/** Adds an off-screen person to one of your characters, with the tie that says who they are. */
export async function addPersonFor(db: Db, by: DeclareBy, characterId: string, p: PersonIn, env: Env = process.env): Promise<{ ok: true; person: SocialPerson; tie: Tie } | Refusal> {
  const e = await editable(db, by, characterId, env);
  if (!e.ok) return e;
  const kind = personKindOf(p.relation, by);
  if (!kind) return no(422, "invalid_relation", `"${clean(p.relation)}" isn't a relation we know: pick one from the list.`);
  const words = tieText(p.story, p.since);
  if (!words.ok) return words;
  const visibility = p.visibility ?? "public";
  const w = await addPerson(
    db,
    { holderId: characterId, name: p.name, pronouns: p.pronouns ?? null, note: p.note ?? null, deceased: p.deceased ?? false, visibility, source: by.source, created_by: by.userId },
    env,
  );
  if (!w.ok) return personRefusal(w.reason, e.c);
  const tie = await upsertTie(
    db,
    { from: characterId, toPerson: w.person.id, kind, source: by.source, status: "active", visibility, story: words.story, since_text: words.since, created_by: by.userId, actor: by.userId },
    env,
  );
  if (!tie.ok) {
    await removePerson(db, w.person.id);
    return tieRefusal(tie.reason, kind);
  }
  return { ok: true, person: w.person, tie: tie.tie };
}

/** What can be changed about a person afterwards: any of it, the relation too. */
export type PersonPatch = Partial<PersonIn>;

/** The tie from a person's holder to them (the relation), or null. */
async function personTie(db: Db, person: SocialPerson): Promise<Tie | null> {
  const id = (await db.query<{ id: string }>(`select id from social_ties where from_id = $1 and to_person_id = $2 order by created_at limit 1`, [person.holder_id, person.id])).rows[0]?.id;
  return id ? getTie(db, id) : null;
}

/** Changes an off-screen person of one of your characters: their words, flags, who sees them, or the relation. */
export async function editPersonFor(db: Db, by: DeclareBy, personId: string, patch: PersonPatch, env: Env = process.env): Promise<{ ok: true; person: SocialPerson; tie: Tie | null } | Refusal> {
  const person = await getPerson(db, personId);
  if (!person) return no(404, "person_not_found", "No one of theirs with that id.");
  const e = await editable(db, by, person.holder_id, env);
  if (!e.ok) return e;
  // Every word first, so a refusal changes nothing.
  const checked = checkPerson({ name: patch.name, pronouns: patch.pronouns, note: patch.note });
  if (!checked.ok) return personRefusal(checked.reason, e.c);
  const words = tieText(patch.story, patch.since);
  if (!words.ok) return words;
  const kind = patch.relation === undefined ? null : personKindOf(patch.relation, by);
  if (patch.relation !== undefined && !kind) return no(422, "invalid_relation", `"${clean(patch.relation)}" isn't a relation we know: pick one from the list.`);
  const before = await personTie(db, person);
  const visibility = patch.visibility ?? (person.visibility === "private" ? "owner" : person.visibility);
  const story = patch.story === undefined ? undefined : words.story;
  const since = patch.since === undefined ? undefined : words.since;
  let tie = before;
  if (kind && kind !== before?.kind) {
    // A new relation is a new tie (its id is its kind's): the new one first, so a refusal (an exclusive kind) keeps the old.
    const w = await upsertTie(
      db,
      {
        from: person.holder_id,
        toPerson: person.id,
        kind,
        source: by.source,
        status: "active",
        visibility,
        story: story ?? before?.story ?? null,
        since_text: since ?? before?.since_text ?? null,
        created_by: by.userId,
        actor: by.userId,
      },
      env,
    );
    if (!w.ok) return tieRefusal(w.reason, kind);
    if (before) await removeTie(db, before.id);
    tie = w.tie;
  } else if (before && (patch.visibility !== undefined || story !== undefined || since !== undefined)) {
    const w = await upsertTie(
      db,
      { from: person.holder_id, toPerson: person.id, kind: before.kind, source: by.source, visibility, ...(story !== undefined ? { story } : {}), ...(since !== undefined ? { since_text: since } : {}), actor: by.userId },
      env,
    );
    if (!w.ok) return tieRefusal(w.reason, before.kind);
    tie = w.tie;
  }
  const w = await updatePerson(
    db,
    personId,
    {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.pronouns !== undefined ? { pronouns: patch.pronouns } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.deceased !== undefined ? { deceased: patch.deceased } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    },
    env,
  );
  if (!w.ok) return personRefusal(w.reason, e.c);
  return { ok: true, person: w.person, tie };
}

/** Takes an off-screen person off one of your characters (the tie to them goes with them). */
export async function removePersonFor(db: Db, by: DeclareBy, personId: string, env: Env = process.env): Promise<{ ok: true } | Refusal> {
  const person = await getPerson(db, personId);
  if (!person) return no(404, "person_not_found", "No one of theirs with that id.");
  const e = await editable(db, by, person.holder_id, env);
  if (!e.ok) return e;
  await removePerson(db, personId);
  return { ok: true };
}

/* ------------------------------------------------------- ties ------------------------------------------------------- */

/** A tie as an owner declares it: with whom, the relation (a choice's id or words), and the rest optional. */
export type TieIn = { with: string; relation: string; reversed?: boolean; story?: string | null; since?: string | null; visibility?: DeclaredVisibility };

/** What a declaration did: made it live (`active`), asked the other owner (`proposed`), or found it there already. */
export type Declared = { ok: true; tie: Tie; status: "active" | "proposed"; news: boolean };

/**
 * Ties one of your characters to another character. Between two of yours, any declarable kind, live at once. To
 * someone else's, a warm kind only, as a proposal its owner answers (and is told about).
 */
export async function declareTie(db: Db, by: DeclareBy, characterId: string, t: TieIn, env: Env = process.env, now: Date = new Date()): Promise<Declared | Refusal> {
  const e = await editable(db, by, characterId, env);
  if (!e.ok) return e;
  const me = e.c;
  if (!t.with || t.with === characterId) return no(422, "self", "A character can't be tied to themselves.");
  const other = (await charactersOf(db, [t.with])).get(t.with);
  const own = other?.owner_id === by.userId;
  // A private character of someone else's isn't there to anyone else, and nor is one across a block.
  if (!other || !other.listed || (other.visibility === "private" && !own) || (!own && (await blockedBetween(db, by.userId, other.owner_id)))) {
    return no(404, "character_not_found", "No character with that id to tie them to.");
  }
  if (await isShows(db, other)) return no(409, "show_character", `${first(other)} is one of the show's: their ties come from the show.`);
  const read = parseChoice(clean(t.relation)) ?? tieFromWords(t.relation);
  if (!read) return no(422, "invalid_relation", `"${clean(t.relation)}" isn't a relation we know: pick one from the list.`);
  if (!mayDeclareTie(read.kind, by.source, { own })) {
    return own || !TIE_KINDS[read.kind].negative
      ? no(422, "invalid_relation", `"${clean(t.relation)}" comes from what airs, not from a form.`)
      : no(422, "not_warm", `Only a warm tie to someone else's character: family, friends, work or love history. Rivalries come from what airs.`);
  }
  const words = tieText(t.story, t.since);
  if (!words.ok) return words;
  // "They are my <relation>": the tie from me to them (from them to me for a directed kind read from its other end), in
  // its one stored form.
  const flip = TIE_KINDS[read.kind].directed && (t.reversed === true) !== read.reversed;
  const c = canonicalTie({ from: flip ? other.id : me.id, to: flip ? me.id : other.id, kind: read.kind });
  const pair = c.from < c.to ? `${c.from}|${c.to}` : `${c.to}|${c.from}`;
  const clash = pairClash(c.kind, pair, await pairHistory(db, [[c.from, c.to]]));
  if (clash) {
    return no(409, "clash", TIE_KINDS[c.kind].layer === "kin" ? `${first(me)} and ${first(other)} have dated: they can't be family.` : `${first(me)} and ${first(other)} are family.`);
  }
  const visibility = t.visibility ?? "public";
  const existing = await findTie(db, { from: c.from, to: c.to, kind: c.kind });
  if (existing?.status === "active" || existing?.status === "proposed") return { ok: true, tie: existing, status: existing.status, news: false };
  if (own) {
    const w = await upsertTie(
      db,
      { from: c.from, to: c.to, kind: c.kind, source: by.source, status: "active", visibility, story: words.story, since_text: words.since, created_by: by.userId, actor: by.userId },
      env,
    );
    return w.ok ? { ok: true, tie: w.tie, status: "active", news: true } : tieRefusal(w.reason, c.kind);
  }
  if (existing?.status === "declined" && now.getTime() - new Date(existing.updated_at).getTime() < REASK_DAYS * DAY_MS) {
    const again = new Date(new Date(existing.updated_at).getTime() + REASK_DAYS * DAY_MS).toISOString().slice(0, 10);
    return no(409, "declined_recently", `That was asked not long ago and it didn't happen. It can be asked again from ${again}.`);
  }
  if (await overLimit(db, "social_propose", by.userId, SOCIAL_PROPOSE_LIMITS, now)) {
    return no(429, "rate_limited", `That's ${SOCIAL_PROPOSE_LIMITS.perDay} proposals today: the rest can wait for tomorrow.`);
  }
  const w = await upsertTie(
    db,
    {
      from: c.from,
      to: c.to,
      kind: c.kind,
      source: by.source,
      status: "proposed",
      visibility,
      story: words.story,
      since_text: words.since,
      created_by: by.userId,
      actor: by.userId,
      // Which end asked, and when (lapseProposals): a character, never a person's id, since a tie's detail is shown.
      detail: { proposed_from: me.id, proposed_at: now.toISOString() },
    },
    env,
  );
  if (!w.ok) return tieRefusal(w.reason, c.kind);
  await notify(db, other.owner_id, proposalNotice(me, other, w.tie));
  return { ok: true, tie: w.tie, status: "proposed", news: true };
}

/** "Bo is Ada's sister": a tie said whole, from its stored ends (to is from's <words.to>). */
function sentence(tie: Pick<Tie, "from_id" | "kind">, a: CharRow, b: CharRow): string {
  const [from, to] = tie.from_id === a.id ? [a, b] : [b, a];
  return `${first(to)} is ${first(from)}'s ${TIE_KINDS[tie.kind].words.to}`;
}

/** The link a proposal's notice opens: the asked character's people, with the tie, so answering it marks it read. */
const proposalLink = (characterId: string, tieId: string): string => `/characters/${characterId}?tie=${encodeURIComponent(tieId)}#people`;

/** A proposal's notice link back as its character and tie (the notifications page answers it in place), or null. */
export function proposalOfLink(link: string | null | undefined): { characterId: string; tieId: string } | null {
  const m = /^\/characters\/([^/?#]+)\?tie=([^&#]+)/.exec(link ?? "");
  return m ? { characterId: decodeURIComponent(m[1]), tieId: decodeURIComponent(m[2]) } : null;
}

/** Which of these ties are still proposals waiting on an answer (the notifications page shows Yes and No on those). */
export async function openProposals(db: Db, tieIds: readonly string[]): Promise<Set<string>> {
  if (!tieIds.length) return new Set();
  const { rows } = await db.query<{ id: string }>(`select id from social_ties where id = any($1::text[]) and status = 'proposed'`, [[...new Set(tieIds)]]);
  return new Set(rows.map((r) => r.id));
}

function proposalNotice(mine: CharRow, theirs: CharRow, tie: Tie): { kind: NotificationKind; title: string; body: string; link: string } {
  const d = TIE_KINDS[tie.kind];
  return {
    kind: "tie_proposal",
    title: `${d.emoji} ${first(mine)} and ${first(theirs)}: ${d.words.pair}?`,
    body: `${first(mine)}'s owner says ${sentence(tie, mine, theirs)}. Say yes and it's on both their pages; say no and it's gone. With no answer it lapses in ${PROPOSAL_DAYS} days.`,
    link: proposalLink(theirs.id, tie.id),
  };
}

/** The asking end of a proposal, and the end that answers it. */
function endsOf(tie: Tie): { asking: string; asked: string } | null {
  if (!tie.to_id) return null;
  const from = typeof tie.detail.proposed_from === "string" ? tie.detail.proposed_from : null;
  if (from === tie.to_id) return { asking: tie.to_id, asked: tie.from_id };
  return { asking: tie.from_id, asked: tie.to_id };
}

/** Says yes or no to a proposal made to one of your characters; the owner who asked is told. */
export async function answerTie(db: Db, by: DeclareBy, tieId: string, yes: boolean, env: Env = process.env): Promise<{ ok: true; tie: Tie } | Refusal> {
  if (!socialDeclareOn(env)) return no(409, "off", "People and ties can't be changed right now.");
  const tie = await getTie(db, tieId);
  const ends = tie && tie.status === "proposed" ? endsOf(tie) : null;
  const chars = ends ? await charactersOf(db, [ends.asking, ends.asked]) : new Map<string, CharRow>();
  const asked = ends ? chars.get(ends.asked) : undefined;
  const asking = ends ? chars.get(ends.asking) : undefined;
  if (!tie || !ends || !asked || !asking || asked.owner_id !== by.userId) return no(404, "proposal_not_found", "No proposal waiting on you with that id.");
  const w = await setStatus(db, tie.id, yes ? "active" : "declined", { answeredBy: by.userId, source: by.source, actor: by.userId }, env);
  if (!w.ok) return tieRefusal(w.reason, tie.kind);
  await db.query(`update notifications set read_at = now() where user_id = $1 and kind = 'tie_proposal' and link = $2 and read_at is null`, [by.userId, proposalLink(asked.id, tie.id)]);
  const d = TIE_KINDS[tie.kind];
  await notify(db, asking.owner_id, {
    kind: "tie_answer",
    title: yes ? `${d.emoji} ${first(asked)}'s owner said yes: ${first(asking)} and ${first(asked)} are ${d.words.pair}` : `${first(asked)}'s owner said no to ${first(asking)} and ${first(asked)}`,
    body: yes ? `${sentence(tie, asking, asked)}: it's on both their pages now.` : `They said no to "${sentence(tie, asking, asked)}". Nothing changes, and it's not asked again for ${REASK_DAYS} days.`,
    link: `/characters/${asking.id}#people`,
  });
  return { ok: true, tie: w.tie };
}

/**
 * Ends a declared tie one of your characters is in (a friendship that's over, a job left): it stays in their history
 * as ended. Family doesn't end, so a family tie is taken off instead; so is a proposal its asker withdraws. Answering
 * no to a proposal is answerTie. What aired (a derived tie) and what the show wrote can't be ended by hand.
 */
export async function endTieFor(db: Db, by: DeclareBy, tieId: string, env: Env = process.env): Promise<{ ok: true; ended: "ended" | "removed" } | Refusal> {
  if (!socialDeclareOn(env)) return no(409, "off", "People and ties can't be changed right now.");
  const tie = await getTie(db, tieId);
  const chars = tie ? await charactersOf(db, [tie.from_id, tie.to_id]) : new Map<string, CharRow>();
  const mine = tie ? [tie.from_id, tie.to_id].filter((id): id is string => Boolean(id) && chars.get(id!)?.owner_id === by.userId) : [];
  if (!tie || tie.status === "declined" || !mine.length) return no(404, "tie_not_found", "No tie of theirs with that id.");
  if (tie.to_person_id) return no(409, "person_tie", "That's who an off-screen person is: change the relation, or take the person off.");
  if (tie.source !== "owner" && tie.source !== "agent") {
    return no(409, "not_declared", tie.source === "derived" ? "That one comes from what aired: it can't be ended by hand." : "That one is the show's.");
  }
  if (tie.status === "proposed") {
    const ends = endsOf(tie);
    if (!ends || !mine.includes(ends.asking)) return no(409, "answer_it", "That's a proposal to your character: say yes or no to it.");
    await removeTie(db, tie.id);
    // Its notice is moot now: read, so it doesn't sit in their inbox.
    const asked = chars.get(ends.asked);
    if (asked?.owner_id) await db.query(`update notifications set read_at = now() where user_id = $1 and link = $2 and read_at is null`, [asked.owner_id, proposalLink(asked.id, tie.id)]);
    return { ok: true, ended: "removed" };
  }
  if (TIE_KINDS[tie.kind].layer === "kin") {
    await removeTie(db, tie.id);
    return { ok: true, ended: "removed" };
  }
  if (tie.status === "ended") return { ok: true, ended: "ended" };
  const w = await setStatus(db, tie.id, "ended", { source: by.source, actor: by.userId }, env);
  return w.ok ? { ok: true, ended: "ended" } : tieRefusal(w.reason, tie.kind);
}

/**
 * Changes a declared tie one of your characters is in: who sees it (either end's owner), and its story or since (the
 * owner who declared it, or the owner of both ends).
 */
export async function editTieFor(
  db: Db,
  by: DeclareBy,
  tieId: string,
  patch: { story?: string | null; since?: string | null; visibility?: DeclaredVisibility },
  env: Env = process.env,
): Promise<{ ok: true; tie: Tie } | Refusal> {
  if (!socialDeclareOn(env)) return no(409, "off", "People and ties can't be changed right now.");
  const tie = await getTie(db, tieId);
  const chars = tie ? await charactersOf(db, [tie.from_id, tie.to_id]) : new Map<string, CharRow>();
  const owns = (id: string | null) => Boolean(id) && chars.get(id!)?.owner_id === by.userId;
  if (!tie || tie.status === "declined" || !(owns(tie.from_id) || owns(tie.to_id))) return no(404, "tie_not_found", "No tie of theirs with that id.");
  if (tie.to_person_id) return no(409, "person_tie", "That's who an off-screen person is: change it on the person.");
  if (tie.source !== "owner" && tie.source !== "agent") return no(409, "not_declared", "Only a tie someone declared can be changed.");
  const words = tieText(patch.story, patch.since);
  if (!words.ok) return words;
  const writesWords = patch.story !== undefined || patch.since !== undefined;
  if (writesWords && !(tie.created_by === by.userId || (owns(tie.from_id) && owns(tie.to_id)))) {
    return no(403, "not_yours", "The story is the words of the owner who declared it.");
  }
  const w = await upsertTie(
    db,
    {
      from: tie.from_id,
      to: tie.to_id!,
      kind: tie.kind,
      source: by.source,
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.story !== undefined ? { story: words.story } : {}),
      ...(patch.since !== undefined ? { since_text: words.since } : {}),
      actor: by.userId,
    },
    env,
  );
  return w.ok ? { ok: true, tie: w.tie } : tieRefusal(w.reason, tie.kind);
}

/* ------------------------------------------------------ places ------------------------------------------------------ */

/** A place as an owner gives it: a role, and a place of the world by key, or a new workplace or school by name. */
export type PlaceIn = { role: string; place?: string | null; name?: string | null; neighbourhood?: string | null; since?: string | null; visibility?: DeclaredVisibility };

/** A neighbourhood of the city by key or name. */
function neighbourhoodOf(text: string | null | undefined): (typeof NEIGHBOURHOODS)[number] | null {
  const t = clean(text).toLowerCase();
  if (!t) return null;
  return NEIGHBOURHOODS.find((n) => n.key === t || n.name.toLowerCase() === t) ?? null;
}

/**
 * Puts one of your characters at a place: where they live (a neighbourhood), work, are a regular, or studied. A place
 * of the world is picked by key; a workplace or school no one has named is named here, under a neighbourhood, and is
 * then on everyone's list (two who work there are coworkers). One home: a new one takes the old one's place.
 */
export async function setPlaceFor(db: Db, by: DeclareBy, characterId: string, p: PlaceIn, env: Env = process.env): Promise<{ ok: true; place: { id: string; key: string; name: string }; role: DeclaredRole } | Refusal> {
  const e = await editable(db, by, characterId, env);
  if (!e.ok) return e;
  if (!isDeclaredRole(p.role)) return no(422, "invalid_role", "A place is where they live, work, are a regular, or studied.");
  const role = p.role;
  const since = clean(p.since);
  if (since.length > MEMBER_SINCE_MAX) return no(422, "too_long", `"Since" is up to ${MEMBER_SINCE_MAX} characters.`);
  if (since && !checkShowText({ since }).ok) return unsafe();
  await ensureWorld(db, env);
  let place: { id: string; key: string; name: string; kind: PlaceKind; visibility: Visibility } | null = null;
  const key = clean(p.place).toLowerCase();
  if (key) {
    place = await getPlaceByKey(db, key);
    if (!place || place.visibility !== "public" || !ROLE_PLACES[role].includes(place.kind)) return no(422, "invalid_place", `Pick a place from the list for "${ROLE_WORDS[role].toLowerCase()}".`);
  } else {
    const kind = NEW_PLACE_FOR[role];
    const name = clean(p.name);
    if (!kind) return no(422, "invalid_place", role === "lives" ? "Pick one of the city's neighbourhoods." : "Pick a place from the list.");
    if (!name) return no(422, "invalid_place", "Name the place, or pick one from the list.");
    if (name.length > PLACE_NAME_MAX) return no(422, "too_long", `A place's name is up to ${PLACE_NAME_MAX} characters.`);
    if (!checkShowText({ name }).ok) return unsafe();
    const slug = slugify(name);
    if (!slug) return no(422, "invalid_place", "Name the place with a word or two.");
    const hood = neighbourhoodOf(p.neighbourhood);
    // The same name is the same place: someone else's character who works there is a coworker.
    const made = await getPlaceByKey(db, `${kind}:${slug}`);
    place =
      made ??
      (await ensurePlace(db, { key: `${kind}:${slug}`, kind, name, parentKey: hood?.key ?? WORLD_CITY.key, source: by.source, created_by: by.userId }));
    if (place.visibility !== "public") return no(422, "invalid_place", "Pick a place from the list.");
  }
  // At the role's cap: one home is replaced; a third job waits for one to be taken off.
  const { rows } = await db.query<{ place_id: string; source: string }>(
    `select place_id, source from social_place_members where character_id = $1 and role = $2 and ended_at is null and place_id <> $3 order by updated_at`,
    [characterId, role, place.id],
  );
  if (rows.length >= ROLE_CAPS[role]) {
    if (role !== "lives") return no(409, "place_cap", `${first(e.c)} is at ${ROLE_CAPS[role]} places for "${ROLE_WORDS[role].toLowerCase()}": take one off first.`);
    for (const r of rows) await removeMembership(db, r.place_id, characterId, role);
  }
  const m = await setMembership(
    db,
    { placeId: place.id, characterId, role, source: by.source, visibility: p.visibility ?? "public", since_text: since || null, created_by: by.userId },
    env,
  );
  if (!m) return no(409, "off", "People and ties can't be changed right now.");
  return { ok: true, place: { id: place.id, key: place.key, name: place.name }, role };
}

/** Takes one of your characters out of a place they were declared at. What aired (a derived visit) stays. */
export async function leavePlaceFor(db: Db, by: DeclareBy, characterId: string, placeId: string, role: string, env: Env = process.env): Promise<{ ok: true } | Refusal> {
  const e = await editable(db, by, characterId, env);
  if (!e.ok) return e;
  const m = (await db.query<{ source: string }>(`select source from social_place_members where place_id = $1 and character_id = $2 and role = $3`, [placeId, characterId, role])).rows[0];
  if (!m) return no(404, "place_not_found", "They aren't at that place.");
  if (m.source !== "owner" && m.source !== "agent") return no(409, "not_declared", "That comes from what aired: it stays.");
  await removeMembership(db, placeId, characterId, role as DeclaredRole);
  return { ok: true };
}

/* ----------------------------------------------------- lapsing ----------------------------------------------------- */

/** The hourly job's step: proposals with no answer in PROPOSAL_DAYS lapse (declined, nobody answered); the asker is told. */
export async function lapseProposals(db: Db, o: { now?: Date; env?: Env; limit?: number } = {}): Promise<number> {
  const env = o.env ?? process.env;
  if (!socialDeclareOn(env)) return 0;
  const now = o.now ?? new Date();
  const { rows } = await db.query<{ id: string }>(
    `select id from social_ties
      where status = 'proposed'
        and case when detail->>'proposed_at' ~ '^\\d{4}-\\d{2}-\\d{2}T' then (detail->>'proposed_at')::timestamptz else created_at end < $1
      order by id limit $2`,
    [new Date(now.getTime() - PROPOSAL_DAYS * DAY_MS).toISOString(), o.limit ?? 200],
  );
  let lapsed = 0;
  for (const { id } of rows) {
    const w = await setStatus(db, id, "declined", { answeredBy: null, actor: "system", at: now }, env);
    if (!w.ok || !w.event) continue;
    lapsed++;
    const ends = endsOf(w.tie);
    const chars = ends ? await charactersOf(db, [ends.asking, ends.asked]) : new Map<string, CharRow>();
    const asking = ends ? chars.get(ends.asking) : undefined;
    const asked = ends ? chars.get(ends.asked) : undefined;
    if (!asking || !asked) continue;
    if (asked.owner_id) await db.query(`update notifications set read_at = now() where user_id = $1 and link = $2 and read_at is null`, [asked.owner_id, proposalLink(asked.id, id)]);
    await notify(db, asking.owner_id, {
      kind: "tie_answer",
      title: `No answer about ${first(asking)} and ${first(asked)}`,
      body: `"${sentence(w.tie, asking, asked)}" had no answer in ${PROPOSAL_DAYS} days, so it lapsed. It can be asked again in ${REASK_DAYS} days.`,
      link: `/characters/${asking.id}#people`,
    });
  }
  return lapsed;
}

/* ------------------------------------------------ the page's view ------------------------------------------------ */

/** One tie as "Their people" lists it, from the character's side: "<other> is their <label>". */
export type PeopleTie = {
  id: string;
  other: SocialNode;
  kind: TieKindId;
  /** The kind's word from this character's side ("sibling", "mentee"), and the line a list shows ("their sibling"). */
  label: string;
  line: string;
  layer: Layer;
  emoji: string;
  status: Tie["status"];
  visibility: Visibility;
  story: string | null;
  since: string | null;
  /** Declared by an owner or agent (not what aired or the show): the owner may end it or change who sees it. */
  declared: boolean;
  /** A proposal waiting on the viewer (it's to their character), or one their character sent. */
  waiting: "on_you" | "on_them" | null;
};
/** One off-screen person as "Their people" lists them. */
export type PeopleOne = {
  id: string;
  name: string;
  kind: TieKindId | null;
  label: string | null;
  line: string | null;
  emoji: string | null;
  pronouns: string | null;
  note: string | null;
  deceased: boolean;
  visibility: Visibility;
  story: string | null;
  since: string | null;
  declared: boolean;
};
/** One of their places, and who else on the site shares it in that role. */
export type PeoplePlace = {
  place_id: string;
  key: string;
  name: string;
  role: string;
  words: string;
  since: string | null;
  visibility: Visibility;
  declared: boolean;
  others: SocialNode[];
};
/** "Their people": a character's circle as this viewer may see it, and whether they may change it. */
export type TheirPeople = {
  character: { id: string; name: string; mine: boolean; editable: boolean; show: boolean };
  people: PeopleOne[];
  ties: PeopleTie[];
  places: PeoplePlace[];
};

/**
 * A character's circle for "Their people" (and MCP get_circle): what the viewer may see of it (2a's egoNetwork: the
 * public, plus what's theirs), read from the character's side, with what the viewer may do. Null when the character
 * isn't listed, the switches are off, or (a private character) the viewer isn't its owner.
 */
export async function theirPeople(db: Db, characterId: string, viewer: string | null, env: Env = process.env): Promise<TheirPeople | null> {
  if (!socialDeclareOn(env)) return null;
  // One wave: the world (2a's read), the character, and who declared each of its places.
  const [ego, chars, memberRows] = await Promise.all([
    egoNetwork(db, characterId, { viewer, env }),
    charactersOf(db, [characterId]),
    db.query<{ place_id: string; role: string; source: string }>(`select place_id, role, source from social_place_members where character_id = $1`, [characterId]),
  ]);
  const c = chars.get(characterId);
  if (!ego || !c) return null;
  const mine = Boolean(viewer) && c.owner_id === viewer;
  // A private character's people are its owner's to see (its world shows anyone else its name only).
  if (ego.centre.private && !mine) return null;
  // Whether it's the show's matters to its owner (it's read-only to them); anyone else can't change it either way.
  const show = c.is_house || (mine && (await isShows(db, c)));
  const nodes = new Map(ego.nodes.map((n) => [n.id, n]));
  const declaredSource = (s: string | undefined) => s === "owner" || s === "agent";

  const people: PeopleOne[] = ego.people.map((p) => {
    const tie = ego.ties.find((t) => t.to_person === p.id && t.from === characterId);
    const d = tie ? TIE_KINDS[tie.kind] : null;
    return {
      id: p.id,
      name: p.name,
      kind: tie?.kind ?? null,
      label: d?.words.to ?? null,
      line: tie ? tieLine(tie.kind, true) : null,
      emoji: d?.emoji ?? null,
      pronouns: p.pronouns,
      note: p.note,
      deceased: p.deceased,
      visibility: p.visibility,
      story: tie?.story ?? null,
      since: tie?.since_text ?? null,
      declared: declaredSource(tie?.source),
    };
  });

  const ties: PeopleTie[] = [];
  for (const t of ego.ties) {
    if (!t.to) continue;
    const otherId = t.from === characterId ? t.to : t.from;
    const other = nodes.get(otherId);
    if (!other) continue;
    const d = TIE_KINDS[t.kind];
    // A proposal shows only to an owner of one of its ends (2a's read): this character's, or else the other's. It waits
    // on the viewer when their end is the one asked.
    let waiting: PeopleTie["waiting"] = null;
    if (t.status === "proposed") {
      const asking = t.detail.proposed_from === t.to ? t.to : t.from;
      waiting = (mine ? characterId : otherId) === asking ? "on_them" : "on_you";
    }
    ties.push({
      id: t.id,
      other,
      kind: t.kind,
      label: t.from === characterId ? d.words.to : d.words.from,
      line: tieLine(t.kind, t.from === characterId),
      layer: t.layer,
      emoji: d.emoji,
      status: t.status,
      visibility: t.visibility,
      story: t.story,
      since: t.since_text,
      declared: declaredSource(t.source),
      waiting,
    });
  }

  const placeById = new Map(ego.places.map((p) => [p.id, p]));
  const places: PeoplePlace[] = [];
  const memberSources = new Map(memberRows.rows.map((r) => [`${r.place_id}|${r.role}`, r.source]));
  for (const m of ego.memberships) {
    const place = placeById.get(m.place_id);
    if (!place || m.ended_at || m.role === "visited") continue;
    const others = ego.shared
      .filter((s) => s.place_id === m.place_id && s.role === m.role)
      .map((s) => nodes.get(s.a === characterId ? s.b : s.a))
      .filter((n): n is SocialNode => Boolean(n));
    places.push({
      place_id: m.place_id,
      key: place.key,
      name: place.name,
      role: m.role,
      words: `${ROLE_WORDS[m.role]} ${place.name}`,
      since: m.since_text,
      visibility: m.visibility,
      declared: declaredSource(memberSources.get(`${m.place_id}|${m.role}`)),
      others,
    });
  }
  return { character: { id: c.id, name: c.name, mine, editable: mine && !show && c.listed, show }, people, ties, places };
}

/** The places an owner picks from: the show's world, and the workplaces and schools they named themselves. */
export async function placeMenu(db: Db, userId: string, env: Env = process.env): Promise<WorldMenu> {
  const world = await worldMenu(db, env);
  const { rows } = await db.query<{ key: string; name: string; kind: string; parent: string | null }>(
    `select p.key, p.name, p.kind, n.name as parent from social_places p left join social_places n on n.id = p.parent_id
      where p.kind in ('workplace', 'school') and p.created_by = $1 and p.visibility = 'public' order by p.created_at, p.key limit 50`,
    [userId],
  );
  const known = new Set(world.workplaces.map((w) => w.key));
  return { ...world, workplaces: [...world.workplaces, ...rows.filter((r) => !known.has(r.key)).map((r) => ({ key: r.key, name: r.name, kind: r.kind as PlaceKind, neighbourhood: r.parent }))] };
}

/** A character the tie form can pick. */
export type TieCandidate = { id: string; name: string; portrait: string | null; hue: number | null; mine: boolean };

/**
 * Characters one of your characters may be tied to, for the form's picker: yours first, then the public who match by
 * name (two letters at least). Never the house or the show's cast, a private one of someone else's, or across a block.
 */
export async function tieCandidates(db: Db, by: DeclareBy, characterId: string, query: string, limit = 8, env: Env = process.env): Promise<{ ok: true; candidates: TieCandidate[] } | Refusal> {
  const e = await editable(db, by, characterId, env);
  if (!e.ok) return e;
  const q = clean(query).toLowerCase().slice(0, 60);
  if (q.length < 2) return { ok: true, candidates: [] };
  const words = [...new Set(q.split(" ").filter(Boolean))].slice(0, 4).map((w) => `%${w.replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
  const { rows } = await db.query<{ id: string; name: string; owner_id: string | null; created_via: string | null; portrait: string | null; hue: number | null }>(
    `select c.id, c.name, c.owner_id, c.created_via, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait
       from characters c
      where c.id <> $1 and lower(c.name) like all($2::text[]) and not c.is_house
        and c.owner_id is distinct from $4 and ${notPersonaSql("c")}
        and (c.visibility = 'public' or c.owner_id = $3)
        and not exists (select 1 from blocks b where (b.blocker_id = $3 and b.blocked_id = c.owner_id) or (b.blocker_id = c.owner_id and b.blocked_id = $3))
      order by coalesce(c.owner_id = $3, false) desc, lower(c.name) like $5 desc, lower(c.name), c.id
      limit $6`,
    [characterId, words, by.userId, DELETED_OWNER, `${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`, limit * 2],
  );
  const made = rows.filter((r) => r.created_via === "mcp").map((r) => r.id);
  const shows = made.length ? await showCharacterIds(db, made, { ours: await ourIdsCached(db) }) : new Map();
  const candidates = rows
    .filter((r) => !shows.has(r.id))
    .slice(0, limit)
    .map((r) => ({ id: r.id, name: r.name, portrait: r.portrait, hue: r.hue, mine: r.owner_id === by.userId }));
  return { ok: true, candidates };
}
