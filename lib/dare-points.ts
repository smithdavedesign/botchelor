/**
 * A winning dare pays its voters (wave 2 polish, David 2026-11-02). Viewers back one of three producer dares a night
 * (lib/dares.ts); the winner rides the house date, and the date itself says whether the dared one did it
 * (lib/dare-verdict.ts). Once that date airs, everyone who voted for the winning dare earns points by the verdict:
 * POINTS_PER_DARE (went through 5, sort of 2, chickened out 0). A vote for a dare that lost earns nothing (it never
 * made the date).
 *
 *  - Settled once per vote (dare_votes.points, settled_at): an unsettled row settles, so two passes racing settle and
 *    notify each voter once. The points then count in lib/game.ts getPointsBreakdown ("dares").
 *  - When: the moment the date airs (lib/air.ts airEpisode, lib/watch.ts's premiere), with the hourly lobby job as the
 *    backstop for a night whose verdict landed after its air, or an airing that crashed before it got here.
 *  - Only a public date pays, as only public dates score predictions. A night with no verdict yet waits for one.
 *  - Points are free, like every point on the show: no prizes, nothing bought changes them. $0, no model call.
 */
import { dareById } from "./dares";
import { DARE_VERDICTS, type DareVerdict } from "./dare-words";
import type { Db } from "./db";
import { notifyAll } from "./notifications";
import { POINTS_PER_DARE } from "./rules";

export type SettledDare = { day: string; episode_id: string; verdict: DareVerdict; points: number; voters: number };

type NightRow = { day: string; dare_id: string; verdict: string; episode_id: string; name: string };

const NIGHT_SQL = `select n.day, n.dare_id, n.verdict, n.episode_id, c.name
                     from dare_nights n join episodes e on e.id = n.episode_id join characters c on c.id = n.character_id
                    where n.verdict is not null and e.revealed_at is not null and e.visibility = 'public'`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The notice a voter gets, in the show's words: what happened, and what their vote earned. */
export function dareSettledNotice(name: string, dare: string, verdict: DareVerdict): { title: string; body: string } {
  const who = firstName(name);
  const points = POINTS_PER_DARE[verdict];
  if (verdict === "went_through") return { title: `Your dare paid off: +${points} points`, body: `${who} went through with it: "${dare}" Your vote earned +${points} points.` };
  if (verdict === "sort_of") return { title: `Your dare, sort of: +${points} points`, body: `${who} sort of did it: "${dare}" Half credit, generously: +${points} points.` };
  return { title: `${who} chickened out`, body: `"${dare}" ${who} had one job. No points for this one; tonight's ballot is open.` };
}

async function settle(db: Db, night: NightRow): Promise<SettledDare | null> {
  if (!(DARE_VERDICTS as readonly string[]).includes(night.verdict)) return null;
  const verdict = night.verdict as DareVerdict;
  const points = POINTS_PER_DARE[verdict];
  // Only an unsettled vote for the winning dare settles: running it again (or racing it) does nothing.
  const done = await db.query<{ user_id: string }>(
    `update dare_votes set points = $3, settled_at = now() where day = $1 and pick = $2 and settled_at is null returning user_id`,
    [night.day, night.dare_id, points],
  );
  if (!done.rows.length) return null;
  const def = dareById(night.dare_id);
  if (def) {
    const { title, body } = dareSettledNotice(night.name, def.text, verdict);
    await notifyAll(db, done.rows.map((r) => r.user_id), { kind: "dare_settled", title, body, link: `/episodes/${night.episode_id}` }).catch(() => {});
  }
  return { day: night.day, episode_id: night.episode_id, verdict, points, voters: done.rows.length };
}

/** Settles the dare riding one date, once it has aired (lib/air.ts, lib/watch.ts call this). Null: nothing to settle. */
export async function settleDareForEpisode(db: Db, episodeId: string): Promise<SettledDare | null> {
  const night = (await db.query<NightRow>(`${NIGHT_SQL} and n.episode_id = $1`, [episodeId])).rows[0];
  return night ? settle(db, night) : null;
}

/** The hourly backstop: the few aired, judged nights that still have unsettled winning votes. */
export async function settleDueDares(db: Db, limit = 5): Promise<SettledDare[]> {
  const { rows } = await db.query<NightRow>(
    `${NIGHT_SQL} and exists (select 1 from dare_votes v where v.day = n.day and v.pick = n.dare_id and v.settled_at is null)
      order by n.day desc limit $1`,
    [limit],
  );
  const out: SettledDare[] = [];
  for (const r of rows) {
    const s = await settle(db, r).catch(() => null);
    if (s) out.push(s);
  }
  return out;
}
