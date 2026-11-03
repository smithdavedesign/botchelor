/**
 * Auditions (David, 2026-11-03: "seems like they should be able to submit their character as a potential cast ...
 * ideally we have real people's characters instead of bots since it's more fun for real users").
 *
 * A person puts one of their own characters up for NEXT month's cast. Only a character a person made on the site can
 * audition: never a house character, never one an agent made over MCP. The audience votes (one vote a viewer a
 * season, changeable), the admin approves or turns each down (/admin/season), and when the next season picks its cast
 * the approved auditions with the most votes take the open places before any generated house newcomer does
 * (lib/season-cast.ts). Auditioning is the owner's consent to what being cast means, said on the button: anyone can
 * take the character on a date for the month at the show's expense, the sheet is locked while it's on, and the owner
 * can withdraw it at any time.
 */
import { portraitPathSql } from "./assets";
import { hasAccount } from "./auth";
import type { Db } from "./db";
import type { CharacterExtras } from "./extras";
import { notify } from "./notifications";
import { pgFlags } from "./pg-public";
import { AUDITION_BLOCKS, AUDITION_MIN_DATES, type AuditionBlock } from "./audition-words";
import { DELETED_OWNER } from "./rules";
import { forgetLoadedSeasonCast } from "./season-cast";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "./season-window";

/** The season auditions are open for: the next one. */
export const auditionSeasonId = (now: Date = new Date()): string => seasonIdOf(nextSeasonStart(now));

export { AUDITION_BLOCKS, AUDITION_MIN_DATES, type AuditionBlock };

export type AuditionStatus = "open" | "approved" | "rejected" | "withdrawn";


type Row = {
  id: string;
  owner_id: string | null;
  is_house: boolean;
  created_via: string;
  visibility: string;
  open_to_dates: boolean;
  bio: string | null;
  want: string | null;
  dealbreaker: string | null;
  appearance: string | null;
  voice: string | null;
  traits: string[] | null;
  extras: CharacterExtras | null;
  portrait: string | null;
  aired: number;
};

/** Aired, public, unhidden dates: what the audience can see of a character. */
const AIRED_SQL = (alias: string) =>
  `(select count(*)::int from episodes e
     where (e.character_a = ${alias}.id or e.character_b = ${alias}.id)
       and e.status = 'ready' and e.revealed_at is not null and e.visibility = 'public')`;

async function load(db: Db, characterId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(
    `select c.id, c.owner_id, c.is_house, c.created_via, c.visibility, c.open_to_dates, c.bio, c.want, c.dealbreaker,
            c.appearance, c.voice, c.traits, c.extras,
            ${portraitPathSql("c")} as portrait,
            ${AIRED_SQL("c")} as aired
       from characters c where c.id = $1`,
    [characterId],
  );
  return rows[0] ?? null;
}

/** Everything standing between this character and an audition this season, for this person (empty: it can). */
export async function auditionBlocks(
  db: Db,
  auth: { userId: string; authenticated: boolean },
  characterId: string,
  now: Date = new Date(),
): Promise<AuditionBlock[]> {
  const c = await load(db, characterId);
  if (!c || c.owner_id !== auth.userId || c.owner_id === DELETED_OWNER) return ["not_yours"];
  if (c.is_house) return ["house"];
  if (c.created_via !== "web") return ["agent_made"];
  const out: AuditionBlock[] = [];
  if (!auth.authenticated || !(await hasAccount(db, auth.userId))) out.push("sign_in");
  if (c.visibility !== "public") out.push("private");
  if (!c.open_to_dates) out.push("not_open");
  if (pgFlags(c).length) out.push("pg");
  if (!c.portrait) out.push("portrait");
  if (c.aired < AUDITION_MIN_DATES) out.push("dates");
  const season = auditionSeasonId(now);
  const theirs = (
    await db.query<{ character_id: string; status: AuditionStatus }>(
      `select character_id, status from cast_auditions where season_id = $1 and owner_id = $2 and status <> 'withdrawn'`,
      [season, auth.userId],
    )
  ).rows;
  if (theirs.some((a) => a.character_id === characterId && a.status === "rejected")) out.push("rejected");
  else if (theirs.some((a) => a.character_id !== characterId)) out.push("one_each");
  return out;
}

export type AuditionResult = { ok: true; season_id: string } | { ok: false; status: number; error: string; message: string; blocks?: AuditionBlock[] };

/** Puts a character up for next month's cast (again, after a withdrawal). The caller has the owner's consent. */
export async function audition(db: Db, auth: { userId: string; authenticated: boolean }, characterId: string, now: Date = new Date()): Promise<AuditionResult> {
  const season = auditionSeasonId(now);
  const current = (await db.query<{ status: AuditionStatus }>(`select status from cast_auditions where season_id = $1 and character_id = $2`, [season, characterId])).rows[0];
  if (current && (current.status === "open" || current.status === "approved")) return { ok: true, season_id: season };
  const blocks = await auditionBlocks(db, auth, characterId, now);
  if (blocks.length) {
    const status = blocks.includes("not_yours") ? 404 : blocks.includes("sign_in") ? 401 : 409;
    return { ok: false, status, error: blocks[0] === "not_yours" ? "character_not_found" : "cannot_audition", message: AUDITION_BLOCKS[blocks[0]], blocks };
  }
  await db.query(
    `insert into cast_auditions (season_id, character_id, owner_id) values ($1, $2, $3)
     on conflict (season_id, character_id) do update set status = 'open', owner_id = excluded.owner_id, created_at = now(), decided_at = null`,
    [season, characterId, auth.userId],
  );
  return { ok: true, season_id: season };
}

/**
 * Takes a character out: out of next month's auditions (its votes go with it), and off this month's cast if it's on
 * it (off at once, its sheet unlocked). False when it was in neither.
 */
export async function withdrawAudition(db: Db, userId: string, characterId: string, now: Date = new Date()): Promise<boolean> {
  const season = auditionSeasonId(now);
  const { rows } = await db.query(
    `update cast_auditions set status = 'withdrawn', decided_at = now()
      where season_id = $1 and character_id = $2 and owner_id = $3 and status in ('open', 'approved') returning character_id`,
    [season, characterId, userId],
  );
  if (rows.length) await db.query(`delete from audition_votes where season_id = $1 and character_id = $2`, [season, characterId]);
  const left = await db.query(
    `update season_casts s set withdrawn_at = now()
       from characters c
      where s.season_id = $1 and s.character_id = $2 and c.id = s.character_id and c.owner_id = $3 and not c.is_house and s.withdrawn_at is null
      returning s.character_id`,
    [seasonIdOf(now), characterId, userId],
  );
  if (left.rows.length) forgetLoadedSeasonCast();
  return rows.length > 0 || left.rows.length > 0;
}

/** Whether this character is on this month's show as a fan pick (and not withdrawn): its sheet is locked meanwhile. */
export async function onFanCast(db: Db, characterId: string, now: Date = new Date()): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from season_casts s join characters c on c.id = s.character_id
      where s.season_id = $1 and s.character_id = $2 and not c.is_house and s.withdrawn_at is null`,
    [seasonIdOf(now), characterId],
  );
  return rows.length > 0;
}

/**
 * Once a season's cast is picked (lib/season-cast.ts ensureSeasonCast): each person whose character is on it hears so,
 * and each shortlisted audition that didn't get a place hears that too.
 */
export async function tellCastOwners(db: Db, season: string, picks: readonly { character_id: string; source: string }[]): Promise<void> {
  const onIt = picks.map((p) => p.character_id);
  const month = seasonLabel(season);
  const { rows } = await db.query<{ id: string; name: string; owner_id: string; is_on: boolean; auditioned: boolean }>(
    `select c.id, c.name, c.owner_id, c.id = any($2) as is_on,
            exists (select 1 from cast_auditions a where a.season_id = $1 and a.character_id = c.id and a.status = 'approved') as auditioned
       from characters c
      where not c.is_house and c.owner_id is distinct from 'deleted'
        and (c.id = any($2) or exists (select 1 from cast_auditions a where a.season_id = $1 and a.character_id = c.id and a.status = 'approved'))`,
    [season, onIt],
  );
  for (const r of rows) {
    if (r.is_on) {
      const stayed = picks.find((p) => p.character_id === r.id)?.source === "survivor";
      await notify(db, r.owner_id, {
        kind: "audition",
        title: stayed ? `${r.name} stays on the cast for ${month}` : `${r.name} is on the ${month} cast`,
        body: `For ${month}, anyone can take ${r.name} on a date by name and the show books it into the lobby. Its sheet is locked until the month ends. You can take it off the show any time from its page.`,
        link: `/characters/${r.id}`,
      });
    } else if (r.auditioned) {
      await notify(db, r.owner_id, {
        kind: "audition",
        title: `${r.name} didn't make the ${month} cast`,
        body: "Others got more votes this time. It can audition again for next month.",
        link: "/casting",
      });
    }
  }
}

/** The admin's call on an audition (/admin/season); the owner hears either way. False when there's no such audition. */
export async function reviewAudition(db: Db, characterId: string, verdict: "approved" | "rejected", now: Date = new Date()): Promise<boolean> {
  const season = auditionSeasonId(now);
  const { rows } = await db.query<{ owner_id: string; name: string }>(
    `update cast_auditions a set status = $3, decided_at = now()
       from characters c
      where a.season_id = $1 and a.character_id = $2 and c.id = a.character_id and a.status in ('open', 'approved', 'rejected')
      returning a.owner_id, c.name`,
    [season, characterId, verdict],
  );
  const row = rows[0];
  if (!row) return false;
  const month = seasonLabel(season);
  await notify(db, row.owner_id, {
    kind: "audition",
    title: verdict === "approved" ? `${row.name} made the shortlist for ${month}` : `${row.name} wasn't picked for ${month}`,
    body:
      verdict === "approved"
        ? `The votes decide who gets the open places when ${month} starts. Share the casting page to get them.`
        : "It wasn't picked this time. It can audition again next month.",
    link: verdict === "approved" ? "/casting" : `/characters/${characterId}`,
  });
  return true;
}

export type VoteResult = { ok: true; character_id: string } | { ok: false; status: number; error: string; message: string };

/** A viewer's vote for one audition this season (a second vote moves it). Not for your own character. */
export async function voteAudition(db: Db, voterId: string, characterId: string, now: Date = new Date()): Promise<VoteResult> {
  const season = auditionSeasonId(now);
  const a = (await db.query<{ owner_id: string }>(`select owner_id from cast_auditions where season_id = $1 and character_id = $2 and status in ('open', 'approved')`, [season, characterId])).rows[0];
  if (!a) return { ok: false, status: 404, error: "not_auditioning", message: "That character isn't auditioning this month." };
  if (a.owner_id === voterId) return { ok: false, status: 409, error: "own_character", message: "You can't vote for your own character: share the page instead." };
  await db.query(
    `insert into audition_votes (season_id, voter_id, character_id) values ($1, $2, $3)
     on conflict (season_id, voter_id) do update set character_id = excluded.character_id, updated_at = now()`,
    [season, voterId, characterId],
  );
  return { ok: true, character_id: characterId };
}

export type AuditionCard = {
  character_id: string;
  name: string;
  bio: string;
  hue: number | null;
  portrait: string | null;
  status: "open" | "approved";
  votes: number;
  aired: number;
};
export type CastingBoard = { season_id: string; label: string; closes_at: string; auditions: AuditionCard[]; my_vote: string | null };

/** This season's auditions, most votes first (shortlisted first on a tie), and this viewer's vote. */
export async function castingBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<CastingBoard> {
  const season = auditionSeasonId(now);
  const { rows } = await db.query<AuditionCard>(
    `select a.character_id, c.name, c.bio, c.avatar_hue as hue,
            ${portraitPathSql("c")} as portrait,
            a.status, (select count(*)::int from audition_votes v where v.season_id = a.season_id and v.character_id = a.character_id) as votes,
            ${AIRED_SQL("c")} as aired
       from cast_auditions a join characters c on c.id = a.character_id
      where a.season_id = $1 and a.status in ('open', 'approved') and c.visibility = 'public' and c.owner_id = a.owner_id
      order by votes desc, (a.status = 'approved') desc, a.created_at`,
    [season],
  );
  const mine = viewerId
    ? ((await db.query<{ character_id: string }>(`select character_id from audition_votes where season_id = $1 and voter_id = $2`, [season, viewerId])).rows[0]?.character_id ?? null)
    : null;
  return { season_id: season, label: seasonLabel(season), closes_at: nextSeasonStart(now).toISOString(), auditions: rows, my_vote: mine };
}

/**
 * The approved auditions for a season, most votes first: who gets the open places (lib/season-cast.ts). A character
 * that has since gone private, changed hands or lost its consent (withdrawn) isn't among them.
 */
export async function shortlist(db: Db, season: string): Promise<string[]> {
  const { rows } = await db.query<{ character_id: string }>(
    `select a.character_id
       from cast_auditions a join characters c on c.id = a.character_id
      where a.season_id = $1 and a.status = 'approved' and c.visibility = 'public' and c.open_to_dates and c.owner_id = a.owner_id
      order by (select count(*) from audition_votes v where v.season_id = a.season_id and v.character_id = a.character_id) desc, a.decided_at, a.character_id`,
    [season],
  );
  return rows.map((r) => r.character_id);
}

export type MyAudition = {
  season_id: string;
  label: string;
  status: AuditionStatus | null;
  votes: number;
  blocks: AuditionBlock[];
  /** On this month's show as a fan pick: the month it's on, and when its sheet unlocks. */
  on_cast: { label: string; until: string } | null;
};

/** What the owner's audition panel shows for one of their characters. */
export async function myAudition(db: Db, auth: { userId: string; authenticated: boolean }, characterId: string, now: Date = new Date()): Promise<MyAudition> {
  const season = auditionSeasonId(now);
  const row = (
    await db.query<{ status: AuditionStatus; votes: number }>(
      `select a.status, (select count(*)::int from audition_votes v where v.season_id = a.season_id and v.character_id = a.character_id) as votes
         from cast_auditions a where a.season_id = $1 and a.character_id = $2`,
      [season, characterId],
    )
  ).rows[0];
  const live = row && (row.status === "open" || row.status === "approved");
  const onCast = (await onFanCast(db, characterId, now)) ? { label: seasonLabel(seasonIdOf(now)), until: nextSeasonStart(now).toISOString() } : null;
  return {
    season_id: season,
    label: seasonLabel(season),
    status: row?.status ?? null,
    votes: row?.votes ?? 0,
    blocks: live ? [] : await auditionBlocks(db, auth, characterId, now),
    on_cast: onCast,
  };
}

/** The admin's queue for a season: every audition still in play, with its votes. */
export async function listAuditions(db: Db, season: string): Promise<{ character_id: string; name: string; status: AuditionStatus; votes: number; aired: number; portrait: string | null }[]> {
  const { rows } = await db.query<{ character_id: string; name: string; status: AuditionStatus; votes: number; aired: number; portrait: string | null }>(
    `select a.character_id, c.name, a.status,
            (select count(*)::int from audition_votes v where v.season_id = a.season_id and v.character_id = a.character_id) as votes,
            ${AIRED_SQL("c")} as aired,
            ${portraitPathSql("c")} as portrait
       from cast_auditions a join characters c on c.id = a.character_id
      where a.season_id = $1 and a.status <> 'withdrawn'
      order by (a.status = 'open') desc, votes desc, a.created_at`,
    [season],
  );
  return rows;
}
