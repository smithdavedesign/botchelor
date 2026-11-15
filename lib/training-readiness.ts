/**
 * When the roadmap's two learning items can start (ROADMAP "Next"; docs/data-plan.md). Both say "Not before", and real
 * use on 2026-10-22 was about zero, so the tools are built ahead and this says when the data has caught up. Shown on
 * /admin/analytics' Quality tab (GET /api/admin/training-readiness) and printed by the scripts that will use the data
 * (scripts/eval/build-training-set.mjs, deck-cf-offline.mjs, chemistry-model.mjs).
 *
 * Fine-tuning on our own data (#577): about 2,000 labelled lines across 30+ characters, mostly from players other than
 * us. A line counts once, however many labels it has, and only through the dataset gates every builder uses
 * (lib/ml-consent.ts, the same as scripts/eval/export-preferences.mjs):
 *  - the date aired publicly (airedPublicSql: public, revealed, ready, not report-hidden, never After Dark);
 *  - every character on it is the show's own or its owner opted in by the date's time (consentedCharactersSql), and
 *    neither is a private character (PUBLIC_CHARACTERS_SQL: its card shows only its name, so its sheet can't be used);
 *  - a label is a 👍/👎 from someone who had opted in when they voted (consentedOwnerSql), or a critic revision that
 *    kept its rejected draft (turn_drafts source 'critic', text kept). The observer's flags are After Dark's, which no
 *    dataset ever reads, so they never count here.
 * "From other players": at least one of the line's labels isn't ours (lib/our-traffic.ts loadOurIds): a vote by someone
 * who isn't us, or a critic revision on a date someone who isn't us booked. "Mostly" is more than half.
 *
 * Learning from outcomes (#578): about 500 real dates a month and 200 swipers. Counted the way Real use counts
 * (lib/real-metrics.ts loadFacts and computeWindow: our own traffic and everything it made left out), over the last 30
 * days. Beside them, how much of it the offline evaluators may read (the same consent gates), since they only ever see
 * that part.
 *
 * A line ranker ("pairwise line labels", docs/ideas.md "Parked"; 2026-11-15): not built, and not to be before real
 * viewers leave about 100 thumbs a week. What it would learn from is kept and counted here so the gate is visible:
 *  - thumbs in the last 7 days on dates' lines from people who aren't us (the gate), with how many of them came from
 *    opted-in accounts (the only ones a dataset may read: an anonymous thumb counts toward the gate's volume, never
 *    toward a dataset) and how many say "Not them" (the out-of-character tag, lib/line-feedback.ts);
 *  - candidate/kept pairs: a stored candidate line (turn_drafts with its text kept) next to the line that went in at
 *    the same turn, and how many of those kept lines a viewer has rated. The join is `candidatePairsSql`:
 *    turn_drafts (episode_id, turn_index) is line_feedback (kind 'episode', ref_id, line_index), because a draft is
 *    logged at the transcript index its replacement takes (lib/conversation.ts onDraft, lib/own-date.ts) and nothing
 *    reorders a stored transcript. tests/line-ranker-data.test.ts holds both ends to that.
 *
 * No money anywhere (the owner's rule for the analytics page).
 */
import type { Db } from "./db";
import { airedPublicSql, consentedCharactersSql, consentedOwnerSql } from "./ml-consent";
import { loadOurIds } from "./our-traffic";
import { computeWindow, loadFacts } from "./real-metrics";

/** #577's "Not before" (David, 2026-10-21). */
export const FINE_TUNE_GATE = { lines: 2000, characters: 30 } as const;
/** #578's "Not before" (David, 2026-10-21): per this many days. */
export const OUTCOMES_GATE = { days: 30, dates: 500, swipers: 200 } as const;
/** docs/ideas.md "Parked, with the gate that reopens each": pairwise line labels wait for this many thumbs in a week. */
export const RANKER_GATE = { days: 7, thumbs: 100 } as const;

const DAY_MS = 86_400_000;

/**
 * SQL, on a date's characters `a` and `b`: neither is a private character. A private character's card shows only its name
 * to anyone but its owner, so its sheet can't go into a training example (scripts/eval/build-training-set.mjs), and its
 * dates' lines don't count toward the gate either. House characters are always public.
 */
export const PUBLIC_CHARACTERS_SQL = "a.visibility = 'public' and b.visibility = 'public'";

/**
 * One gate: `have` against `need`. A "count" gate is met at `need` or more; a "majority" gate (from other players) is met
 * when `have` is more than half of `need` (the labelled lines it's a share of), and never on none.
 */
export type ReadinessGate = { key: string; label: string; kind: "count" | "majority"; have: number; need: number; met: boolean };

export type FineTuneReadiness = {
  issue: 577;
  gates: ReadinessGate[];
  ready: boolean;
  sentence: string;
  /** How the labelled lines break down: by label kind, and the characters that are players' (not the house cast's). */
  detail: { voted_lines: number; critic_lines: number; player_characters: number; our_lines: number; out_of_character_lines: number };
};

export type OutcomesReadiness = {
  issue: 578;
  days: number;
  gates: ReadinessGate[];
  ready: boolean;
  sentence: string;
  /** The part the offline evaluators may read: aired public dates whose characters all opted in, and opted-in swipers. */
  usable: { dates: number; swipers: number };
};

/** What a line ranker would need, counted (never built before its gate): the week's thumbs, and the stored pairs. */
export type RankerReadiness = {
  days: number;
  gates: ReadinessGate[];
  ready: boolean;
  sentence: string;
  detail: {
    /** Of the week's thumbs (ours left out), the ones from accounts that opted in to training: all a dataset may read. */
    opted_in_thumbs: number;
    /** The week's 👎 marked "Not them" (ours left out), and how many there are in all. */
    out_of_character_week: number;
    out_of_character_total: number;
    /** Stored candidate lines whose text was kept, with the line that aired at the same turn by the same speaker. */
    pairs: number;
    /** Of those, pairs whose aired line has at least one thumb on it. */
    pairs_rated: number;
    /** Of those pairs, the ones on dates the dataset gates admit (aired publicly, characters opted in or the show's). */
    pairs_usable: number;
  };
};

export type TrainingReadiness = { generated_at: string; fine_tune: FineTuneReadiness; outcomes: OutcomesReadiness; ranker: RankerReadiness };

const metGate = (g: Omit<ReadinessGate, "met">): ReadinessGate => ({ ...g, met: g.kind === "count" ? g.have >= g.need : g.need > 0 && g.have * 2 > g.need });

const n = (x: number) => x.toLocaleString("en-US");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** A labelled line as the gates see it: which date and line, who spoke it, and whether each label is ours. */
type LabelRow = {
  episode_id: string;
  line_index: number;
  kind: "vote" | "critic";
  voter: string | null;
  /** A vote's tag: 'out_of_character' on a 👎 marked "Not them" (lib/line-feedback.ts), else null. */
  tag?: string | null;
  creator_id: string;
  side: string | null;
  character_a: string;
  character_b: string;
  a_house: boolean;
  b_house: boolean;
};

/**
 * Every label on a line of a date the dataset gates admit: opted-in people's votes, and critic revisions with their draft
 * kept. One row per label (a line with three votes and a revision is four rows).
 */
export async function loadLineLabels(db: Db): Promise<LabelRow[]> {
  const { rows } = await db.query<LabelRow>(
    `with eligible as (
       select e.id, e.creator_id, e.character_a, e.character_b, e.transcript, a.is_house as a_house, b.is_house as b_house
         from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
        where ${airedPublicSql("e")} and ${consentedCharactersSql("a", "b", "e.created_at")} and ${PUBLIC_CHARACTERS_SQL}
     ),
     labels as (
       select lf.ref_id as episode_id, lf.line_index, 'vote' as kind, lf.user_id as voter, lf.tag
         from line_feedback lf
        where lf.kind = 'episode' and lf.ref_id in (select id from eligible) and ${consentedOwnerSql("lf.user_id", "lf.created_at")}
       union all
       select d.episode_id, d.turn_index, 'critic', null, null
         from turn_drafts d
        where d.source = 'critic' and d.rejected is not null and d.episode_id in (select id from eligible)
     )
     select l.episode_id, l.line_index, l.kind, l.voter, l.tag, e.creator_id, e.transcript -> l.line_index ->> 'side' as side,
            e.character_a, e.character_b, e.a_house, e.b_house
       from labels l join eligible e on e.id = l.episode_id
      where l.line_index >= 0 and l.line_index < (case when jsonb_typeof(e.transcript) = 'array' then jsonb_array_length(e.transcript) else 0 end)`,
  );
  return rows.map((r) => ({ ...r, line_index: Number(r.line_index) }));
}

/** #577's gates from the labels and our own identities. */
export function fineTuneFrom(labels: readonly LabelRow[], ours: ReadonlySet<string>): FineTuneReadiness {
  const lines = new Map<string, { speaker: string | null; house: boolean; others: boolean; vote: boolean; critic: boolean; flagged: boolean }>();
  for (const l of labels) {
    const key = `${l.episode_id}#${l.line_index}`;
    const speaker = l.side === "a" ? l.character_a : l.side === "b" ? l.character_b : null;
    const line = lines.get(key) ?? { speaker, house: l.side === "a" ? l.a_house : l.b_house, others: false, vote: false, critic: false, flagged: false };
    if (l.kind === "vote") {
      line.vote = true;
      if (l.tag === "out_of_character") line.flagged = true;
      if (l.voter && !ours.has(l.voter)) line.others = true;
    } else {
      line.critic = true;
      if (!ours.has(l.creator_id)) line.others = true;
    }
    lines.set(key, line);
  }
  const all = [...lines.values()];
  const characters = new Set(all.flatMap((l) => (l.speaker ? [l.speaker] : [])));
  const players = new Set(all.flatMap((l) => (l.speaker && !l.house ? [l.speaker] : [])));
  const others = all.filter((l) => l.others).length;
  const gates = [
    metGate({ key: "lines", label: "Labelled lines", kind: "count", have: all.length, need: FINE_TUNE_GATE.lines }),
    metGate({ key: "characters", label: "Characters speaking them", kind: "count", have: characters.size, need: FINE_TUNE_GATE.characters }),
    metGate({ key: "others", label: "Lines labelled by players other than us", kind: "majority", have: others, need: all.length }),
  ];
  const ready = gates.every((g) => g.met);
  const still: string[] = [];
  if (!gates[0].met) still.push(`${plural(gates[0].need - gates[0].have, "more line")}`);
  if (!gates[1].met) still.push(`${plural(gates[1].need - gates[1].have, "more character")}`);
  if (!gates[2].met) still.push(all.length ? "more than half of them from other players" : "lines from other players");
  const sentence = ready
    ? "Fine-tuning (#577) can start: the labelled lines are in. Build the set with scripts/eval/build-training-set.mjs, and ship only through the golden gate."
    : `Fine-tuning (#577) can start when ${n(FINE_TUNE_GATE.lines)} labelled lines from opted-in players' aired public dates are in, ` +
      `across ${FINE_TUNE_GATE.characters} characters, mostly from players other than us. Still needed: ${joinAnd(still)}.`;
  return {
    issue: 577,
    gates,
    ready,
    sentence,
    detail: {
      voted_lines: all.filter((l) => l.vote).length,
      critic_lines: all.filter((l) => l.critic).length,
      player_characters: players.size,
      our_lines: all.length - others,
      out_of_character_lines: all.filter((l) => l.flagged).length,
    },
  };
}

/** #577's readiness. `ours` defaults to lib/our-traffic.ts loadOurIds. */
export async function fineTuneReadiness(db: Db, ours?: ReadonlySet<string>): Promise<FineTuneReadiness> {
  return fineTuneFrom(await loadLineLabels(db), ours ?? new Set(await loadOurIds(db)));
}

/** How much of the last `days` the offline evaluators may read: consenting aired public dates and opted-in swipers, ours out. */
async function usableOutcomes(db: Db, ours: readonly string[], since: string): Promise<{ dates: number; swipers: number }> {
  const { rows } = await db.query<{ dates: number; swipers: number }>(
    `select
       (select count(*)::int from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
         where e.created_at >= $2 and ${airedPublicSql("e")} and ${consentedCharactersSql("a", "b", "e.created_at")}
           and e.creator_id <> all($1::text[]) and coalesce(a.owner_id, '') <> all($1::text[]) and coalesce(b.owner_id, '') <> all($1::text[])) as dates,
       (select count(distinct c.owner_id)::int from swipes s join characters c on c.id = s.swiper join characters t on t.id = s.target
         where s.created_at >= $2 and not c.is_house and c.owner_id is not null and c.owner_id <> all($1::text[])
           and (t.is_house or t.owner_id <> all($1::text[]))
           and ${consentedCharactersSql("c", "t", "s.created_at")}) as swipers`,
    [ours, since],
  );
  return { dates: Number(rows[0]?.dates ?? 0), swipers: Number(rows[0]?.swipers ?? 0) };
}

/** #578's readiness: real dates and distinct swipers in the last 30 days, the way Real use counts them. */
export async function outcomesReadiness(db: Db, now = new Date()): Promise<OutcomesReadiness> {
  const days = OUTCOMES_GATE.days;
  const facts = await loadFacts(db, days, now);
  const window = computeWindow(facts, days);
  const since = new Date(now.getTime() - days * DAY_MS);
  const booked = window.dates.booked.kind === "count" ? window.dates.booked.value : 0;
  // A swipe is its swiping character's owner's (lib/real-metrics.ts loadFacts: kind 'swipe', id = the owner).
  const swipers = new Set(facts.events.filter((e) => e.kind === "swipe" && e.at >= since && e.at <= now && !facts.ours.has(e.id)).map((e) => e.id)).size;
  const gates = [
    metGate({ key: "dates", label: `Real dates, last ${days} days`, kind: "count", have: booked, need: OUTCOMES_GATE.dates }),
    metGate({ key: "swipers", label: `Real swipers, last ${days} days`, kind: "count", have: swipers, need: OUTCOMES_GATE.swipers }),
  ];
  const ready = gates.every((g) => g.met);
  const still = gates.filter((g) => !g.met).map((g) => plural(g.need - g.have, g.key === "dates" ? "more date" : "more swiper"));
  const sentence = ready
    ? "Learning from outcomes (#578) can start: real use is there. Run the offline evaluators (scripts/eval/deck-cf-offline.mjs, chemistry-model.mjs) before anything goes live."
    : `Learning from outcomes (#578) can start when real use reaches ${n(OUTCOMES_GATE.dates)} dates and ${n(OUTCOMES_GATE.swipers)} swipers in ${days} days. ` +
      `Still needed: ${joinAnd(still)}.`;
  return { issue: 578, days, gates, ready, sentence, usable: await usableOutcomes(db, [...facts.ours], since.toISOString()) };
}

/**
 * SQL: every stored candidate line with the line that aired in its place and the thumbs on that aired line. One row a
 * draft (turn_drafts with its text kept: a critic's replaced draft, an agent's refused line or check_only try):
 * `kept` is the transcript's line at the draft's turn, joined only when the same side spoke it (a date abandoned before
 * the turn was filled has none), and up / down / out_of_character count every vote on that line (line_feedback kind
 * 'episode': ref_id is the episode, line_index the transcript index, which is what turn_index is). No ids of voters.
 * A reader that builds a dataset must still gate it (lib/ml-consent.ts): this is the join, not the consent.
 */
export const candidatePairsSql = (where = "true") => `
  select d.id as draft_id, d.episode_id, d.turn_index, d.side, d.source, d.reason, d.rejected,
         e.transcript -> d.turn_index ->> 'dialogue' as kept,
         (select count(*) filter (where lf.vote > 0)::int from line_feedback lf where lf.kind = 'episode' and lf.ref_id = d.episode_id and lf.line_index = d.turn_index) as up,
         (select count(*) filter (where lf.vote < 0)::int from line_feedback lf where lf.kind = 'episode' and lf.ref_id = d.episode_id and lf.line_index = d.turn_index) as down,
         (select count(*) filter (where lf.tag = 'out_of_character')::int from line_feedback lf where lf.kind = 'episode' and lf.ref_id = d.episode_id and lf.line_index = d.turn_index) as out_of_character
    from turn_drafts d
    join episodes e on e.id = d.episode_id
   where d.rejected is not null
     and e.transcript -> d.turn_index ->> 'side' = d.side
     and e.transcript -> d.turn_index ->> 'dialogue' is not null
     and ${where}`;

export type CandidatePair = { draft_id: string; episode_id: string; turn_index: number; side: "a" | "b"; source: string; reason: string; rejected: string; kept: string; up: number; down: number; out_of_character: number };

/** The candidate/kept pairs of one date (or all of them), with the thumbs on each kept line. */
export async function candidatePairs(db: Db, episodeId?: string): Promise<CandidatePair[]> {
  const { rows } = await db.query<CandidatePair>(`${candidatePairsSql(episodeId ? "d.episode_id = $1" : "true")} order by d.episode_id, d.turn_index, d.id`, episodeId ? [episodeId] : []);
  return rows.map((r) => ({ ...r, draft_id: String(r.draft_id), turn_index: Number(r.turn_index), up: Number(r.up), down: Number(r.down), out_of_character: Number(r.out_of_character) }));
}

/** The ranker's gate and what's stored for it. `ours` defaults to lib/our-traffic.ts loadOurIds. */
export async function rankerReadiness(db: Db, now = new Date(), ours?: readonly string[]): Promise<RankerReadiness> {
  const days = RANKER_GATE.days;
  const mine = ours ?? (await loadOurIds(db));
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const [week, total, pairs] = await Promise.all([
    // The week's thumbs on dates' lines (never After Dark's), ours left out; opted-in ones beside them.
    db.query<{ thumbs: number; opted_in: number; flagged: number }>(
      `select count(*)::int as thumbs,
              count(*) filter (where ${consentedOwnerSql("lf.user_id", "lf.created_at")})::int as opted_in,
              count(*) filter (where lf.tag = 'out_of_character')::int as flagged
         from line_feedback lf
        where lf.kind = 'episode' and lf.updated_at > $2::timestamptz and lf.updated_at <= $3::timestamptz and lf.user_id <> all($1::text[])`,
      [mine, since, now.toISOString()],
    ),
    db.query<{ n: number }>(`select count(*)::int as n from line_feedback where kind = 'episode' and tag = 'out_of_character'`),
    db.query<{ pairs: number; rated: number; usable: number }>(
      `select count(*)::int as pairs,
              count(*) filter (where p.up + p.down > 0)::int as rated,
              count(*) filter (where exists (
                select 1 from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
                 where e.id = p.episode_id and ${airedPublicSql("e")} and ${consentedCharactersSql("a", "b", "e.created_at")} and ${PUBLIC_CHARACTERS_SQL}))::int as usable
         from (${candidatePairsSql()}) p`,
    ),
  ]);
  const w = week.rows[0] ?? { thumbs: 0, opted_in: 0, flagged: 0 };
  const p = pairs.rows[0] ?? { pairs: 0, rated: 0, usable: 0 };
  const gates = [metGate({ key: "thumbs", label: `Thumbs on lines, last ${days} days`, kind: "count", have: Number(w.thumbs), need: RANKER_GATE.thumbs })];
  const ready = gates.every((g) => g.met);
  const sentence = ready
    ? "Pairwise line labels can start: viewers are rating lines. Build the labels from the stored pairs before any ranker; nothing ranks a live line until it has passed the golden gate."
    : `A line ranker waits for ${n(RANKER_GATE.thumbs)} thumbs a week from viewers who aren't us (docs/ideas.md). Still needed: ${plural(RANKER_GATE.thumbs - Number(w.thumbs), "more thumb")} this week. Nothing is built until then; the pairs are kept.`;
  return {
    days,
    gates,
    ready,
    sentence,
    detail: {
      opted_in_thumbs: Number(w.opted_in),
      out_of_character_week: Number(w.flagged),
      out_of_character_total: Number(total.rows[0]?.n ?? 0),
      pairs: Number(p.pairs),
      pairs_rated: Number(p.rated),
      pairs_usable: Number(p.usable),
    },
  };
}

/** All three, for the admin page. */
export async function trainingReadiness(db: Db, now = new Date()): Promise<TrainingReadiness> {
  const outcomes = await outcomesReadiness(db, now);
  return { generated_at: now.toISOString(), fine_tune: await fineTuneReadiness(db), outcomes, ranker: await rankerReadiness(db, now) };
}

/** "x of y" as the page and the scripts print a gate. */
export function gateText(g: ReadinessGate): string {
  return g.kind === "majority" ? `${n(g.have)} of ${n(g.need)} (needs more than half)` : `${n(g.have)} of ${n(g.need)}`;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
