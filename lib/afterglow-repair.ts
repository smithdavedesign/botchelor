/**
 * Write the morning-after texts a date aired without (2026-11-16). The texts are best effort (lib/afterglow.ts): when
 * a date's whole thread failed, it stayed empty for good. This writes it once, on request, for one date.
 *
 * Like the transcript backfill (lib/backfill.ts), it writes FROM what is stored and changes nothing that was decided:
 * the stored ending, box score and each side's verdict are what the two text about, the stored lines are the date they
 * remember, and whoever went quiet under the date's own answers (ghosted, lib/ending-detail.ts) stays quiet. Only
 * `episodes.afterglow` is written, and only while it is still empty, so a second run (or a run against a date that has
 * its texts) writes nothing. The ending's kind (ending_detail) was settled when the date was written and is left alone.
 *
 * Not for a date an agent performed: those have no texts by design. Asked for by an admin only
 * (POST /api/admin/afterglow); nothing calls it on its own.
 */
import { AfterglowError, simulateAfterglow } from "./afterglow";
import { storedOutcome } from "./backfill";
import type { Character } from "./character";
import { generationPaused } from "./compute";
import type { Turn } from "./conversation";
import type { Db } from "./db";
import { ghostSide } from "./ending-detail";
import type { CharacterSheet, SideOutcome, VariableArc } from "./engine";
import { DEFAULT_FORMAT, formatContextOf } from "./formats";
import type { DateSetup } from "./game";
import type { SeeAgain } from "./inner-life";
import { claimPaidDate } from "./limits";
import { frontierConfigured, getFrontierModel, getModel, type Model } from "./model";
import { dateNumberOf, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY, type DateVariable, type DramaAnswer, type DramaQuestion, type Ending } from "./rules";
import { buildDate, type CharacterForDate, type DateRequest } from "./simulation";

type Row = {
  id: string;
  status: string;
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  ending: Ending;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  box_score: Record<DateVariable, VariableArc> | null;
  sides: [SideOutcome, SideOutcome] | null;
  transcript: Turn[] | null;
  texts: number;
  performed_by: string | null;
  partner_performer: string | null;
  choices: { a?: SeeAgain; b?: SeeAgain } | null;
  a_id: string; a_name: string; a_age: number; a_bio: string; a_traits: string[]; a_want: string; a_dealbreaker: string; a_house: boolean; a_appearance: string | null; a_pronouns: string | null; a_voice: string | null;
  b_id: string; b_name: string; b_age: number; b_bio: string; b_traits: string[]; b_want: string; b_dealbreaker: string; b_house: boolean; b_appearance: string | null; b_pronouns: string | null; b_voice: string | null;
};

const sheet = (r: Row, p: "a" | "b"): CharacterSheet => ({
  name: r[`${p}_name`],
  age: r[`${p}_age`],
  bio: r[`${p}_bio`],
  traits: r[`${p}_traits`],
  want: r[`${p}_want`],
  dealbreaker: r[`${p}_dealbreaker`],
  house: r[`${p}_house`],
  appearance: r[`${p}_appearance`] ?? undefined,
  pronouns: r[`${p}_pronouns`] ?? undefined,
  voice: r[`${p}_voice`] ?? undefined,
});

export type AfterglowRepair =
  /** `written` texts were stored now; 0 with `already` set means the date had its texts (or another run got there first). */
  | { ok: true; written: number; already: number }
  | { ok: false; reason: "episode_not_found" | "not_ready" | "performed_by_agent" | "no_conversation" | "generation_paused" | "texts_failed"; detail?: string };

/**
 * Writes one date's missing morning-after texts. `model` is for tests; otherwise the show's model, as for a booked date
 * (lib/jobs.ts): the paid one when it's configured (counted against the day's paid dates), else the free one.
 */
export async function writeMissingAfterglow(db: Db, episodeId: string, opts: { model?: Model } = {}): Promise<AfterglowRepair> {
  const { rows } = await db.query<Row>(
    `select e.id, e.status, e.seed::text as seed, e.setup, e.note, e.ending, e.drama_question, e.drama_answer, e.box_score, e.sides,
            e.transcript, jsonb_array_length(e.afterglow) as texts, e.performed_by, e.partner_performer, e.wishes->'choices' as choices,
            a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want,
            a.dealbreaker a_dealbreaker, a.is_house a_house, a.appearance a_appearance, a.pronouns a_pronouns, a.voice a_voice,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
            b.dealbreaker b_dealbreaker, b.is_house b_house, b.appearance b_appearance, b.pronouns b_pronouns, b.voice b_voice
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId],
  );
  const r = rows[0];
  if (!r) return { ok: false, reason: "episode_not_found" };
  if (r.status !== "ready") return { ok: false, reason: "not_ready" };
  if (r.performed_by === "agent" || r.partner_performer) return { ok: false, reason: "performed_by_agent" };
  if (r.texts > 0) return { ok: true, written: 0, already: r.texts };
  const date = r.transcript ?? [];
  // The texts are about the date: with no lines to remember there is nothing to text about.
  if (!date.length) return { ok: false, reason: "no_conversation" };
  if (generationPaused()) return { ok: false, reason: "generation_paused" };

  const seed = r.seed === null ? undefined : Number(r.seed);
  const format = r.setup?.format ?? DEFAULT_FORMAT;
  const req: DateRequest = {
    autonomy: r.setup?.autonomy ?? DEFAULT_AUTONOMY,
    strategy: r.setup?.strategy ?? DEFAULT_STRATEGY,
    gameBudget: r.setup?.game_budget_a ?? DEFAULT_GAME_BUDGET,
    agendaId: r.setup?.agenda_a ?? null,
    note: r.note,
    format,
  };
  const forDate = (p: "a" | "b"): CharacterForDate => ({ id: r[`${p}_id`], sheet: sheet(r, p) });
  const snapshot = r.setup?.signals_a && r.setup?.signals_b ? { a: r.setup.signals_a, b: r.setup.signals_b } : undefined;
  const built = await buildDate(db, r.id, forDate("a"), forDate("b"), req, seed, snapshot, {
    historyOverride: r.setup?.history,
    legacyHistory: true,
    dateNumber: dateNumberOf(r.setup),
    nudges: { a: r.setup?.nudge_a ?? null, b: r.setup?.nudge_b ?? null },
    avoidVenues: r.setup?.avoid_venues ?? [],
    venueOverride: r.setup?.venue,
    agreedPlan: r.setup?.agreed_plan ?? null,
    table: r.setup?.table ?? null,
    roleplay: r.setup?.roleplay ?? null,
  });
  // They text as they were that morning: no memory of dates that came after it (as the backfill's lines do).
  const characters = built.characters.map((c) => ({ ...c, memory: null })) as [Character, Character];
  const outcome = storedOutcome(r, built.seed);
  const venueId = r.setup?.venue ?? built.setup.venue;
  const formatCtx = { ...formatContextOf(built), chaperone: r.setup?.chaperone, ex: r.setup?.ex };
  // Whoever ghosted under the date's own answers stays silent: the same seeded rule the date was written with.
  const silent = r.choices?.a && r.choices.b ? ghostSide({ a: r.choices.a, b: r.choices.b }, built.seed) : null;

  let model = opts.model;
  if (!model) {
    const frontier = frontierConfigured() ? getFrontierModel() : null;
    if (frontier) await claimPaidDate(db).catch(() => false);
    model = frontier ?? getModel(undefined, false);
  }
  let thread;
  try {
    thread = await simulateAfterglow(model, built.input, outcome, characters, venueId, format, undefined, formatCtx, date, undefined, silent);
  } catch (err) {
    // Content-free, like the job's log line: model error codes and which text, never a text.
    return { ok: false, reason: "texts_failed", detail: err instanceof AfterglowError ? err.reasons.slice(0, 4).join(", ").slice(0, 160) : "unknown" };
  }
  const stored = await db.query<{ id: string }>(
    `update episodes set afterglow = $2::jsonb where id = $1 and status = 'ready' and jsonb_array_length(afterglow) = 0 returning id`,
    [r.id, JSON.stringify(thread)],
  );
  if (!stored.rows.length) return { ok: true, written: 0, already: thread.length };
  return { ok: true, written: thread.length, already: 0 };
}
