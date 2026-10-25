/**
 * The house matchmaker (Agent World Phase 2, docs/PRDs/agent-world.md): once a day, propose a few high-chemistry
 * pairs among characters that are open to dates, and tell both owners why. Deterministic and free — it reuses
 * rankFor through findMatches (lib/dating.ts), the same scoring the swipe deck uses, so every rule that guards the
 * deck guards a pick: open_to_dates, audience both ways (a pick needs each side to rank the other, which each side's
 * audience must allow), blocks, private characters, taken characters, exes. It only ever proposes: a date still
 * takes the usual mutual yes (the swipe gate). A pair is proposed once, ever (matchmaker_picks), a character carries
 * at most one pick a day, and a pair of two house-run bots is skipped (nobody real to tell).
 */
import type { Db } from "./db";
import { findMatches } from "./dating";
import { houseBotCharacterIds } from "./house-bots";
import { notify } from "./notifications";
import { pairKey } from "./relationships";

/** New pairs proposed a day. */
export const MATCHMAKER_DAILY_PICKS = 3;
/** Newest open characters considered each day. */
const SEEDS = 40;
/** How deep in each character's own ranking a partner may sit. */
const TOP = 5;
/** What the two directions' scores must add up to (one shared trait scores 3 a side). */
const MUTUAL_MIN = 4;
/** What meeting across a double date's table is worth (one shared trait is 3): seen beats inferred, but not by much. */
const TABLE_BOOST = 3;

/** Whether two characters sat at the same double date's table (on opposite tables), both tables aired publicly. */
export async function sharedTable(db: Db, aId: string, bId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from group_nights gn
       join episodes ea on ea.id = gn.episode_a and ea.revealed_at is not null and ea.visibility = 'public'
       join episodes eb on eb.id = gn.episode_b and eb.revealed_at is not null and eb.visibility = 'public'
      where ($1 in (ea.character_a, ea.character_b) and $2 in (eb.character_a, eb.character_b))
         or ($2 in (ea.character_a, ea.character_b) and $1 in (eb.character_a, eb.character_b))
      limit 1`,
    [aId, bId],
  );
  return rows.length > 0;
}

type Seed = { id: string; name: string; owner_id: string };

/** Runs from the daily job. Returns how many new pairs were proposed (0 when today's already ran). */
export async function dailyMatchmakerPicks(db: Db, now: Date = new Date(), limit: number = MATCHMAKER_DAILY_PICKS): Promise<number> {
  const today = await db.query(`select 1 from matchmaker_picks where picked_at >= date_trunc('day', $1::timestamptz) limit 1`, [now.toISOString()]);
  if (today.rows.length) return 0; // the daily job ran again today

  const seeds = (
    await db.query<Seed>(
      `select id, name, owner_id from characters
        where open_to_dates and not is_house and visibility <> 'private'
          and owner_id is not null and owner_id <> 'deleted'
        order by created_at desc limit $1`,
      [SEEDS],
    )
  ).rows;
  if (seeds.length < 2) return 0;
  const byId = new Map(seeds.map((s) => [s.id, s]));

  // Each seed's view of the others, through the same owner-scoped ranking the deck uses, so blocks and audiences
  // hold. A pair that has met already carries `relationship` and is skipped (rankFor keeps exes out on its own).
  const liked = new Map<string, { score: number; why: string[] }>();
  for (const s of seeds) {
    const r = await findMatches(db, s.owner_id, s.id, TOP).catch(() => null);
    for (const m of r?.matches ?? []) {
      const other = byId.get(m.id);
      if (!other || other.owner_id === s.owner_id || m.relationship || m.score <= 0) continue;
      liked.set(`${s.id}>${m.id}`, { score: m.score, why: m.why });
    }
  }

  // Mutual pairs, strongest first.
  const pairs: { lo: Seed; hi: Seed; mutual: number; why: string[] }[] = [];
  const seen = new Set<string>();
  for (const key of liked.keys()) {
    const [a, b] = key.split(">");
    const [lo, hi] = pairKey(a, b);
    if (seen.has(`${lo}|${hi}`)) continue;
    seen.add(`${lo}|${hi}`);
    const ab = liked.get(`${lo}>${hi}`);
    const ba = liked.get(`${hi}>${lo}`);
    if (!ab || !ba || ab.score + ba.score < MUTUAL_MIN) continue;
    pairs.push({ lo: byId.get(lo)!, hi: byId.get(hi)!, mutual: ab.score + ba.score, why: ab.why.length >= ba.why.length ? ab.why : ba.why });
  }
  // Observed chemistry beats inferred (docs/PRDs/group-dates.md M3): a pair that shared a double date's table —
  // publicly aired, and never a pair that has dated (those carry `relationship` and were skipped above) — ranks up.
  for (const p of pairs) {
    if (await sharedTable(db, p.lo.id, p.hi.id).catch(() => false)) {
      p.mutual += TABLE_BOOST;
      p.why.unshift("they've already shared a table on a double date");
    }
  }
  pairs.sort((x, y) => y.mutual - x.mutual);
  if (!pairs.length) return 0;

  // Never the same pair twice, never a pair that already matched in the deck, one pick per character a day, and
  // no pick between two house-run bots.
  const bots = await houseBotCharacterIds(db, [...new Set(pairs.flatMap((p) => [p.lo.id, p.hi.id]))]);
  const used = new Set<string>();
  let made = 0;
  for (const p of pairs) {
    if (made >= Math.max(1, limit)) break;
    if (used.has(p.lo.id) || used.has(p.hi.id)) continue;
    if (bots.has(p.lo.id) && bots.has(p.hi.id)) continue;
    const already = await db.query(
      `select 1 from matchmaker_picks where character_lo = $1 and character_hi = $2
       union all
       select 1 from matches where character_lo = $1 and character_hi = $2`,
      [p.lo.id, p.hi.id],
    );
    if (already.rows.length) continue;
    const ins = await db.query(
      `insert into matchmaker_picks (character_lo, character_hi, mutual, picked_at) values ($1, $2, $3, $4) on conflict do nothing returning character_lo`,
      [p.lo.id, p.hi.id, p.mutual, now.toISOString()],
    );
    if (!ins.rows.length) continue;
    used.add(p.lo.id).add(p.hi.id);
    made += 1;
    const because = p.why.slice(0, 2).join("; ") || "the show's read on their traits";
    for (const [mine, theirs] of [
      [p.lo, p.hi],
      [p.hi, p.lo],
    ] as const) {
      await notify(db, mine.owner_id, {
        kind: "matchmaker_pick",
        title: `💘 The matchmaker's pick: ${p.lo.name} × ${p.hi.name}`,
        body: `Why: ${because}. A like both ways makes it a match (swipe with character_id ${mine.id}); when both characters say yes, either side books the date.`,
        link: `/characters/${theirs.id}`,
      }).catch(() => {});
    }
  }
  return made;
}
