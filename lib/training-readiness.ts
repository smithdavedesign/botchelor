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
  detail: { voted_lines: number; critic_lines: number; player_characters: number; our_lines: number };
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

export type TrainingReadiness = { generated_at: string; fine_tune: FineTuneReadiness; outcomes: OutcomesReadiness };

const metGate = (g: Omit<ReadinessGate, "met">): ReadinessGate => ({ ...g, met: g.kind === "count" ? g.have >= g.need : g.need > 0 && g.have * 2 > g.need });

const n = (x: number) => x.toLocaleString("en-US");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** A labelled line as the gates see it: which date and line, who spoke it, and whether each label is ours. */
type LabelRow = {
  episode_id: string;
  line_index: number;
  kind: "vote" | "critic";
  voter: string | null;
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
       select lf.ref_id as episode_id, lf.line_index, 'vote' as kind, lf.user_id as voter
         from line_feedback lf
        where lf.kind = 'episode' and lf.ref_id in (select id from eligible) and ${consentedOwnerSql("lf.user_id", "lf.created_at")}
       union all
       select d.episode_id, d.turn_index, 'critic', null
         from turn_drafts d
        where d.source = 'critic' and d.rejected is not null and d.episode_id in (select id from eligible)
     )
     select l.episode_id, l.line_index, l.kind, l.voter, e.creator_id, e.transcript -> l.line_index ->> 'side' as side,
            e.character_a, e.character_b, e.a_house, e.b_house
       from labels l join eligible e on e.id = l.episode_id
      where l.line_index >= 0 and l.line_index < (case when jsonb_typeof(e.transcript) = 'array' then jsonb_array_length(e.transcript) else 0 end)`,
  );
  return rows.map((r) => ({ ...r, line_index: Number(r.line_index) }));
}

/** #577's gates from the labels and our own identities. */
export function fineTuneFrom(labels: readonly LabelRow[], ours: ReadonlySet<string>): FineTuneReadiness {
  const lines = new Map<string, { speaker: string | null; house: boolean; others: boolean; vote: boolean; critic: boolean }>();
  for (const l of labels) {
    const key = `${l.episode_id}#${l.line_index}`;
    const speaker = l.side === "a" ? l.character_a : l.side === "b" ? l.character_b : null;
    const line = lines.get(key) ?? { speaker, house: l.side === "a" ? l.a_house : l.b_house, others: false, vote: false, critic: false };
    if (l.kind === "vote") {
      line.vote = true;
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

/** Both, for the admin page. */
export async function trainingReadiness(db: Db, now = new Date()): Promise<TrainingReadiness> {
  const outcomes = await outcomesReadiness(db, now);
  return { generated_at: now.toISOString(), fine_tune: await fineTuneReadiness(db), outcomes };
}

/** "x of y" as the page and the scripts print a gate. */
export function gateText(g: ReadinessGate): string {
  return g.kind === "majority" ? `${n(g.have)} of ${n(g.need)} (needs more than half)` : `${n(g.have)} of ${n(g.need)}`;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
