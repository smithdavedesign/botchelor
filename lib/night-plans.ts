/**
 * The date plan, written at night (the drama wave, 2026-11-15, part 4; docs/date-quality.md "Round: the plan at night").
 *
 * What was wrong (lib/fast-date.ts has the measurements): the director's plan call that should give every date a beat
 * sheet (lib/beats.ts planDate) was cut off at the 25-second call limit, twice, on about 97% of dates since
 * mid-October. Those dates then played from the rules plan after 50 seconds of dead wait. Speed dates skip the call
 * (FAST_FIRST_LINE); every other format still waited for it. So no date had a story plan, and the classic wasted 50 s.
 *
 * What happens now, with DATE_PLAN_AT_NIGHT on (the default):
 *
 *  - AT DATE TIME no format calls the director in front of line 1. The date reads the plan stored for it when there is
 *    one, and otherwise plays from the rules plan at once (lib/pipeline.ts `plan`; lib/jobs.ts, lib/watch.ts and
 *    lib/backfill.ts pass it). generated_with.plan says which: "producer" | "rules".
 *  - AT NIGHT (the hourly lobby job's producer pass, after its response: nobody is waiting) the producer writes the beat
 *    sheet for each date the house itself will make the next day: the date the day's vote is staging, and the lobby's
 *    room (on a Botchelor season both are the lead with the suitor whose turn it is). It can, because a house date's
 *    whole setup is dealt from its episode id: the producer reserves the id, builds the date exactly as
 *    lib/watch.ts will, lets the engine decide it, and asks the show's cheap model (no extended thinking, a small
 *    output, a generous timeout) for the three acts from the engine's reasons plus the story state: what each has
 *    heard about the other, what each wants this week, the day's beat (lib/producer.ts).
 *  - The plan is stored with the reserved id and a FIT KEY: the pair in order, the place, the situation and the
 *    engine's decision, hashed. When the house makes that date it takes the reserved id, builds and decides the date as
 *    it always has, and uses the stored plan only if the key still matches. A date that turned out differently (a
 *    memory that moved overnight, a dare added to the night, another pair) plays from the rules plan. So the plan can
 *    shape how the conversation moves, never the ending: the engine decides every date at date time exactly as before,
 *    and a plan written for another decision is thrown away, which is planDate's contract ("the engine has already
 *    decided").
 *  - Dates somebody books (an owner's, an agent's, a rose date, a mixer's) get their id when they are booked, so they
 *    have no stored plan and play from the rules plan at once.
 *
 * Privacy holds as in lib/beats.ts: the director is trusted and sees both characters; each actor gets the public scene
 * and its own beat; parsePlan's deterministic check drops a beat that carries the other side's private words, and here
 * also the other side's want for the week. What a character heard is a public claim; that it heard it stays in its own
 * beat (the prompt says so, and a scene that names the claim falls back to the rules scene).
 *
 * Switches: DATE_PLAN_AT_NIGHT=0 restores the old order exactly (the director is asked in front of line 1 wherever it
 * was, and no stored plan is read). PRODUCER_PLANS=0 stops the night's writing only (every date then plays from the
 * rules plan at once). PRODUCER=0 stops it too.
 *
 * Cost: one call per plan, about 3,500 tokens in and 700 out, at most NIGHT_PLANS_MAX a night: $0 on the free tier,
 * about 0.06 cents a plan at paid flash-lite rates (under 0.2 cents a night).
 */
import { createHash, randomUUID } from "node:crypto";
import { track } from "./analytics";
import { buildDirectorMessages, parsePlan, PLAN_TEMPERATURE, type DatePlan } from "./beats";
import type { Character } from "./character";
import type { Db } from "./db";
import type { Outcome } from "./engine";
import { DEFAULT_FORMAT, formatContextOf } from "./formats";
import { getModel, type Model, type Usage } from "./model";
import { shortName } from "./names";
import { summarizeUsage } from "./pricing";
import { beatFor, dayOf, producedDay, producerOn, type Beat } from "./producer";
import type { BuiltDate } from "./simulation";
import { bringable, TRUST_LABELS } from "./story-state";

type Env = Record<string, string | undefined>;

/* ------------------------------------------------ the switches ------------------------------------------------ */

// The shared test harness turns it off (suites written before it script the director's plan as a date's first call).
let override: boolean | null = null;
export function setDatePlanAtNightForTests(on: boolean | null): void {
  override = on;
}

/** DATE_PLAN_AT_NIGHT: on unless it is "0". Off: the old order, the director in front of line 1, no stored plan read. */
export const datePlanAtNightOn = (env: Env = process.env): boolean => override ?? env.DATE_PLAN_AT_NIGHT?.trim() !== "0";

/** Whether the night's pass writes plans: DATE_PLAN_AT_NIGHT and PRODUCER on, and PRODUCER_PLANS not "0". */
export const nightPlansOn = (env: Env = process.env): boolean => datePlanAtNightOn(env) && producerOn(env) && env.PRODUCER_PLANS?.trim() !== "0";

/** How many plans one night writes at most (the voted date and the lobby's room; a third leaves room for a retry day). */
export const NIGHT_PLANS_MAX = 3;
/** One plan call's limit: generous, because nobody is waiting (a date's own calls stop at 25 s). */
export const NIGHT_PLAN_TIMEOUT_MS = 90_000;
/** The plan is three acts of three short fields: this is room for all of it and no more. */
export const NIGHT_PLAN_MAX_TOKENS = 1_800;

/* ------------------------------------------------ the fit key ------------------------------------------------ */

/**
 * What a date must be for a stored plan to fit it: the two in order, where and in what situation, and what the engine
 * decided and why. A hash, so the row never holds an unaired ending in the clear.
 */
export function fitKey(built: BuiltDate, decided: Outcome): string {
  const s = built.setup as unknown as Record<string, unknown>;
  const parts = [
    built.characters[0].id,
    built.characters[1].id,
    s.venue ?? null,
    s.producer ?? null,
    s.format ?? null,
    (s.roleplay as { id?: string } | undefined)?.id ?? null,
    built.input.a.agendaId,
    built.input.b.agendaId,
    built.input.a.note ?? null,
    built.input.b.note ?? null,
    built.input.date_number ?? 1,
    decided.ending,
    decided.drama_question,
    decided.drama_answer,
    decided.sides.map((x) => [x.wants_another, x.agenda_met, x.dealbreaker_hit, x.want_met, x.note_followed]),
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/* ------------------------------------------------ at date time ------------------------------------------------ */

export type ClaimedPlan = { id: string; episode_id: string; fit_key: string; plan: DatePlan; slot: string };

/**
 * The plan stored for a house date of these two (in this order) today, claimed so no second date takes it. Null when
 * there is none, or the switch is off. The caller builds the date under `episode_id` and checks the key (planIfFits).
 */
export async function claimNightPlan(db: Db, aId: string, bId: string, now: Date = new Date(), env: Env = process.env): Promise<ClaimedPlan | null> {
  if (!datePlanAtNightOn(env)) return null;
  const { rows } = await db.query<ClaimedPlan>(
    `update date_plans set used_at = now()
      where id = (select id from date_plans where a_id = $1 and b_id = $2 and day = $3 and used_at is null and plan is not null order by created_at limit 1)
        and used_at is null
      returning id, episode_id, fit_key, plan, slot`,
    [aId, bId, dayOf(now)],
  );
  return rows[0] ?? null;
}

/** The claimed plan when the date turned out to be the one it was written for; otherwise null (the rules plan plays). */
export async function planIfFits(db: Db, claimed: ClaimedPlan | null, built: BuiltDate, decided: Outcome): Promise<DatePlan | null> {
  if (!claimed) return null;
  const fit = claimed.fit_key === fitKey(built, decided) && claimed.plan?.acts?.length === 3;
  await db.query(`update date_plans set fit = $2 where id = $1`, [claimed.id, fit]).catch(() => {});
  track("night_plan_read", { slot: claimed.slot, fit });
  return fit ? { ...claimed.plan, source: "producer" } : null;
}

/* ------------------------------------------------ at night ------------------------------------------------ */

const NIGHT_SYSTEM = `

Tonight's plan is written the night before, with the house's story ("story") to work from:
- "going_around" is public: what the cast has been talking about. When it concerns these two, let it come up in act two as something one of them raises, and let the other answer as themselves.
- Each character's "has_heard" (what they heard about the other, and from whom), "trust" and "wants_this_week" are PRIVATE to that character. Use them only in that character's own intention ("You bring up what you heard about…"). Never put them in a scene or in the other character's intention, and never tell a character what the other one heard or wants.
- A character decides for themselves whether what they heard is true: never say that it is or isn't.
- None of it changes the ending: the facts stand, and the story is what the conversation is about on the way there.`;

/** What one side carries into the plan, from its own story state (lib/story-state.ts): claims and labels, never its private take. */
function storyOf(c: Character): Record<string, unknown> | null {
  const s = c.story;
  if (!s) return null;
  const out: Record<string, unknown> = {};
  const heard = bringable(s).map((h) => `${h.told_by_name ? `${shortName(h.told_by_name)} told them` : "They watched it air"}: ${h.claim}`);
  if (heard.length) out.has_heard = heard;
  const o = s.opinions[0];
  if (o) out.trust = TRUST_LABELS[o.trust];
  if (s.want) out.wants_this_week = s.want.want;
  return Object.keys(out).length ? out : null;
}

/** The night director's messages: lib/beats.ts's, with the story block and the rules for using it. */
export function nightPlanMessages(built: BuiltDate, decided: Outcome, beat: Beat | null): ReturnType<typeof buildDirectorMessages> {
  const [a, b] = built.characters;
  const about = beat && (beat.who.includes(a.id) || beat.who.includes(b.id)) ? beat.previously.replace(/^Previously: /, "") : null;
  const story = { ...(about ? { going_around: about } : {}), character_a: storyOf(a) ?? {}, character_b: storyOf(b) ?? {} };
  return buildDirectorMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, built.setup.format ?? DEFAULT_FORMAT, formatContextOf(built), { system: NIGHT_SYSTEM, data: { story } });
}

export type NightPlanWritten = { slot: string; a: string; b: string; ok: boolean; ms: number; cost_usd: number | null };
export type NightPlansRun = { day: string; skipped: "off" | "nothing_due" } | { day: string; written: NightPlanWritten[] };

/** One plan from the model, parsed and checked like the director's, with each side's want kept out of the other's beats. */
export async function writeNightPlan(model: Model, built: BuiltDate, decided: Outcome, beat: Beat | null, onUsage?: (u: Usage) => void, onModel?: (id: string) => void): Promise<DatePlan | null> {
  const messages = nightPlanMessages(built, decided, beat);
  const guard: [string[], string[]] = [built.characters[0].story?.want ? [built.characters[0].story.want.want] : [], built.characters[1].story?.want ? [built.characters[1].story.want.want] : []];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await model.complete(messages, { temperature: PLAN_TEMPERATURE, maxTokens: NIGHT_PLAN_MAX_TOKENS, onUsage, onModel });
      const plan = parsePlan(raw, built.input, decided, built.characters, built.setup.producer, built.setup.venue, { source: "producer", guard });
      if (plan) return plan;
    } catch {
      /* one more try, then this date plays from the rules plan */
    }
  }
  return null;
}

/**
 * The night's plans: for each date the house will make on the produced day (lib/producer.ts producedDay) that has no
 * row yet, reserve its id, build and decide it as the house will, write its plan, store it. Idempotent per day and slot
 * (the row is claimed before the model is asked). Never throws.
 */
export async function writeNightPlans(db: Db, now: Date = new Date(), opts: { model?: Model; env?: Env; budgetMs?: number } = {}): Promise<NightPlansRun> {
  const day = producedDay(now);
  if (!nightPlansOn(opts.env)) return { day, skipped: "off" };
  const started = Date.now();
  // The slots already claimed for the day: most passes stop here, on one small query.
  const have = new Set((await db.query<{ slot: string }>(`select slot from date_plans where day = $1`, [day])).rows.map((r) => r.slot));
  if (have.has("situation") && have.has("lobby")) return { day, skipped: "nothing_due" };
  // Loaded here, not at the top: lib/watch.ts reads this module at date time.
  const [{ buildTemplateDate, lobbyDeal, templateRoomsOn }, { situationDeal }] = await Promise.all([import("./watch"), import("./situations")]);
  const due: { slot: "situation" | "lobby"; a: string; b: string; opts: Parameters<typeof buildTemplateDate>[4]; beatDay: string }[] = [];
  // The date the vote is staging is made on the first pass of the produced day, from the vote of the day before.
  const voteDay = dayOf(new Date(Date.parse(`${day}T00:00:00Z`) - 24 * 60 * 60 * 1000));
  const made = await db.query(`select 1 from situation_nights where day = $1`, [voteDay]);
  const deal = made.rows.length ? null : await situationDeal(db, voteDay).catch(() => null);
  if (deal?.ok && !have.has("situation")) due.push({ slot: "situation", a: deal.first, b: deal.second, opts: deal.opts, beatDay: voteDay });
  // The lobby's room for the day: the round it will be dealt as is how many of the day's rooms come before it.
  const rooms = await templateRoomsOn(db, day);
  const lobby = have.has("lobby") ? null : await lobbyDeal(db, new Date(`${day}T12:00:00Z`), 2 * (rooms + (deal?.ok ? 1 : 0))).catch(() => null);
  if (lobby) due.push({ slot: "lobby", a: lobby.a, b: lobby.b, opts: lobby.thumbs, beatDay: day });
  if (!due.length) return { day, skipped: "nothing_due" };
  const model = opts.model ?? getModel("minimal", false, NIGHT_PLAN_TIMEOUT_MS);
  const written: NightPlanWritten[] = [];
  for (const d of due.slice(0, NIGHT_PLANS_MAX)) {
    if (opts.budgetMs !== undefined && Date.now() - started > opts.budgetMs) break;
    try {
      const id = randomUUID();
      const episodeId = randomUUID();
      const built = await buildTemplateDate(db, episodeId, d.a, d.b, d.opts);
      if (!built) continue;
      const key = fitKey(built.built, built.decided);
      const claimed = await db.query(
        `insert into date_plans (id, day, slot, a_id, b_id, episode_id, fit_key) values ($1, $2, $3, $4, $5, $6, $7) on conflict (day, slot) do nothing returning id`,
        [id, day, d.slot, d.a, d.b, episodeId, key],
      );
      if (!claimed.rows.length) continue; // another pass has this one
      const usage: Usage[] = [];
      const served = new Set<string>();
      const t0 = Date.now();
      const beat = await beatFor(db, d.beatDay, opts.env).catch(() => null);
      const plan = await writeNightPlan(model, built.built, built.decided, beat, (u) => usage.push(u), (m) => served.add(m));
      const ms = Date.now() - t0;
      const sum = summarizeUsage(usage, usage.length);
      await db.query(`update date_plans set plan = $2::jsonb, model = $3, ms = $4, usage = $5::jsonb where id = $1`, [id, plan ? JSON.stringify(plan) : null, [...served].join(",") || null, ms, JSON.stringify(sum)]);
      written.push({ slot: d.slot, a: d.a, b: d.b, ok: Boolean(plan), ms, cost_usd: sum.cost_usd });
    } catch (err) {
      console.warn("[night-plans] a plan wasn't written:", err instanceof Error ? err.message : err);
    }
  }
  track("night_plans_written", { day, plans: written.length, ok: written.filter((w) => w.ok).length, ms: Date.now() - started });
  return { day, written };
}

export type NightPlanView = { day: string; slot: string; a: string; b: string; written: boolean; model: string | null; ms: number | null; cost_usd: number | null; used: boolean; fit: boolean | null };

/** The last few nights' plans for the owner's view: who for, whether one was written and whether the date used it. Never the plan's words (they'd give an unaired ending away). */
export async function nightPlansView(db: Db, limit = 10): Promise<NightPlanView[]> {
  const { rows } = await db.query<{ day: string; slot: string; a: string; b: string; written: boolean; model: string | null; ms: number | null; usage: { cost_usd?: number | null } | null; used: boolean; fit: boolean | null }>(
    `select p.day, p.slot, ca.name as a, cb.name as b, (p.plan is not null) as written, p.model, p.ms, p.usage, (p.used_at is not null) as used, p.fit
       from date_plans p join characters ca on ca.id = p.a_id join characters cb on cb.id = p.b_id
      order by p.day desc, p.slot limit $1`,
    [limit],
  );
  return rows.map((r) => ({ day: r.day, slot: r.slot, a: shortName(r.a), b: shortName(r.b), written: r.written, model: r.model, ms: r.ms, cost_usd: r.usage?.cost_usd ?? null, used: r.used, fit: r.fit }));
}
