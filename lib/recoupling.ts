/**
 * The recoupling night (docs/ideas.md "Bringing viewers back", idea 9; David 2026-11-02): on nights the season's format
 * schedules (lib/season-format.ts: the last night of a classic season, the end of every week on the island), the
 * season's couples and singles share one room and pairs can re-form. It is the mixer machinery end to end — a group
 * night (theme 'recoupling') whose rotations book speed dates through the normal route, the whole room on /mixers/[id]
 * — so its dates air, feed the relationship graph, and count into the season recap (lib/season-recap.ts reads the
 * window's public dates) and the Reunion like any others.
 *
 *  - The vote: viewers vote beforehand on ONE question — "which couple is in trouble?" (the season's top couples), or
 *    on the island's final night "who joins next season?" (the generated newcomer candidates, lib/season-gen.ts). The
 *    ballot freezes when the vote opens (VOTE_OPEN_DAYS before the night), one vote a viewer, changeable until the
 *    night runs. $0: the ballot is rows the show already has.
 *  - The winner is a producer nudge, not a steering wheel: one member of the voted couple carries a one-sided note on
 *    the night (the same per-side channel a dare uses, lib/simulation.ts req.note); the engine still decides every
 *    ending. A voted newcomer is approved onto next season's cast if their portrait passed the check — the same bar
 *    takeNewcomers already applies (lib/season-gen.ts).
 *  - Who attends: the season's house cast, then the house-crowd bots who dated a cast member this season, up to
 *    MIXER_MAX. House-paid like the nightly fill (~1¢ a speed date), so a classic season costs ~6¢ a month and an
 *    island one ~25¢.
 *  - Off-cycle (the October season just closed): an admin can stage a night now from /admin/season; it runs the same
 *    code with today's ballot.
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { houseCrowdPaused, isHouseBotSql } from "./house-bots";
import { HOUSE_BOOKER } from "./house-booker";
import { MIXER_FILL_HOUR_UTC, MIXER_MAX, MIXER_MIN } from "./group-dates";
import { runSeatedNight } from "./group-dates-run";
import { shortName } from "./names";
import { notifyAll } from "./notifications";
import { isFinalNight, nextRecouplingDay, type SeasonFormatDef } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { seasonCastIds } from "./season-cast";
import { listCandidates, reviewCandidate } from "./season-gen";
import { nextSeasonStart, seasonIdOf, seasonWindow } from "./season-window";
import { winnerOf } from "./situations";
import type { PlaceId } from "./venues";

/** How many days before a night its vote opens. */
export const VOTE_OPEN_DAYS = 3;
/** Where a classic recoupling night happens (the island's comes from its venue pool): rooms a crowd suits. */
const NIGHT_VENUES: readonly PlaceId[] = ["rooftop_bar", "jazz_bar", "night_market", "dive_bar"];

export type RecouplingQuestion = "couple_in_trouble" | "newcomer";
export type RecouplingChoice = { id: string; label: string; a?: string; b?: string };

const dayId = (d: Date): string => d.toISOString().slice(0, 10);
/** When a night runs: the lobby job's pass at the fill hour (it runs at :20). */
export const nightRunsAt = (nightAt: string): Date => new Date(Date.parse(`${nightAt}T00:00:00Z`) + (MIXER_FILL_HOUR_UTC * 60 + 20) * 60 * 1000);

/** What each question asks the audience, word for word. */
export const questionAsk = (q: RecouplingQuestion): string =>
  q === "newcomer" ? "Who should join next season's cast?" : "Which couple is in trouble?";

/**
 * The ballot for a night, frozen the moment the vote opens. Couples: the season's top pairs so far (most dates aired
 * publicly in the window, second dates first). Newcomers: next season's not-rejected candidates (lib/season-gen.ts).
 */
export async function recouplingBallot(db: Db, question: RecouplingQuestion, now: Date): Promise<RecouplingChoice[]> {
  if (question === "newcomer") {
    const cands = await listCandidates(db, seasonIdOf(nextSeasonStart(now)));
    return cands.filter((c) => c.status !== "rejected").map((c) => ({ id: c.character_id, label: c.name }));
  }
  const { start, end } = seasonWindow(now);
  const { rows } = await db.query<{ lo: string; hi: string; a: string; b: string }>(
    `select p.lo, p.hi, ca.name as a, cb.name as b
       from (select least(e.character_a, e.character_b) as lo, greatest(e.character_a, e.character_b) as hi,
                    count(*)::int as dates, count(*) filter (where e.ending = 'second_date')::int as seconds
               from episodes e
              where e.status = 'ready' and e.visibility = 'public' and e.revealed_at >= $1 and e.revealed_at < $2
              group by 1, 2) p
       join characters ca on ca.id = p.lo join characters cb on cb.id = p.hi
      where ca.visibility = 'public' and cb.visibility = 'public'
      order by p.seconds desc, p.dates desc, p.lo, p.hi limit 3`,
    [start.toISOString(), end.toISOString()],
  );
  return rows.map((r) => ({ id: `${r.lo}|${r.hi}`, label: `${shortName(r.a)} × ${shortName(r.b)}`, a: r.lo, b: r.hi }));
}

type NightRow = {
  season_id: string;
  night_at: string;
  question: RecouplingQuestion;
  choices: RecouplingChoice[];
  staged: boolean;
  night_id: string | null;
  winner: string | null;
};

const nightRow = async (db: Db, nightAt: string): Promise<NightRow | null> =>
  (await db.query<NightRow>(`select season_id, night_at, question, choices, staged, night_id, winner from recoupling_nights where night_at = $1`, [nightAt]))
    .rows[0] ?? null;

/**
 * Opens the next night's vote once it's within VOTE_OPEN_DAYS (the hourly lobby job calls this): the row with its
 * frozen ballot, inserted once. Returns the night's row, or null when no night is close.
 */
export async function ensureRecouplingVote(db: Db, def: SeasonFormatDef, now: Date = new Date()): Promise<NightRow | null> {
  const nightAt = nextRecouplingDay(def, now);
  if (!nightAt) return null;
  if (Date.parse(`${nightAt}T00:00:00Z`) - now.getTime() > VOTE_OPEN_DAYS * 24 * 60 * 60 * 1000) return null;
  const have = await nightRow(db, nightAt);
  if (have) return have;
  const question: RecouplingQuestion = isFinalNight(def, nightAt, now) ? def.recoupling.finalVote : "couple_in_trouble";
  const choices = await recouplingBallot(db, question, now);
  await db.query(
    `insert into recoupling_nights (season_id, night_at, question, choices) values ($1, $2, $3, $4::jsonb) on conflict do nothing`,
    [seasonIdOf(now), nightAt, question, JSON.stringify(choices)],
  );
  return nightRow(db, nightAt);
}

export type RecouplingVoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote on the next recoupling night (a second vote changes it), until the night runs. */
export async function voteRecoupling(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<RecouplingVoteResult> {
  const def = await seasonFormatNow(db, now);
  const nightAt = nextRecouplingDay(def, now);
  const row = nightAt ? await nightRow(db, nightAt) : null;
  if (!row || row.night_id) return { ok: false, status: 404, error: "no_vote_open", message: "There's no recoupling vote open right now." };
  if (!row.choices.some((c) => c.id === pick)) return { ok: false, status: 400, error: "not_on_the_ballot", message: "That isn't on the ballot." };
  await db.query(
    `insert into recoupling_votes (night_at, user_id, pick) values ($1, $2, $3)
     on conflict (night_at, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [row.night_at, userId, pick],
  );
  return { ok: true, pick };
}

async function tallyOf(db: Db, nightAt: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(`select pick, count(*)::int as n from recoupling_votes where night_at = $1 group by pick`, [nightAt]);
  return new Map(rows.map((r) => [r.pick, r.n]));
}

export type RecouplingBoard = {
  night_at: string;
  /** When the night runs (ISO): the countdown on /watch. */
  runs_at: string;
  question: RecouplingQuestion;
  ask: string;
  choices: { id: string; label: string; votes: number }[];
  my_pick: string | null;
  total: number;
  /** The newest night that has run: the room to watch. */
  last: { night_at: string; room_path: string; winner_label: string | null } | null;
};

/** The recoupling card's data for one viewer: the open vote (when one is), and the last night that ran. */
export async function recouplingBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<RecouplingBoard | null> {
  const def = await seasonFormatNow(db, now);
  const nightAt = nextRecouplingDay(def, now);
  const row = nightAt ? await nightRow(db, nightAt) : null;
  const lastRow = (
    await db.query<{ night_at: string; night_id: string; question: RecouplingQuestion; choices: RecouplingChoice[]; winner: string | null }>(
      `select night_at, night_id, question, choices, winner from recoupling_nights where night_id is not null order by night_at desc limit 1`,
    )
  ).rows[0];
  const last = lastRow
    ? { night_at: lastRow.night_at, room_path: `/mixers/${lastRow.night_id}`, winner_label: lastRow.choices.find((c) => c.id === lastRow.winner)?.label ?? null }
    : null;
  // No open vote (none close, a night already run, or a ballot too thin to ask): the card shows the countdown and the
  // last night only. Nothing at all to show returns null.
  const open = row && !row.night_id && row.choices.length >= 2 ? row : null;
  if (!open) {
    const at = nightAt && (!row || !row.night_id) ? nightAt : null;
    if (!at && !last) return null;
    const q = row?.question ?? "couple_in_trouble";
    return { night_at: at ?? last!.night_at, runs_at: nightRunsAt(at ?? last!.night_at).toISOString(), question: q, ask: questionAsk(q), choices: [], my_pick: null, total: 0, last };
  }
  const [tally, mine] = await Promise.all([
    tallyOf(db, open.night_at),
    viewerId
      ? db.query<{ pick: string }>(`select pick from recoupling_votes where night_at = $1 and user_id = $2`, [open.night_at, viewerId])
      : Promise.resolve({ rows: [] as { pick: string }[] }),
  ]);
  return {
    night_at: open.night_at,
    runs_at: nightRunsAt(open.night_at).toISOString(),
    question: open.question,
    ask: questionAsk(open.question),
    choices: open.choices.map((c) => ({ id: c.id, label: c.label, votes: tally.get(c.id) ?? 0 })),
    my_pick: mine.rows[0]?.pick ?? null,
    total: [...tally.values()].reduce((s, n) => s + n, 0),
    last,
  };
}

export type RecouplingRun =
  | { ran: true; night_id: string; room_path: string; booked: number; failed: number; winner: string | null }
  | { ran: false; reason: "not_due" | "already" | "too_few" | "paused" };

/** The attendees: the season's cast (the house books them), then the crowd bots who dated a cast member this season. */
async function attendees(db: Db, now: Date): Promise<{ id: string; booker: string }[]> {
  const castIds = seasonCastIds(now);
  const cast = (
    await db.query<{ id: string }>(
      `select c.id from characters c where c.is_house and c.premium_sku is null and c.visibility = 'public' and c.id = any($1)`,
      [castIds],
    )
  ).rows.map((c) => ({ id: c.id, booker: HOUSE_BOOKER }));
  const { start, end } = seasonWindow(now);
  const partners = (
    await db.query<{ id: string; owner_id: string }>(
      `select c.id, c.owner_id from characters c
        where not c.is_house and c.owner_id is not null and c.owner_id <> 'deleted'
          and ${isHouseBotSql("c.owner_id")} and c.visibility = 'public' and c.id <> all($1::text[])
          and exists (select 1 from episodes e
                       where ((e.character_a = c.id and e.character_b = any($1::text[]))
                           or (e.character_b = c.id and e.character_a = any($1::text[])))
                         and e.status = 'ready' and e.visibility = 'public' and e.revealed_at >= $2 and e.revealed_at < $3)
        order by c.id limit $4`,
      [castIds, start.toISOString(), end.toISOString(), MIXER_MAX],
    )
  ).rows.map((c) => ({ id: c.id, booker: c.owner_id }));
  const ordered = [...cast, ...partners].slice(0, MIXER_MAX);
  return ordered;
}

/**
 * Runs a night: claims its row, computes the vote's winner, seats the room, and books every rotation (house-paid speed
 * dates through the normal route, lib/group-dates-run.ts runSeatedNight). The voted couple's seated member carries the
 * producer's one-sided note; a voted newcomer whose portrait passed the check is approved onto next season.
 */
export async function runRecouplingNight(db: Db, def: SeasonFormatDef, nightAt: string, now: Date = new Date(), staged = false): Promise<RecouplingRun> {
  if (houseCrowdPaused()) return { ran: false, reason: "paused" };
  // The row (and its frozen ballot): the vote may never have opened (a staged night, a job that was down all window).
  let row = await nightRow(db, nightAt);
  if (!row) {
    const question: RecouplingQuestion = isFinalNight(def, nightAt, now) ? def.recoupling.finalVote : "couple_in_trouble";
    const choices = await recouplingBallot(db, question, now);
    await db.query(`insert into recoupling_nights (season_id, night_at, question, choices, staged) values ($1, $2, $3, $4::jsonb, $5) on conflict do nothing`, [
      seasonIdOf(now),
      nightAt,
      question,
      JSON.stringify(choices),
      staged,
    ]);
    row = await nightRow(db, nightAt);
  }
  if (!row || row.night_id) return { ran: false, reason: "already" };

  const seats = await attendees(db, now);
  if (seats.length < MIXER_MIN) return { ran: false, reason: "too_few" };

  // Claim it (two job passes can't both run it), then everything after is the claimer's.
  const nightId = crypto.randomUUID();
  const claimed = await db.query(`update recoupling_nights set night_id = $3 where season_id = $1 and night_at = $2 and night_id is null returning night_at`, [
    row.season_id,
    nightAt,
    nightId,
  ]);
  if (!claimed.rows.length) return { ran: false, reason: "already" };

  const tally = await tallyOf(db, nightAt);
  const winner = winnerOf(row.choices, tally);
  if (winner) await db.query(`update recoupling_nights set winner = $3 where season_id = $1 and night_at = $2`, [row.season_id, nightAt, winner.id]);

  // The room, seated and marked filled (the nightly fill then leaves it alone), run on this same pass.
  const pool = def.venues ?? NIGHT_VENUES;
  await db.query(
    `insert into group_nights (id, kind, theme, venue, created_by, status, filled_at, couple_a, couple_b)
     values ($1, 'mixer', 'recoupling', $2, 'house', 'open', $3, '{}'::jsonb, '{}'::jsonb)`,
    [nightId, pool[seedFrom(nightId) % pool.length], now.toISOString()],
  );
  for (const [k, s] of seats.entries()) {
    await db.query(`insert into group_night_seats (night_id, character_id, booker, house_fill, joined_at) values ($1, $2, $3, true, $4) on conflict do nothing`, [
      nightId,
      s.id,
      s.booker,
      new Date(now.getTime() + k).toISOString(),
    ]);
  }

  // The winner couple's seated member carries the producer's note — one side only, like a dare.
  let noteFor: ((a: string, b: string) => string | null) | undefined;
  if (winner && row.question === "couple_in_trouble" && winner.a && winner.b) {
    const seated = seats.map((s) => s.id);
    const target = seated.includes(winner.a) ? winner.a : seated.includes(winner.b) ? winner.b : null;
    const partner = target === winner.a ? winner.b : winner.a;
    const partnerName = shortName((await db.query<{ name: string }>(`select name from characters where id = $1`, [partner])).rows[0]?.name ?? "your match");
    if (target) {
      const note = `The audience has voted: you and ${partnerName} are the couple in trouble tonight. Tonight settles it, one way or the other.`;
      noteFor = (a) => (a === target ? note : null);
    }
  }

  const { booked, failed } = await runSeatedNight(db, nightId, { noteFor });

  // A voted newcomer joins next season — through the same gate the rotation uses (an approved candidate), and only
  // when their portrait passed the check (the bar takeNewcomers already applies to unreviewed candidates).
  if (winner && row.question === "newcomer") {
    const cand = (await listCandidates(db, seasonIdOf(nextSeasonStart(now)))).find((c) => c.character_id === winner.id);
    if (cand && cand.status === "pending" && cand.portrait_asset && cand.check_note === "passed") {
      await reviewCandidate(db, winner.id, "approved").catch(() => false);
    }
  }

  // Tell the voters how their night went (the room link); the kind has its own inbox row like the mixer's.
  const voters = (await db.query<{ user_id: string }>(`select user_id from recoupling_votes where night_at = $1`, [nightAt])).rows.map((v) => v.user_id);
  if (booked && voters.length) {
    const label = winner ? row.choices.find((c) => c.id === winner.id)?.label : null;
    await notifyAll(db, voters, {
      kind: "recoupling",
      title: "💘 The Recoupling has played",
      body: label
        ? row.question === "newcomer"
          ? `The audience sent ${label} to next season's cast. Watch how the night went.`
          : `The audience named ${label} the couple in trouble — watch what the night did to them.`
        : "Watch who left with whom.",
      link: `/mixers/${nightId}`,
    }).catch(() => {});
  }
  return { ran: true, night_id: nightId, room_path: `/mixers/${nightId}`, booked, failed, winner: winner?.id ?? null };
}

/**
 * The hourly lobby job's part: open the next night's vote once it's close, and run tonight's night at the fill hour.
 * Null when nothing was due.
 */
export async function runDueRecoupling(db: Db, now: Date = new Date()): Promise<RecouplingRun | null> {
  const def = await seasonFormatNow(db, now);
  await ensureRecouplingVote(db, def, now).catch(() => null);
  const nightAt = nextRecouplingDay(def, now);
  if (!nightAt || nightAt !== dayId(now) || now.getUTCHours() < MIXER_FILL_HOUR_UTC) return null;
  return runRecouplingNight(db, def, nightAt, now);
}

/** An admin stages a night now (off-cycle, /admin/season): today's ballot, the same run. */
export async function stageRecouplingNight(db: Db, now: Date = new Date()): Promise<RecouplingRun> {
  const def = await seasonFormatNow(db, now);
  return runRecouplingNight(db, def, dayId(now), now, true);
}
