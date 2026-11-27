/**
 * The fantasy league (David, 2026-11-27: "Do 1-6"): a viewer drafts three of a Botchelor season's suitors before the
 * first rose ceremony's vote opens, and scores as their picks get through the Sundays. A reason to check in all month
 * that costs nothing to run: rows, no model call. FANTASY=0 turns it off.
 *
 * Points (FANTASY_POINTS), all from the held ceremonies (lib/ceremony.ts), so a score never moves on anything but an
 * aired result: a rose kept at a weekly ceremony, the final two, the final rose. Only aggregates are public (how many
 * drafted each suitor, under the empty-room rule, and the number of players); a viewer sees their own score and rank.
 */
import { ceremonyVoteOpensAt } from "./ceremony";
import type { Db } from "./db";
import { portraitPathSql } from "./portrait-sql";
import { ceremonySundays } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { seasonIdOf } from "./season-window";

type Env = Record<string, string | undefined>;
export const fantasyOn = (env: Env = process.env): boolean => env.FANTASY?.trim() !== "0";

export const FANTASY_PICKS = 3;
export const FANTASY_POINTS = { rose: 1, final_two: 3, final_rose: 5 } as const;

/** A held ceremony as scoring reads it. */
export type ScoredCeremony = { finale: boolean; remaining: readonly string[]; final_rose: string | null; finalists: readonly string[] };

/** One suitor's points so far (pure): a rose a weekly ceremony they stayed through, then the finale's. */
export function suitorPoints(id: string, ceremonies: readonly ScoredCeremony[]): number {
  let n = 0;
  for (const c of ceremonies) {
    if (!c.finale) n += c.remaining.includes(id) ? FANTASY_POINTS.rose : 0;
    else if (c.final_rose === id) n += FANTASY_POINTS.final_rose;
    else if (c.finalists.includes(id)) n += FANTASY_POINTS.final_two;
  }
  return n;
}

export const draftPoints = (picks: readonly string[], ceremonies: readonly ScoredCeremony[]): number => picks.reduce((s, p) => s + suitorPoints(p, ceremonies), 0);

type Ctx = { seasonId: string; locksAt: Date };

async function context(db: Db, now: Date): Promise<Ctx | null> {
  if (!fantasyOn()) return null;
  const def = await seasonFormatNow(db, now);
  if (!def.lead) return null;
  const first = ceremonySundays(def, now)[0];
  if (!first) return null;
  return { seasonId: seasonIdOf(now), locksAt: ceremonyVoteOpensAt(first) };
}

async function castSuitors(db: Db, seasonId: string): Promise<{ id: string; name: string; hue: number | null; portrait: string | null; house: boolean; out: boolean }[]> {
  const { rows } = await db.query<{ id: string; name: string; hue: number | null; portrait: string | null; house: boolean; out: boolean }>(
    `select s.character_id as id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house, s.withdrawn_at is not null as out
       from season_casts s join characters c on c.id = s.character_id
      where s.season_id = $1 and s.source = 'suitor' and c.visibility = 'public' and c.owner_id is distinct from 'deleted'
      order by s.slot`,
    [seasonId],
  );
  return rows;
}

async function scored(db: Db, seasonId: string): Promise<ScoredCeremony[]> {
  const { rows } = await db.query<{ finale: boolean; remaining: string[] | null; final_rose: string | null; choices: { id: string }[] }>(
    `select finale, remaining, final_rose, choices from ceremonies where season_id = $1 and held_at is not null order by held_on`,
    [seasonId],
  );
  return rows.map((r) => ({ finale: r.finale, remaining: r.remaining ?? [], final_rose: r.final_rose, finalists: r.finale ? (r.choices ?? []).map((c) => c.id) : [] }));
}

export type FantasyResult = { ok: true; picks: string[] } | { ok: false; status: number; error: string; message: string };

/** Drafts (or redrafts) a viewer's three, until the first ceremony's vote opens. */
export async function draftFantasy(db: Db, userId: string, picks: readonly string[], now: Date = new Date()): Promise<FantasyResult> {
  const ctx = await context(db, now);
  if (!ctx) return { ok: false, status: 404, error: "no_league", message: "This season has no fantasy league." };
  if (now >= ctx.locksAt) return { ok: false, status: 409, error: "draft_closed", message: "The draft closed when the first rose ceremony's vote opened." };
  const suitors = (await castSuitors(db, ctx.seasonId)).filter((s) => !s.out);
  const want = Math.min(FANTASY_PICKS, suitors.length);
  const unique = [...new Set(picks)];
  if (!want || unique.length !== want || unique.length !== picks.length) return { ok: false, status: 400, error: "pick_three", message: `Pick ${want} different suitors.` };
  if (!unique.every((p) => suitors.some((s) => s.id === p))) return { ok: false, status: 400, error: "not_a_suitor", message: "Pick from this season's suitors." };
  await db.query(
    `insert into fantasy_picks (season_id, user_id, picks) values ($1, $2, $3::jsonb)
       on conflict (season_id, user_id) do update set picks = excluded.picks, updated_at = now()`,
    [ctx.seasonId, userId, JSON.stringify(unique)],
  );
  return { ok: true, picks: unique };
}

export type FantasyBoard = {
  open: boolean;
  locks_at: string;
  players: number;
  suitors: { id: string; name: string; hue: number | null; portrait: string | null; house: boolean; out: boolean; points: number; drafted: number }[];
  mine: { picks: string[]; points: number; rank: number } | null;
  points: typeof FANTASY_POINTS;
};

/** The league as one viewer sees it: the suitors with their points, and the viewer's own draft, score and rank. */
export async function fantasyBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<FantasyBoard | null> {
  const ctx = await context(db, now);
  if (!ctx) return null;
  const [suitors, ceremonies, drafts] = await Promise.all([
    castSuitors(db, ctx.seasonId),
    scored(db, ctx.seasonId),
    db.query<{ user_id: string; picks: string[] }>(`select user_id, picks from fantasy_picks where season_id = $1`, [ctx.seasonId]),
  ]);
  if (!suitors.length) return null;
  const drafted = new Map<string, number>();
  for (const d of drafts.rows) for (const p of d.picks) drafted.set(p, (drafted.get(p) ?? 0) + 1);
  const scores = drafts.rows.map((d) => ({ user: d.user_id, picks: d.picks, points: draftPoints(d.picks, ceremonies) }));
  const me = viewerId ? scores.find((s) => s.user === viewerId) : undefined;
  return {
    open: now < ctx.locksAt,
    locks_at: ctx.locksAt.toISOString(),
    players: scores.length,
    suitors: suitors.map((s) => ({ ...s, points: suitorPoints(s.id, ceremonies), drafted: drafted.get(s.id) ?? 0 })),
    mine: me ? { picks: me.picks, points: me.points, rank: 1 + scores.filter((s) => s.points > me.points).length } : null,
    points: FANTASY_POINTS,
  };
}
