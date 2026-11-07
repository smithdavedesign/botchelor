/**
 * Next season's format, by the viewers (David 2026-11-07: "a way to vote on the next type of show for the next season…
 * take the best reality tv shows with a bot twist"). All month, anyone with the site's cookie votes for the format
 * (lib/season-format.ts) the NEXT season runs in, one vote a viewer, changeable until the month ends. When the next
 * season starts, the winner is its format: lib/season-format-store.ts reads the ballot for any season with no
 * admin-picked row, so nothing runs at midnight and nothing can be missed.
 *
 *  - The ballot is every format, the one running now included (a format the viewers love can run again).
 *  - A winner needs SEASON_VOTE_MIN votes in all: below that the season is classic, so one stray vote never reformats a
 *    month. Ties go to the format listed first (classic first), so it never depends on timing.
 *  - An admin's pick on /admin/season (a season_formats row) always wins over the ballot.
 *  - Votes can only be cast for the season after the one running, so a ballot is frozen the moment its season starts.
 *  - $0: a table and a count, no model call.
 */
import type { Db } from "./db";
import { notifyAll } from "./notifications";
import { SEASON_FORMATS, SEASON_FORMAT_SLUGS, seasonFormat, type SeasonFormatSlug } from "./season-format";
import { nextSeasonStart, seasonIdOf, seasonLabel, seasonWindow } from "./season-window";

/** Votes a ballot needs in all before its winner sets a season's format; fewer and the season is classic. */
export const SEASON_VOTE_MIN = 3;

/** The season the ballot open now is for: the one after the season running at `now`. */
export const ballotSeasonId = (now: Date): string => seasonIdOf(nextSeasonStart(now));

const isSlug = (s: string): s is SeasonFormatSlug => (SEASON_FORMAT_SLUGS as readonly string[]).includes(s);

/** A season's ballot, as counts by format. */
export async function seasonBallotTally(db: Db, seasonId: string): Promise<Map<SeasonFormatSlug, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(
    `select pick, count(*)::int as n from season_format_votes where season_id = $1 group by pick`,
    [seasonId],
  );
  return new Map(rows.filter((r) => isSlug(r.pick)).map((r) => [r.pick as SeasonFormatSlug, r.n]));
}

/** The ballot's winner: most votes, ties to the format listed first; null under SEASON_VOTE_MIN votes in all. */
export function ballotWinner(tally: Map<SeasonFormatSlug, number>): SeasonFormatSlug | null {
  const total = [...tally.values()].reduce((s, n) => s + n, 0);
  if (total < SEASON_VOTE_MIN) return null;
  let best: SeasonFormatSlug | null = null;
  for (const f of SEASON_FORMATS) if ((tally.get(f.slug) ?? 0) > 0 && (!best || (tally.get(f.slug) ?? 0) > (tally.get(best) ?? 0))) best = f.slug;
  return best;
}

export type SeasonVoteResult = { ok: true; pick: SeasonFormatSlug; season_id: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote for next season's format (a second vote changes it). */
export async function voteSeasonFormat(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<SeasonVoteResult> {
  if (!isSlug(pick)) return { ok: false, status: 400, error: "not_on_the_ballot", message: "That isn't one of next season's formats." };
  const seasonId = ballotSeasonId(now);
  await db.query(
    `insert into season_format_votes (season_id, user_id, pick) values ($1, $2, $3)
     on conflict (season_id, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [seasonId, userId, pick],
  );
  return { ok: true, pick, season_id: seasonId };
}

export type SeasonBallot = {
  season_id: string;
  /** "December 2026". */
  season_label: string;
  /** When voting ends: the moment next season starts. */
  closes_at: string;
  /** The format running now (the card says "running now" on it). */
  current: SeasonFormatSlug;
  choices: { slug: SeasonFormatSlug; title: string; pitch: string; emoji: string; votes: number }[];
  total: number;
  my_pick: SeasonFormatSlug | null;
  /** The format leading with enough votes to win, or null (next season would be classic as it stands). */
  leading: SeasonFormatSlug | null;
  min_votes: number;
};

/** The ballot as one viewer sees it. Counts are sent only once they've voted, so the first voters don't follow the crowd. */
export async function seasonBallot(db: Db, viewerId: string | null, current: SeasonFormatSlug, now: Date = new Date()): Promise<SeasonBallot> {
  const seasonId = ballotSeasonId(now);
  const [tally, mine] = await Promise.all([
    seasonBallotTally(db, seasonId),
    viewerId
      ? db.query<{ pick: string }>(`select pick from season_format_votes where season_id = $1 and user_id = $2`, [seasonId, viewerId]).then((r) => r.rows[0]?.pick ?? null)
      : Promise.resolve(null),
  ]);
  const myPick = mine && isSlug(mine) ? mine : null;
  const total = [...tally.values()].reduce((s, n) => s + n, 0);
  return {
    season_id: seasonId,
    season_label: seasonLabel(seasonId),
    closes_at: nextSeasonStart(now).toISOString(),
    current,
    choices: SEASON_FORMATS.map((f) => ({ slug: f.slug, title: f.title, pitch: f.pitch, emoji: f.emoji, votes: myPick ? (tally.get(f.slug) ?? 0) : 0 })),
    total: myPick ? total : 0,
    my_pick: myPick,
    leading: myPick ? ballotWinner(tally) : null,
    min_votes: SEASON_VOTE_MIN,
  };
}

/** The title a slug goes by on the ballot. */
export const ballotTitle = (slug: SeasonFormatSlug): string => seasonFormat(slug).title;

export type BallotResult = { season_id: string; winner: SeasonFormatSlug | null; votes: number; total: number };

/** A season's announced ballot result (null until the hourly job announces it, or when nobody voted). */
export async function ballotResult(db: Db, seasonId: string): Promise<BallotResult | null> {
  const r = (await db.query<{ winner: string | null; votes: number; total: number }>(`select winner, votes, total from season_vote_results where season_id = $1`, [seasonId])).rows[0];
  return r ? { season_id: seasonId, winner: r.winner && isSlug(r.winner) ? r.winner : null, votes: r.votes, total: r.total } : null;
}

/** How long into a season the hourly job still announces its ballot (a job down for a day still gets there). */
const ANNOUNCE_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The season turned: tell everyone who voted on its ballot how it went, once (a claim row in season_vote_results), in
 * the season's first three days (the hourly lobby job calls this). `running` is the format the season actually runs
 * (an admin's pick can differ from the ballot's winner, and the notice says what's on, never what isn't). A ballot
 * nobody voted on announces nothing.
 */
export async function announceBallotResult(db: Db, running: SeasonFormatSlug, now: Date = new Date()): Promise<BallotResult | null> {
  const seasonId = seasonIdOf(now);
  if (now.getTime() - seasonWindow(now).start.getTime() > ANNOUNCE_WITHIN_MS) return null;
  const tally = await seasonBallotTally(db, seasonId);
  const total = [...tally.values()].reduce((s, n) => s + n, 0);
  if (!total) return null;
  const winner = ballotWinner(tally);
  const votes = winner ? (tally.get(winner) ?? 0) : 0;
  const claimed = await db.query(
    `insert into season_vote_results (season_id, winner, votes, total) values ($1, $2, $3, $4) on conflict (season_id) do nothing returning season_id`,
    [seasonId, winner, votes, total],
  );
  if (!claimed.rows.length) return null;
  const voters = (await db.query<{ user_id: string; pick: string }>(`select user_id, pick from season_format_votes where season_id = $1`, [seasonId])).rows;
  const on = seasonFormat(running);
  const link = "/watch#this-week";
  const label = seasonLabel(seasonId);
  if (winner && winner === running) {
    await notifyAll(db, voters.filter((v) => v.pick === winner).map((v) => v.user_id), {
      kind: "season_vote",
      title: `📺 Your pick won: ${on.title} is ${label}'s show`,
      body: `${votes} of ${total} votes. ${on.announce}`,
      link,
    });
    await notifyAll(db, voters.filter((v) => v.pick !== winner).map((v) => v.user_id), {
      kind: "season_vote",
      title: `📺 The viewers picked ${on.title} for ${label}`,
      body: `${votes} of ${total} votes. ${on.announce}`,
      link,
    });
  } else {
    await notifyAll(db, voters.map((v) => v.user_id), {
      kind: "season_vote",
      title: `📺 ${label} is ${on.title}`,
      body: winner ? on.announce : `Not enough votes to pick this time (${total} of the ${SEASON_VOTE_MIN} needed). ${on.announce} Next month's ballot is open.`,
      link,
    });
  }
  return { season_id: seasonId, winner, votes, total };
}
