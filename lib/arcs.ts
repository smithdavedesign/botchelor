/**
 * Arc predictions: spectators call where a couple is headed. "Will they make it to date N?", where N is two past
 * their public dates and at least 3 (date 2 is just the next episode's prediction). Free points (POINTS_PER_ARC) for
 * a right call, counted in the weekly league boards like episode predictions. Never prizes, never bought.
 *
 * Fair by construction:
 *  - **Resolved from the public record** (lib/relationships.ts), deterministically: YES once they've aired N dates
 *    together; NO if they break up first (exes, bad blood), or when ARC_DAYS pass without getting there.
 *  - **Owners can't predict their own couple**: they decide whether there's another date, so it would be no
 *    prediction at all.
 *  - One call per person per couple per question; it can't be changed.
 */
import { shortName } from "./names";
import type { Db } from "./db";
import { notify } from "./notifications";
import { pairKey, type Stage } from "./relationships";
import { POINTS_PER_ARC } from "./rules";

/** How long a question stays open before an unreached target counts as NO. */
export const ARC_DAYS = 21;
const BREAKUPS: ReadonlySet<Stage> = new Set(["exes", "bad_blood"]);

/** The date a couple at `publicDates` aired dates is asked about. */
export const arcTarget = (publicDates: number): number => Math.max(3, publicDates + 2);

export type ArcQuestion = {
  /** "Will they make it to date {target}?" */
  target: number;
  open: boolean;
  yes: number;
  no: number;
  my_pick: boolean | null;
  can_predict: boolean;
  /** Why not, when they can't: "owner" | "predicted" | "breakup" | "not_listed". */
  reason: string | null;
  /** This viewer's settled calls on this couple. */
  settled: { target: number; pick: boolean; outcome: boolean; points: number }[];
};

type EdgeRow = { public_dates: number; public_stage: Stage | null; lo_owner: string | null; hi_owner: string | null };

async function edge(db: Db, lo: string, hi: string): Promise<EdgeRow | null> {
  const { rows } = await db.query<EdgeRow>(
    `select r.public_dates, r.public_stage, ca.owner_id as lo_owner, cb.owner_id as hi_owner
       from relationships r join characters ca on ca.id = r.character_a join characters cb on cb.id = r.character_b
      where r.character_a = $1 and r.character_b = $2`,
    [lo, hi],
  );
  return rows[0] ?? null;
}

/** The couple's open question and this viewer's place in it. */
export async function arcQuestion(db: Db, viewerId: string | null, x: string, y: string): Promise<ArcQuestion | null> {
  const [lo, hi] = pairKey(x, y);
  const e = await edge(db, lo, hi);
  if (!e || e.public_dates === 0) return null;
  const target = arcTarget(e.public_dates);
  const { rows } = await db.query<{ yes: number; no: number }>(
    `select count(*) filter (where pick)::int as yes, count(*) filter (where not pick)::int as no
       from arc_predictions where character_lo = $1 and character_hi = $2 and target = $3`,
    [lo, hi, target],
  );
  const mine = viewerId
    ? (await db.query<{ target: number; pick: boolean; outcome: boolean | null }>(
        `select target, pick, outcome from arc_predictions where user_id = $1 and character_lo = $2 and character_hi = $3 order by target`,
        [viewerId, lo, hi],
      )).rows
    : [];
  const myPick = mine.find((m) => m.target === target)?.pick ?? null;
  const owner = viewerId !== null && (e.lo_owner === viewerId || e.hi_owner === viewerId);
  const breakup = e.public_stage !== null && BREAKUPS.has(e.public_stage);
  const reason = owner ? "owner" : myPick !== null ? "predicted" : breakup ? "breakup" : null;
  return {
    target,
    open: !breakup,
    yes: rows[0]?.yes ?? 0,
    no: rows[0]?.no ?? 0,
    my_pick: myPick,
    // A first-time visitor has no session yet, but answering starts one (the arc route's session()), so they can call it too.
    can_predict: reason === null,
    reason,
    settled: mine.filter((m) => m.outcome !== null).map((m) => ({ target: m.target, pick: m.pick, outcome: m.outcome!, points: m.pick === m.outcome ? POINTS_PER_ARC : 0 })),
  };
}

export type ArcResult = { ok: true; target: number; pick: boolean } | { ok: false; status: number; error: string; message: string };

/** Makes a call on the couple's open question. */
export async function predictArc(db: Db, userId: string, x: string, y: string, pick: boolean, now = new Date()): Promise<ArcResult> {
  const q = await arcQuestion(db, userId, x, y);
  if (!q) return { ok: false, status: 404, error: "not_listed", message: "There's nothing to predict until their dates have aired." };
  if (!q.can_predict) {
    const message =
      q.reason === "owner" ? "You own one of them, so you decide this one: predictions are for everyone else."
      : q.reason === "predicted" ? "You've already made this call."
      : "They've broken up: no arc to call right now.";
    return { ok: false, status: q.reason === "predicted" ? 409 : 422, error: q.reason ?? "closed", message };
  }
  const [lo, hi] = pairKey(x, y);
  const deadline = new Date(now.getTime() + ARC_DAYS * 86_400_000);
  const { rows } = await db.query(
    `insert into arc_predictions (user_id, character_lo, character_hi, target, pick, deadline) values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing returning user_id`,
    [userId, lo, hi, q.target, pick, deadline.toISOString()],
  );
  if (!rows.length) return { ok: false, status: 409, error: "predicted", message: "You've already made this call." };
  return { ok: true, target: q.target, pick };
}

/**
 * Settles a couple's open questions from the public record: YES once they've aired the target number of dates,
 * NO on a breakup or past the deadline. Each predictor hears how it went. Idempotent.
 */
export async function resolveArcs(db: Db, x: string, y: string, now = new Date()): Promise<number> {
  const [lo, hi] = pairKey(x, y);
  const e = await edge(db, lo, hi);
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[lo, hi]])).rows.map((r) => [r.id, shortName(r.name)]),
  );
  const { rows } = await db.query<{ user_id: string; target: number; pick: boolean; deadline: Date | string }>(
    `select user_id, target, pick, deadline from arc_predictions where character_lo = $1 and character_hi = $2 and resolved_at is null`,
    [lo, hi],
  );
  let settled = 0;
  for (const p of rows) {
    const reached = (e?.public_dates ?? 0) >= p.target;
    const brokeUp = e?.public_stage ? BREAKUPS.has(e.public_stage) : false;
    const expired = new Date(p.deadline).getTime() <= now.getTime();
    if (!reached && !brokeUp && !expired) continue;
    const outcome = reached;
    const done = await db.query(
      `update arc_predictions set resolved_at = $5, outcome = $6
        where user_id = $1 and character_lo = $2 and character_hi = $3 and target = $4 and resolved_at is null returning user_id`,
      [p.user_id, lo, hi, p.target, now.toISOString(), outcome],
    );
    if (!done.rows.length) continue;
    settled++;
    const right = p.pick === outcome;
    const couple = `${names.get(lo)} & ${names.get(hi)}`;
    await notify(db, p.user_id, {
      kind: "arc_resolved",
      title: right ? `🔮 You called it: +${POINTS_PER_ARC} points` : "🔮 Not this time",
      body: outcome ? `${couple} made it to date ${p.target}.` : `${couple} didn't make it to date ${p.target}.`,
      link: `/couples/${lo}/${hi}`,
    });
  }
  return settled;
}

/** The daily sweep: settles questions whose deadline has passed. */
export async function resolveExpiredArcs(db: Db, now = new Date()): Promise<number> {
  const { rows } = await db.query<{ lo: string; hi: string }>(
    `select distinct character_lo as lo, character_hi as hi from arc_predictions where resolved_at is null and deadline <= $1`,
    [now.toISOString()],
  );
  let n = 0;
  for (const r of rows) n += await resolveArcs(db, r.lo, r.hi, now);
  return n;
}
