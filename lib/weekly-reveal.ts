/**
 * Sunday's reveal (docs/audits/2026-11-07-audit-and-benchmark.md, items 7 and 9): one big vote a week, in a short
 * window, with a real consequence aired at a fixed time. The daily situation and dare votes stay; this is the week's one
 * appointment.
 *
 *  - The window: Saturday VOTE_CLOSE_HOUR_UTC to Sunday VOTE_CLOSE_HOUR_UTC (24 hours), counted down everywhere it
 *    shows. The ballot is frozen when the vote opens (the hourly lobby job opens it): up to REVEAL_CHOICES of the
 *    season's house cast who still keep a secret (lib/cast-secrets.ts), the busiest this week first. One vote a viewer,
 *    changeable until it closes; the counts show once you've voted, as on the situation vote.
 *  - The consequence: at the next lobby pass (Sunday, :20 past the close), the winner's next secret comes out. It counts
 *    as out from then on, everywhere a secret shows (their page, "Since you were here"), and it never rides their side
 *    of a date again. The same pass makes one house date, live as an open room: the winner with the cast member they've
 *    dated most this season (else one dealt from the week), whose side alone carries a private note saying they've
 *    heard it. The engine still decides how the date ends, as with a dare (lib/dares.ts).
 *  - Nobody voted: the producers pick the top of the ballot, and every place that shows the result says so. A tie goes
 *    to the choice listed first (lib/situations.ts winnerOf), so it never depends on timing. The counts are published
 *    with the result ("Votes that feel rigged", the audit's list of what to avoid).
 *  - Cost: one lobby date a week on the show's default model, ~1–5¢. It counts toward the lobby's open room like the
 *    situation's (it runs before refreshLobby), so the week's busiest hour makes no extra room.
 */
import { portraitPathSql } from "./portrait-sql";
import { castSecrets, SECRETS_PER_CAST } from "./cast-secrets";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { notifyAll } from "./notifications";
import { shortName } from "./names";
import { seasonCastIds } from "./season-cast";
import { seasonIdOf, seasonWindow } from "./season-window";
import { winnerOf } from "./situations";
import { createTemplateParty } from "./watch";

/** The vote closes at this hour (UTC) on Sunday, and opened at the same hour on Saturday. */
export const VOTE_CLOSE_HOUR_UTC = 19;
/** How long the vote is open. */
export const VOTE_HOURS = 24;
/** How many cast members the ballot offers. */
export const REVEAL_CHOICES = 3;
/** The lobby job runs at :20 past the hour, so that's when the result airs. */
export const AIRS_AFTER_MINUTES = 20;
/** How many times the reveal's date is tried (one pass each) before the reveal stands without it. */
export const DATE_TRIES = 2;
/** How long the last reveal stays on the card once the next week's countdown starts. */
export const LAST_SHOWN_DAYS = 4;

const HOUR_MS = 60 * 60 * 1000;
/** The hourly job opens the vote on its first pass after the window starts: until then the card still counts down. */
const OPENING_GRACE_MS = HOUR_MS;
const DAY_MS = 24 * HOUR_MS;
const dayId = (d: Date): string => d.toISOString().slice(0, 10);

/** The Sunday (UTC, YYYY-MM-DD) of the reveal `now` counts toward: today on a Sunday, else the next one. */
export function revealDayOf(now: Date): string {
  const daysToSunday = (7 - now.getUTCDay()) % 7;
  return dayId(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + daysToSunday * DAY_MS));
}

/** When a week's vote closes (Sunday at VOTE_CLOSE_HOUR_UTC), opens (VOTE_HOURS before) and its result airs. */
export function revealTimes(day: string): { opens_at: Date; closes_at: Date; airs_at: Date } {
  const closes = Date.parse(`${day}T00:00:00Z`) + VOTE_CLOSE_HOUR_UTC * HOUR_MS;
  return { opens_at: new Date(closes - VOTE_HOURS * HOUR_MS), closes_at: new Date(closes), airs_at: new Date(closes + AIRS_AFTER_MINUTES * 60 * 1000) };
}

/** A producer's note for the partner's side only: they've heard the secret, and the date doesn't know they know. */
export const revealNote = (name: string, secret: string): string =>
  `Word got around tonight, and you've heard something about ${name}: "${secret}" They don't know you know. Bring it up when it feels right, in your own voice, or keep it to yourself; your call. Never say how you heard.`;

export type RevealChoice = { id: string; name: string };
type RevealRow = {
  week_id: string;
  season_id: string;
  choices: RevealChoice[];
  revealed_at: string | Date | null;
  winner: string | null;
  secret_idx: number | null;
  votes: number | null;
  total: number | null;
  producers_pick: boolean | null;
  partner_id: string | null;
  party_id: string | null;
  date_tries: number;
  notified_at: string | Date | null;
};

const rowOf = async (db: Db, weekId: string): Promise<RevealRow | null> =>
  (
    await db.query<RevealRow>(
      `select week_id, season_id, choices, revealed_at, winner, secret_idx, votes, total, producers_pick, partner_id, party_id, date_tries, notified_at
         from weekly_reveals where week_id = $1`,
      [weekId],
    )
  ).rows[0] ?? null;

async function tallyOf(db: Db, weekId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(`select pick, count(*)::int as n from weekly_reveal_votes where week_id = $1 group by pick`, [weekId]);
  return new Map(rows.map((r) => [r.pick, r.n]));
}

/**
 * A cast member's next secret still hidden this season (stored rows only, so the reveal is recorded against one): its
 * index and words, or null when every stored one is out (slipped on a date, dealt by the schedule, or voted out).
 */
async function nextHiddenSecret(db: Db, characterId: string, seasonId: string, now: Date): Promise<{ idx: number; secret: string } | null> {
  const [stored, status] = await Promise.all([
    db.query<{ idx: number; secret: string }>(
      `select idx, secret from cast_secrets where character_id = $1 and season_id = $2 and revealed_episode is null and voted_at is null order by idx`,
      [characterId, seasonId],
    ),
    castSecrets(db, characterId, now),
  ]);
  if (!status) return null;
  const out = new Set(status.out.map((o) => o.secret));
  return stored.rows.find((s) => !out.has(s.secret)) ?? null;
}

/**
 * The ballot, as the vote opens: the season's house cast who still keep a stored secret, the most public dates aired in
 * the last week first, then this season, then dealt from the week (so every pass agrees). Up to REVEAL_CHOICES.
 */
export async function revealBallot(db: Db, weekId: string, now: Date): Promise<RevealChoice[]> {
  const cast = seasonCastIds(now);
  if (cast.length < 2) return [];
  const { start } = seasonWindow(now);
  const { rows } = await db.query<{ id: string; name: string; week: number; season: number }>(
    `select c.id, c.name,
            count(e.id) filter (where e.revealed_at > $3)::int as week,
            count(e.id)::int as season
       from characters c
       left join episodes e on c.id in (e.character_a, e.character_b) and e.visibility = 'public' and e.status = 'ready'
                           and e.revealed_at >= $2 and e.revealed_at <= $4
      where c.id = any($1) and c.is_house and c.premium_sku is null and c.visibility = 'public'
      group by c.id, c.name`,
    [cast, start.toISOString(), new Date(now.getTime() - 7 * DAY_MS).toISOString(), now.toISOString()],
  );
  const seasonId = seasonIdOf(now);
  const ranked = rows.sort((x, y) => y.week - x.week || y.season - x.season || seedFrom(weekId, x.id) - seedFrom(weekId, y.id) || (x.id < y.id ? -1 : 1));
  const out: RevealChoice[] = [];
  for (const c of ranked) {
    if (out.length >= REVEAL_CHOICES) break;
    if (await nextHiddenSecret(db, c.id, seasonId, now)) out.push({ id: c.id, name: c.name });
  }
  return out;
}

/**
 * Opens this week's vote once its window has started (the hourly lobby job): the row with its frozen ballot, inserted
 * once. A ballot of fewer than two leaves the week without a vote (nothing is stored, so a later pass may still open it
 * if a secret becomes available). Returns the week's row, or null.
 */
export async function ensureRevealVote(db: Db, now: Date = new Date()): Promise<RevealRow | null> {
  const weekId = revealDayOf(now);
  const { opens_at, closes_at } = revealTimes(weekId);
  const have = await rowOf(db, weekId);
  if (have || now < opens_at || now >= closes_at) return have;
  const choices = await revealBallot(db, weekId, now);
  if (choices.length < 2) return null;
  await db.query(`insert into weekly_reveals (week_id, season_id, choices) values ($1, $2, $3::jsonb) on conflict do nothing`, [
    weekId,
    seasonIdOf(now),
    JSON.stringify(choices),
  ]);
  return rowOf(db, weekId);
}

export type RevealVoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote on this week's reveal (a second vote changes it), while its window is open. */
export async function voteReveal(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<RevealVoteResult> {
  const weekId = revealDayOf(now);
  const { opens_at, closes_at } = revealTimes(weekId);
  const row = await rowOf(db, weekId);
  if (!row || now < opens_at || now >= closes_at || row.revealed_at) {
    return { ok: false, status: 404, error: "no_vote_open", message: "There's no reveal vote open right now: the next one opens Saturday." };
  }
  if (!row.choices.some((c) => c.id === pick)) return { ok: false, status: 400, error: "not_on_the_ballot", message: "They aren't on this week's ballot." };
  await db.query(
    `insert into weekly_reveal_votes (week_id, user_id, pick) values ($1, $2, $3)
     on conflict (week_id, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [weekId, userId, pick],
  );
  return { ok: true, pick };
}

/** Who the winner's date is with: the house cast member they've dated most this season, else one dealt from the week. */
async function partnerFor(db: Db, winner: string, weekId: string, now: Date): Promise<string | null> {
  const cast = seasonCastIds(now).filter((id) => id !== winner);
  if (!cast.length) return null;
  const { start } = seasonWindow(now);
  const { rows } = await db.query<{ other: string }>(
    `select x.other from (
       select case when e.character_a = $1 then e.character_b else e.character_a end as other, e.revealed_at
         from episodes e
        where $1 in (e.character_a, e.character_b) and e.visibility = 'public' and e.status = 'ready' and e.revealed_at >= $3
     ) x
     join characters c on c.id = x.other and c.is_house and c.premium_sku is null and c.visibility = 'public'
     where x.other = any($2)
     group by x.other order by count(*) desc, max(x.revealed_at) desc, x.other limit 1`,
    [winner, cast, start.toISOString()],
  );
  if (rows[0]) return rows[0].other;
  const open = (
    await db.query<{ id: string }>(`select id from characters where id = any($1) and is_house and premium_sku is null and visibility = 'public' order by id`, [cast])
  ).rows.map((r) => r.id);
  return open.length ? open[seedFrom("reveal-partner", weekId) % open.length] : null;
}

export type RevealRun =
  | { ran: true; week_id: string; winner: string; producers_pick: boolean; room_path: string | null }
  | { ran: false; week_id: string; reason: "not_due" | "no_vote" | "already" | "nothing_hidden" };

/**
 * The hourly lobby job's part: opens Saturday's vote, and from Sunday's close (until that day ends) reveals the
 * winner's secret, makes their date (tried DATE_TRIES passes) and tells the voters, each once.
 */
export async function runDueReveal(db: Db, now: Date = new Date()): Promise<RevealRun> {
  await ensureRevealVote(db, now).catch(() => null);
  const weekId = revealDayOf(now);
  const { closes_at } = revealTimes(weekId);
  if (now.getUTCDay() !== 0 || now < closes_at) return { ran: false, week_id: weekId, reason: "not_due" };
  let row = await rowOf(db, weekId);
  if (!row) return { ran: false, week_id: weekId, reason: "no_vote" };

  if (!row.revealed_at) {
    const tally = await tallyOf(db, weekId);
    const total = [...tally.values()].reduce((s, n) => s + n, 0);
    // Most votes; ties to the earlier choice. Nobody voted: the producers take the top of the ballot. A pick whose
    // secrets all came out since the ballot froze (one slipped on a date) passes to the next, by votes then ballot order.
    const voted = winnerOf(row.choices, tally);
    const order = [...(voted ? [voted] : []), ...[...row.choices].sort((x, y) => (tally.get(y.id) ?? 0) - (tally.get(x.id) ?? 0))].filter(
      (c, i, all) => all.findIndex((d) => d.id === c.id) === i,
    );
    let pick: { choice: RevealChoice; idx: number } | null = null;
    for (const c of order) {
      const s = await nextHiddenSecret(db, c.id, row.season_id, now);
      if (s) {
        pick = { choice: c, idx: s.idx };
        break;
      }
    }
    if (!pick) {
      await db.query(`update weekly_reveals set revealed_at = $2, total = $3 where week_id = $1 and revealed_at is null`, [weekId, now.toISOString(), total]);
      return { ran: false, week_id: weekId, reason: "nothing_hidden" };
    }
    const claimed = await db.query(
      `update weekly_reveals set revealed_at = $2, winner = $3, secret_idx = $4, votes = $5, total = $6, producers_pick = $7
        where week_id = $1 and revealed_at is null returning week_id`,
      [weekId, now.toISOString(), pick.choice.id, pick.idx, tally.get(pick.choice.id) ?? 0, total, total === 0],
    );
    if (!claimed.rows.length) return { ran: false, week_id: weekId, reason: "already" };
    await db.query(
      `update cast_secrets set voted_week = $4, voted_at = $5 where character_id = $1 and season_id = $2 and idx = $3 and voted_at is null`,
      [pick.choice.id, row.season_id, pick.idx, weekId, now.toISOString()],
    );
    row = (await rowOf(db, weekId))!;
  }
  if (!row.winner) return { ran: false, week_id: weekId, reason: "already" };
  const winner = row.winner;

  // The date: claimed one try at a time, so two passes never both make it; a failed try leaves it for the next pass.
  if (!row.party_id && row.date_tries < DATE_TRIES) {
    const tried = await db.query(`update weekly_reveals set date_tries = date_tries + 1 where week_id = $1 and party_id is null and date_tries = $2 returning week_id`, [
      weekId,
      row.date_tries,
    ]);
    if (tried.rows.length) {
      const partner = row.partner_id ?? (await partnerFor(db, winner, weekId, now));
      const secret = await secretAt(db, winner, row.season_id, row.secret_idx);
      const name = row.choices.find((c) => c.id === winner)?.name ?? "";
      if (partner && secret) {
        await db.query(`update weekly_reveals set partner_id = $2 where week_id = $1`, [weekId, partner]);
        // The partner goes in first (side A), so the note rides only their side, as a dare does.
        const room = await createTemplateParty(db, partner, winner, { dare: revealNote(shortName(name), secret) }).catch(() => null);
        if (room?.ok) {
          const episodeId = (await db.query<{ episode_id: string }>(`select episode_id from watch_parties where id = $1`, [room.id])).rows[0]?.episode_id ?? null;
          await db.query(`update weekly_reveals set party_id = $2, episode_id = $3 where week_id = $1`, [weekId, room.id, episodeId]);
        }
      }
      row = (await rowOf(db, weekId))!;
    }
  }

  // Tell the voters once: when the date is on, or once its tries ran out.
  if (!row.notified_at && (row.party_id || row.date_tries >= DATE_TRIES)) {
    const claimed = await db.query(`update weekly_reveals set notified_at = now() where week_id = $1 and notified_at is null returning week_id`, [weekId]);
    if (claimed.rows.length) await tellVoters(db, row).catch(() => {});
  }
  return { ran: true, week_id: weekId, winner, producers_pick: row.producers_pick === true, room_path: row.party_id ? `/watch/${row.party_id}` : null };
}

async function secretAt(db: Db, characterId: string, seasonId: string, idx: number | null): Promise<string | null> {
  if (idx === null) return null;
  return (await db.query<{ secret: string }>(`select secret from cast_secrets where character_id = $1 and season_id = $2 and idx = $3`, [characterId, seasonId, idx])).rows[0]?.secret ?? null;
}

async function tellVoters(db: Db, row: RevealRow): Promise<void> {
  const voters = (await db.query<{ user_id: string; pick: string }>(`select user_id, pick from weekly_reveal_votes where week_id = $1`, [row.week_id])).rows;
  if (!voters.length || !row.winner) return;
  const name = row.choices.find((c) => c.id === row.winner)?.name ?? "";
  const secret = await secretAt(db, row.winner, row.season_id, row.secret_idx);
  const partner = row.partner_id ? (await db.query<{ name: string }>(`select name from characters where id = $1`, [row.partner_id])).rows[0]?.name : null;
  const link = row.party_id ? `/watch/${row.party_id}` : `/characters/${row.winner}#secrets`;
  const body = `${secret ? `“${secret}” ` : ""}${row.votes ?? 0} of ${row.total ?? 0} votes.${row.party_id && partner ? ` ${shortName(partner)} has heard it: watch their date.` : ""}`;
  const won = voters.filter((v) => v.pick === row.winner).map((v) => v.user_id);
  const others = voters.filter((v) => v.pick !== row.winner).map((v) => v.user_id);
  await notifyAll(db, won, { kind: "secret_revealed", title: `🔓 Your pick won: ${shortName(name)}'s secret is out`, body, link });
  await notifyAll(db, others, { kind: "secret_revealed", title: `🔓 The audience voted out ${shortName(name)}'s secret`, body, link });
}

export type RevealCard = { id: string; name: string; hue: number | null; portrait: string | null; out: number; total: number; votes: number };
export type RevealResult = {
  week_id: string;
  character_id: string;
  name: string;
  secret: string;
  votes: number;
  total: number;
  producers_pick: boolean;
  partner: string | null;
  room_path: string | null;
  at: string;
};

/** Everything Sunday's reveal card shows for one viewer. */
export type RevealBoard = {
  week_id: string;
  /**
   * soon: the countdown to Saturday's vote; open: the ballot; closed: the vote is in, the reveal minutes away; off: no
   * vote this week (too few secrets left to ask about), or this week's is already out: the card shows the result only.
   */
  state: "soon" | "open" | "closed" | "off";
  opens_at: string;
  closes_at: string;
  airs_at: string;
  choices: RevealCard[];
  my_pick: string | null;
  total: number;
  /** The newest reveal, while it's fresh (this Sunday's once it's out, else last week's for LAST_SHOWN_DAYS). */
  last: RevealResult | null;
};

/** The card's data for one viewer, or null when there's nothing to show: no cast, no vote and no fresh reveal. */
export async function revealBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<RevealBoard | null> {
  const weekId = revealDayOf(now);
  const times = revealTimes(weekId);
  const [row, lastRow] = await Promise.all([
    rowOf(db, weekId),
    db.query<RevealRow & { name: string; secret: string | null; partner_name: string | null }>(
      `select r.week_id, r.season_id, r.choices, r.revealed_at, r.winner, r.secret_idx, r.votes, r.total, r.producers_pick, r.partner_id, r.party_id,
              r.date_tries, r.notified_at, c.name, s.secret, p.name as partner_name
         from weekly_reveals r
         join characters c on c.id = r.winner
         left join cast_secrets s on s.character_id = r.winner and s.season_id = r.season_id and s.idx = r.secret_idx
         left join characters p on p.id = r.partner_id
        where r.revealed_at is not null and r.revealed_at <= $1 and r.revealed_at > $2
        order by r.week_id desc limit 1`,
      [now.toISOString(), new Date(now.getTime() - (7 + LAST_SHOWN_DAYS) * DAY_MS).toISOString()],
    ),
  ]);
  const lr = lastRow.rows[0];
  const last: RevealResult | null =
    lr && lr.secret
      ? {
          week_id: lr.week_id,
          character_id: lr.winner!,
          name: lr.name,
          secret: lr.secret,
          votes: lr.votes ?? 0,
          total: lr.total ?? 0,
          producers_pick: lr.producers_pick === true,
          partner: lr.partner_name,
          room_path: lr.party_id ? `/watch/${lr.party_id}` : null,
          at: new Date(lr.revealed_at!).toISOString(),
        }
      : null;
  // Last week's result fades once this week's countdown is under way.
  const fresh = last && (last.week_id === weekId || now.getTime() - Date.parse(last.at) < LAST_SHOWN_DAYS * DAY_MS) ? last : null;
  const base = { week_id: weekId, opens_at: times.opens_at.toISOString(), closes_at: times.closes_at.toISOString(), airs_at: times.airs_at.toISOString(), last: fresh };
  const open = row && !row.revealed_at && now >= times.opens_at;
  if (!open || !row) {
    // Before the window (and its first hour, while the job opens it), the countdown; after it with no vote, the result only.
    const soon = !row && now.getTime() < times.opens_at.getTime() + OPENING_GRACE_MS && seasonCastIds(now).length >= 2;
    if (!soon && !fresh) return null;
    return { ...base, state: soon ? "soon" : "off", choices: [], my_pick: null, total: 0 };
  }
  const ids = row.choices.map((c) => c.id);
  const [tally, mine, faces, statuses] = await Promise.all([
    tallyOf(db, weekId),
    viewerId
      ? db.query<{ pick: string }>(`select pick from weekly_reveal_votes where week_id = $1 and user_id = $2`, [weekId, viewerId])
      : Promise.resolve({ rows: [] as { pick: string }[] }),
    db.query<{ id: string; name: string; hue: number | null; portrait: string | null }>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1)`,
      [ids],
    ),
    Promise.all(ids.map((id) => castSecrets(db, id, now).catch(() => null))),
  ]);
  const byId = new Map(faces.rows.map((f) => [f.id, f]));
  return {
    ...base,
    state: now >= times.closes_at ? "closed" : "open",
    choices: row.choices.map((c, i) => {
      const f = byId.get(c.id);
      return {
        id: c.id,
        name: f?.name ?? c.name,
        hue: f?.hue ?? null,
        portrait: f?.portrait ?? null,
        out: statuses[i]?.out.length ?? 0,
        total: statuses[i]?.total ?? SECRETS_PER_CAST,
        votes: tally.get(c.id) ?? 0,
      };
    }),
    my_pick: mine.rows[0]?.pick ?? null,
    total: [...tally.values()].reduce((s, n) => s + n, 0),
  };
}
