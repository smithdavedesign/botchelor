/**
 * Tournaments (Agent World phase 3, owner's call 2026-11-27: "Do 2 go wild"): an audience-voted bracket of characters.
 * Four, eight or sixteen characters are seeded into a single-elimination bracket; each round is open for `round_hours`,
 * and in every match viewers and agents vote for who they'd rather send on a date. The one with more votes goes through,
 * a tie to the better seed. The champion goes on the Hall of Fame.
 *
 * Nothing is settled by a job: the bracket is computed from the votes and the clock every time it is read, so it can't
 * drift from what people voted, and a round closes on time even if no job runs.
 *
 * Rules:
 *  - entries are public characters of live accounts (no private ones: a bracket shows faces and links);
 *  - one vote a voter a match, changeable while its round is open; never for your own character;
 *  - the counts show once you've voted or the round has closed, as the dare vote (lib/dares.ts);
 *  - PG only: After Dark characters live elsewhere and never enter.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";
import { publicDateSql } from "./date-number";
import { withPortraits } from "./portrait-sql";
import { listedCharacterSql } from "./public-cast";

export const TOURNAMENT_SIZES = [4, 8, 16] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
export const DEFAULT_ROUND_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;

export type TournamentChar = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null; seed: number };
export type MatchState = "waiting" | "open" | "closed";
export type TournamentMatch = {
  round: number;
  match: number;
  a: TournamentChar | null;
  b: TournamentChar | null;
  state: MatchState;
  /** Shown once the viewer voted in this match or it closed; null otherwise. */
  votes: { a: number; b: number } | null;
  winner: TournamentChar | null;
  my_pick: string | null;
};
export type TournamentRound = { round: number; name: string; opens_at: string; closes_at: string; state: MatchState; matches: TournamentMatch[] };
export type TournamentStatus = "upcoming" | "running" | "finished";
export type TournamentView = {
  id: string;
  title: string;
  blurb: string;
  size: TournamentSize;
  starts_at: string;
  ends_at: string;
  status: TournamentStatus;
  rounds: TournamentRound[];
  champion: TournamentChar | null;
  path: string;
};

type TournamentRow = { id: string; title: string; blurb: string; size: number; starts_at: Date | string; round_hours: number; cancelled_at: Date | string | null };

export const tournamentPath = (id: string) => `/tournaments/${id}`;
const roundCount = (size: number) => Math.log2(size);

/** Standard bracket order: seed 1 meets the last seed, and the top two can only meet in the final. [1,8,4,5,2,7,3,6] for 8. */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

/** What television calls a round, counted from the end. */
export function roundName(round: number, rounds: number): string {
  const left = rounds - round;
  if (left === 0) return "The final";
  if (left === 1) return "Semi-finals";
  if (left === 2) return "Quarter-finals";
  return `Round ${round}`;
}

const iso = (v: Date | string) => new Date(v).toISOString();

async function rowOf(db: Db, id: string): Promise<TournamentRow | null> {
  return (await db.query<TournamentRow>(`select id, title, blurb, size, starts_at, round_hours, cancelled_at from tournaments where id = $1`, [id])).rows[0] ?? null;
}

/** The bracket as it stands at `now`, for `viewerId` (their picks, and the counts where they've voted). */
export async function tournamentView(db: Db, id: string, viewerId: string | null, now: Date = new Date()): Promise<TournamentView | null> {
  const t = await rowOf(db, id);
  if (!t || t.cancelled_at) return null;
  const [entries, tally, mine] = await Promise.all([
    db.query<{ id: string; name: string; is_house: boolean; hue: number | null; seed: number }>(
      `select c.id, c.name, c.is_house, c.avatar_hue as hue, e.seed from tournament_entries e join characters c on c.id = e.character_id where e.tournament_id = $1 order by e.seed`,
      [id],
    ),
    db.query<{ round: number; match: number; pick: string; n: number }>(
      `select round, match, pick, count(*)::int as n from tournament_votes where tournament_id = $1 group by round, match, pick`,
      [id],
    ),
    viewerId
      ? db.query<{ round: number; match: number; pick: string }>(`select round, match, pick from tournament_votes where tournament_id = $1 and voter_id = $2`, [id, viewerId])
      : Promise.resolve({ rows: [] as { round: number; match: number; pick: string }[] }),
  ]);
  const faced = await withPortraits(db, entries.rows);
  const bySeed = new Map<number, TournamentChar>(faced.map((r) => [r.seed, { id: r.id, name: r.name, house: r.is_house, hue: r.hue, portrait: r.portrait, seed: r.seed }]));
  const count = new Map(tally.rows.map((r) => [`${r.round}:${r.match}:${r.pick}`, r.n]));
  const myPick = new Map(mine.rows.map((r) => [`${r.round}:${r.match}`, r.pick]));

  const size = t.size as TournamentSize;
  const rounds = roundCount(size);
  const start = new Date(t.starts_at).getTime();
  const span = t.round_hours * HOUR_MS;
  const order = bracketOrder(size);
  let field: (TournamentChar | null)[] = order.map((s) => bySeed.get(s) ?? null);
  const out: TournamentRound[] = [];
  for (let r = 1; r <= rounds; r++) {
    const opens = start + (r - 1) * span;
    const closes = opens + span;
    const state: MatchState = now.getTime() < opens ? "waiting" : now.getTime() < closes ? "open" : "closed";
    const matches: TournamentMatch[] = [];
    const next: (TournamentChar | null)[] = [];
    for (let m = 0; m < field.length / 2; m++) {
      const a = field[2 * m] ?? null;
      const b = field[2 * m + 1] ?? null;
      const va = a ? (count.get(`${r}:${m + 1}:${a.id}`) ?? 0) : 0;
      const vb = b ? (count.get(`${r}:${m + 1}:${b.id}`) ?? 0) : 0;
      const pick = myPick.get(`${r}:${m + 1}`) ?? null;
      // A side with no one (an entry deleted since) gives the other a walkover.
      const winner = state !== "closed" ? null : a && b ? (va > vb ? a : vb > va ? b : a.seed < b.seed ? a : b) : (a ?? b);
      const playing: MatchState = a && b ? state : state === "closed" ? "closed" : "waiting";
      matches.push({ round: r, match: m + 1, a, b, state: playing, votes: pick || state === "closed" ? { a: va, b: vb } : null, winner, my_pick: pick });
      next.push(winner);
    }
    out.push({ round: r, name: roundName(r, rounds), opens_at: new Date(opens).toISOString(), closes_at: new Date(closes).toISOString(), state, matches });
    field = next;
  }
  const ends = start + rounds * span;
  const status: TournamentStatus = now.getTime() < start ? "upcoming" : now.getTime() < ends ? "running" : "finished";
  return {
    id: t.id,
    title: t.title,
    blurb: t.blurb,
    size,
    starts_at: iso(t.starts_at),
    ends_at: new Date(ends).toISOString(),
    status,
    rounds: out,
    champion: status === "finished" ? (out[out.length - 1]?.matches[0]?.winner ?? null) : null,
    path: tournamentPath(t.id),
  };
}

export type TournamentSummary = { id: string; title: string; size: number; starts_at: string; ends_at: string; status: TournamentStatus; path: string };

/** Every tournament not called off, the newest first. */
export async function listTournaments(db: Db, now: Date = new Date(), limit = 20): Promise<TournamentSummary[]> {
  const { rows } = await db.query<TournamentRow>(
    `select id, title, blurb, size, starts_at, round_hours, cancelled_at from tournaments where cancelled_at is null order by starts_at desc, id limit $1`,
    [limit],
  );
  return rows.map((t) => {
    const start = new Date(t.starts_at).getTime();
    const ends = start + roundCount(t.size) * t.round_hours * HOUR_MS;
    return {
      id: t.id,
      title: t.title,
      size: t.size,
      starts_at: iso(t.starts_at),
      ends_at: new Date(ends).toISOString(),
      status: now.getTime() < start ? "upcoming" : now.getTime() < ends ? "running" : "finished",
      path: tournamentPath(t.id),
    };
  });
}

/** The one to show first: a running one, else the next to start, else the last to finish. */
export async function currentTournament(db: Db, now: Date = new Date()): Promise<TournamentSummary | null> {
  const all = await listTournaments(db, now, 50);
  return (
    all.find((t) => t.status === "running") ??
    [...all].reverse().find((t) => t.status === "upcoming") ??
    all.find((t) => t.status === "finished") ??
    null
  );
}

/** Every champion so far, for the Hall of Fame: the newest first. */
export async function tournamentChampions(db: Db, now: Date = new Date()): Promise<{ tournament: TournamentSummary; champion: TournamentChar }[]> {
  const done = (await listTournaments(db, now, 50)).filter((t) => t.status === "finished");
  const views = await Promise.all(done.map((t) => tournamentView(db, t.id, null, now)));
  return done.flatMap((t, i) => (views[i]?.champion ? [{ tournament: t, champion: views[i]!.champion! }] : []));
}

/* ---- voting ---- */

export type TournamentVoteResult =
  | { ok: true; round: number; match: number; pick: string; votes: { a: number; b: number } }
  | { ok: false; status: number; error: string; message: string };

/** A vote (or a changed one) in an open match: `pick` is one of its two characters, never the voter's own. */
export async function voteTournament(db: Db, voterId: string, tournamentId: string, match: number, pick: string, now: Date = new Date()): Promise<TournamentVoteResult> {
  const view = await tournamentView(db, tournamentId, voterId, now);
  if (!view) return { ok: false, status: 404, error: "not_found", message: "No such tournament." };
  const round = view.rounds.find((r) => r.state === "open");
  if (!round) {
    return view.status === "upcoming"
      ? { ok: false, status: 409, error: "not_open_yet", message: `Voting opens ${view.starts_at}.` }
      : { ok: false, status: 409, error: "voting_closed", message: "This tournament is over." };
  }
  const m = round.matches.find((x) => x.match === match);
  if (!m || m.state !== "open" || !m.a || !m.b) return { ok: false, status: 400, error: "no_such_match", message: `No open match ${match} in the ${round.name.toLowerCase()}.` };
  if (pick !== m.a.id && pick !== m.b.id) return { ok: false, status: 400, error: "not_in_match", message: `Pick ${m.a.name} (${m.a.id}) or ${m.b.name} (${m.b.id}).` };
  const own = await db.query(`select 1 from characters where id = any($1) and owner_id = $2`, [[m.a.id, m.b.id], voterId]);
  if (own.rows.length) return { ok: false, status: 403, error: "own_character", message: "You can't vote in a match your own character is in." };
  await db.query(
    `insert into tournament_votes (tournament_id, round, match, voter_id, pick) values ($1, $2, $3, $4, $5)
     on conflict (tournament_id, round, match, voter_id) do update set pick = excluded.pick, updated_at = now()`,
    [tournamentId, round.round, match, voterId, pick],
  );
  const { rows } = await db.query<{ pick: string; n: number }>(
    `select pick, count(*)::int as n from tournament_votes where tournament_id = $1 and round = $2 and match = $3 group by pick`,
    [tournamentId, round.round, match],
  );
  const n = new Map(rows.map((r) => [r.pick, r.n]));
  return { ok: true, round: round.round, match, pick, votes: { a: n.get(m.a.id) ?? 0, b: n.get(m.b.id) ?? 0 } };
}

/* ---- making one (admin) ---- */

export const NewTournament = z.object({
  title: z.string().trim().min(3).max(80),
  blurb: z.string().trim().max(280).default(""),
  size: z.union([z.literal(4), z.literal(8), z.literal(16)]).default(8),
  starts_at: z.string().datetime(),
  round_hours: z.number().int().min(6).max(168).default(DEFAULT_ROUND_HOURS),
  /** In seed order. Left out, the show seeds the characters with the most public dates aired. */
  character_ids: z.array(z.string().min(1).max(80)).optional(),
});
export type NewTournamentInput = z.input<typeof NewTournament>;

/** The characters who'd make the bracket on their record: the most dates aired publicly, then the most second dates. */
export async function autoSeeds(db: Db, size: number): Promise<string[]> {
  const pub = publicDateSql("e");
  const { rows } = await db.query<{ id: string }>(
    `select c.id from characters c
       left join lateral (
         select count(*)::int as dates, count(*) filter (where e.ending = 'second_date')::int as seconds
           from episodes e where (e.character_a = c.id or e.character_b = c.id) and ${pub}
       ) d on true
      where c.visibility = 'public' and ${listedCharacterSql("c")} and c.premium_sku is null
      order by coalesce(d.dates, 0) desc, coalesce(d.seconds, 0) desc, c.created_at, c.id
      limit $1`,
    [size],
  );
  return rows.map((r) => r.id);
}

export async function createTournament(db: Db, input: NewTournamentInput, by: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const parsed = NewTournament.safeParse(input);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "tournament"}: ${i.message}`).join("; ") };
  const t = parsed.data;
  const ids = t.character_ids ?? (await autoSeeds(db, t.size));
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "A character can only be in the bracket once." };
  if (ids.length !== t.size) return { ok: false, reason: `A ${t.size}-character bracket needs ${t.size} characters; there are ${ids.length}.` };
  const ok = await db.query<{ id: string }>(`select c.id from characters c where c.id = any($1) and c.visibility = 'public' and ${listedCharacterSql("c")}`, [ids]);
  const allowed = new Set(ok.rows.map((r) => r.id));
  const refused = ids.filter((i) => !allowed.has(i));
  if (refused.length) return { ok: false, reason: `Not public characters on the show: ${refused.join(", ")}.` };
  const id = `tn_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await db.query(`insert into tournaments (id, title, blurb, size, starts_at, round_hours, created_by) values ($1, $2, $3, $4, $5, $6, $7)`, [
    id,
    t.title,
    t.blurb,
    t.size,
    t.starts_at,
    t.round_hours,
    by,
  ]);
  for (const [i, cid] of ids.entries()) {
    await db.query(`insert into tournament_entries (tournament_id, character_id, seed) values ($1, $2, $3)`, [id, cid, i + 1]);
  }
  return { ok: true, id };
}

export async function cancelTournament(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query(`update tournaments set cancelled_at = now() where id = $1 and cancelled_at is null returning id`, [id]);
  return rows.length > 0;
}

/** For the MCP: the bracket with ids and names, no portrait paths, and how to vote. */
export function tournamentForAgents(v: TournamentView) {
  const who = (c: TournamentChar | null) => (c ? { id: c.id, name: c.name, seed: c.seed } : null);
  const open = v.rounds.find((r) => r.state === "open");
  return {
    id: v.id,
    title: v.title,
    blurb: v.blurb,
    status: v.status,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    champion: who(v.champion),
    rounds: v.rounds.map((r) => ({
      round: r.round,
      name: r.name,
      state: r.state,
      opens_at: r.opens_at,
      closes_at: r.closes_at,
      matches: r.matches.map((m) => ({ match: m.match, a: who(m.a), b: who(m.b), state: m.state, votes: m.votes, winner: who(m.winner), your_pick: m.my_pick })),
    })),
    how_to_vote: open
      ? `The ${open.name.toLowerCase()} is open until ${open.closes_at}: vote_tournament with match and pick (a character_id from that match). One vote a match, changeable until it closes; not in a match your own character is in. A tie goes to the better seed.`
      : v.status === "upcoming"
        ? `Voting opens ${v.starts_at}.`
        : "This tournament is over.",
    page: `https://botchelor.com${v.path}`,
  };
}
