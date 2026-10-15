/**
 * The $0 spectator mechanics built on the engine (PRD "Further ideas"): guess the dealbreaker, the
 * matchmakers, and the surprise score (know your own AI). They use data the app already collects and
 * need no model call. Their points are free and, like all points here, cannot be bought or transferred.
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { POINTS_PER_DEALBREAKER_PICK, POINTS_PER_MATCHMAKER, type Ending } from "./rules";
import { seasonCastIds } from "./season-cast";

export const DEALBREAKER_OPTIONS = 4;

/**
 * SQL (boolean): a matchmaker proposal `mp` has paid off if a date between its pair ended in a revealed
 * second date after the proposal was made. The proposer is filtered by the caller's own WHERE clause.
 * Used both for scoring (lib/game.ts getPoints) and for listing a proposer's results.
 */
export function matchmakerHitSql(): string {
  return `exists (
    select 1 from episodes e2
     where e2.ending = 'second_date' and e2.revealed_at is not null and e2.created_at > mp.created_at
       and ((e2.character_a = mp.character_a and e2.character_b = mp.character_b)
         or (e2.character_a = mp.character_b and e2.character_b = mp.character_a)))`;
}

export type DealbreakerQuiz = {
  /** The four options (character_a's real dealbreaker plus three decoys), in a seeded, stable order. */
  options: string[];
  my_pick: string | null;
  revealed: boolean;
  /** The real dealbreaker, only once the finale has aired (or to a creator). */
  answer?: string;
  correct?: boolean;
};

/**
 * The four dealbreaker options for an episode: character_a's real one plus three distinct decoys drawn
 * from the rest of the cast, ordered by a per-episode seed so the real one isn't always in one place.
 * Fully deterministic, so the options never shuffle between page loads.
 */
export async function getDealbreakerQuiz(
  db: Db,
  episodeId: string,
  viewerId: string | null,
): Promise<DealbreakerQuiz | null> {
  const { rows } = await db.query<{ seed: string | null; real: string; revealed: boolean; is_creator: boolean }>(
    `select e.seed::text as seed, a.dealbreaker as real, e.revealed_at is not null as revealed,
            coalesce($2::text in (a.owner_id, b.owner_id), false) as is_creator
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId, viewerId],
  );
  if (!rows[0]) return null;
  const { real } = rows[0];
  const seed = Number(rows[0].seed ?? seedFrom(episodeId));
  const decoys = (
    await db.query<{ d: string }>(
      `select d from (select distinct dealbreaker as d from characters where dealbreaker <> $1) s
        order by md5(d || $2) limit 3`,
      [real, String(seed)],
    )
  ).rows.map((r) => r.d);
  // Stable, seed-dependent order independent of how the rows arrived.
  const options = [real, ...decoys].sort((x, y) => seedFrom(x, seed) - seedFrom(y, seed));
  const mine = viewerId
    ? (await db.query<{ pick: string }>("select pick from dealbreaker_guesses where episode_id = $1 and user_id = $2", [episodeId, viewerId])).rows[0]
    : undefined;
  const open = rows[0].revealed || rows[0].is_creator;
  const quiz: DealbreakerQuiz = { options, my_pick: mine?.pick ?? null, revealed: rows[0].revealed };
  if (open) {
    quiz.answer = real;
    if (mine) quiz.correct = mine.pick === real;
  }
  return quiz;
}

/** The surprise reveal (PRD "know your own AI"): the owner's guess at their own AI's ending vs. what it did. */
export type Surprise = { self_pick: Ending; actual: Ending; surprised: boolean };

export async function getSurprise(db: Db, episodeId: string, viewerId: string | null): Promise<Surprise | null> {
  if (!viewerId) return null;
  const { rows } = await db.query<{ self_pick: Ending | null; actual: Ending }>(
    `select e.self_pick, e.ending as actual
       from episodes e
      where e.id = $1 and e.creator_id = $2`,
    [episodeId, viewerId],
  );
  const row = rows[0];
  if (!row || !row.self_pick) return null;
  return { self_pick: row.self_pick, actual: row.actual, surprised: row.self_pick !== row.actual };
}

/** How often this owner's AI surprised them: the share of their self-predictions that were wrong. */
export async function getSurpriseScore(db: Db, userId: string): Promise<{ dates: number; surprises: number }> {
  const { rows } = await db.query<{ dates: number; surprises: number }>(
    `select count(*)::int as dates,
            (count(*) filter (where self_pick <> ending))::int as surprises
       from episodes where creator_id = $1 and self_pick is not null`,
    [userId],
  );
  return rows[0] ?? { dates: 0, surprises: 0 };
}

export type MatchmakerProposal = {
  id: string;
  character_a: { id: string; name: string };
  character_b: { id: string; name: string };
  paid_off: boolean;
  created_at: string;
};

export async function listMyProposals(db: Db, userId: string): Promise<MatchmakerProposal[]> {
  const { rows } = await db.query<{
    id: string;
    a_id: string;
    a_name: string;
    b_id: string;
    b_name: string;
    paid_off: boolean;
    created_at: Date;
  }>(
    `select mp.id, a.id as a_id, a.name as a_name, b.id as b_id, b.name as b_name, mp.created_at,
            ${matchmakerHitSql()} as paid_off
       from matchmaker_proposals mp
       join characters a on a.id = mp.character_a
       join characters b on b.id = mp.character_b
      where mp.proposer_id = $1
      order by mp.created_at desc`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    character_a: { id: r.a_id, name: r.a_name },
    character_b: { id: r.b_id, name: r.b_name },
    paid_off: r.paid_off,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

export type CastMember = {
  id: string;
  name: string;
  traits: string[];
  house: boolean;
  hue: number | null;
  /** Made by an AI agent over MCP (badged as such). */
  agent: boolean;
};

/**
 * The cast a spectator can matchmake from: the characters people and agents made, newest first, then this
 * season's handful of house characters (lib/season-cast.ts). Off-season and premium house characters sit out.
 */
export async function listCast(db: Db, limit = 40): Promise<CastMember[]> {
  const { rows } = await db.query<CastMember>(
    `select id, name, traits, is_house as house, avatar_hue as hue, created_via = 'mcp' as agent
       from characters
      where not is_house or (premium_sku is null and id = any($2))
      order by is_house, created_at desc, id
      limit $1`,
    [limit, seasonCastIds()],
  );
  return rows;
}

export type RelationshipEdge = {
  a: string;
  b: string;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  /** A progression label, the companion apps' "stage" done our way (strangers → sparks → an item). */
  stage: string;
};

/** A relationship's progression stage from its history. Pure, so it is unit-tested. */
export function relationshipStage(dates: number, secondDates: number, lastEnding: Ending | null): string {
  if (dates === 0) return "strangers";
  if (secondDates >= 2) return "an item";
  if (secondDates === 1 || lastEnding === "second_date") return "sparks";
  if (lastEnding === "friends") return "just friends";
  if (lastEnding === "disaster") return "it's complicated";
  return "acquaintances";
}

/** The relationship graph (PRD "the relationship graph"): one edge per pair that has dated, by name. */
export async function listRelationshipEdges(db: Db, limit = 40): Promise<RelationshipEdge[]> {
  const { rows } = await db.query<Omit<RelationshipEdge, "stage">>(
    `select ca.name as a, cb.name as b, r.dates, r.second_dates, r.last_ending
       from relationships r
       join characters ca on ca.id = r.character_a
       join characters cb on cb.id = r.character_b
      order by r.updated_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, stage: relationshipStage(r.dates, r.second_dates, r.last_ending) }));
}

export { POINTS_PER_DEALBREAKER_PICK, POINTS_PER_MATCHMAKER };
