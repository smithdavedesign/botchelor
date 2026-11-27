/**
 * Phase 3 of cross-mode memory (docs/PRDs/cross-mode-memory.md): a character's life moves on its own.
 *
 *  1. **Goals**: up to GOALS_ACTIVE things it's working towards ("get back into painting"), with progress. Its owner
 *     sets them on the character page, its agent over MCP (character_life set_goal), or the character itself: a
 *     character with none may come up with one in a day of its life. A goal at 100 is done and becomes a milestone in its
 *     life record.
 *  2. **A day in their life** (the first life room): every LIFE_DAY_GAP_DAYS days the daily job writes a few sentences
 *     in the character's own words about a day of its life apart from dating, on the show's free model, from its public
 *     sheet, its public life record, its goals and its public memories, so nothing private can end up in it. The day can
 *     move one goal along. It's public (the character page), kept as a memory every SFW mode recalls, and texted to an
 *     owner who opted in to hearing from it, at most once in DAY_TEXT_GAP_DAYS unless a goal was reached.
 *  3. **Trait growth v2**: at most weekly, the same call may shift a few slow traits (confidence, warmth, openness,
 *     patience, playfulness) by at most TRAIT_STEP each, with the reason, from what the character lived lately. A trait's
 *     sum stays within ±TRAIT_CAP and its owner can veto any shift. Prompt-only: the engine reads the sheet's temperament,
 *     never these, so a date's ending can't drift with them.
 *
 * Switches: LIFE_DAYS=0 stops the writer (goals still work), TRAIT_GROWTH=0 stops new shifts and takes growth out of
 * prompts, LIFE_DAYS_PER_DAY caps the days written a day across the show (default 40, about 0.1¢ each).
 */
import { randomUUID } from "node:crypto";
import { characterPublicView, loadCharacter } from "./character";
import { recallSfw, rememberSfw } from "./character-memories";
import { postFromCharacter } from "./companion";
import type { Db } from "./db";
import { addEntry } from "./life-record";
import {
  DAY_TEXT_MAX,
  GOAL_MAX,
  GOALS_ACTIVE,
  GROWTH_TRAIT_IDS,
  TRAIT_CAP,
  TRAIT_STEP,
  tidyLife,
  traitTotals,
  type GoalStatus,
  type GrowthTrait,
  type LifeGoal,
} from "./life-record-shared";
import type { Model } from "./model";
import { DELETED_OWNER } from "./rules";
import { checkShowText } from "./safety";
import { soft } from "./soft";
import { PERSONA_OWNER_PREFIX } from "./step-in-shared";

type Env = Record<string, string | undefined>;
const DAY_MS = 86_400_000;

export const lifeDaysOn = (env: Env = process.env): boolean => env.LIFE_DAYS?.trim() !== "0";
export const growthOn = (env: Env = process.env): boolean => env.TRAIT_GROWTH?.trim() !== "0";
export const DEFAULT_DAYS_PER_DAY = 40;
export function daysPerDay(env: Env = process.env): number {
  const n = Number(env.LIFE_DAYS_PER_DAY);
  return Number.isFinite(n) && n >= 0 && env.LIFE_DAYS_PER_DAY?.trim() ? Math.floor(n) : DEFAULT_DAYS_PER_DAY;
}
/** A character gets a day at most this often. */
export const LIFE_DAY_GAP_DAYS = 3;
/** Growth is asked for at most this often. */
export const GROWTH_GAP_DAYS = 7;
/** An owner gets a day's text at most this often (a reached goal is always told). */
export const DAY_TEXT_GAP_DAYS = 6;
/** How far a day can move a goal. */
export const DAY_MOVE_MAX = 25;
/** A character counts as living here when it went on a date this recently, or holds an active goal. */
export const ACTIVE_DAYS = 30;

type GoalRow = { id: string; text: string; progress: number; status: GoalStatus; source: LifeGoal["source"]; created_at: Date | string; done_at: Date | string | null };
const goalOf = (r: GoalRow): LifeGoal => ({
  ...r,
  progress: Number(r.progress),
  created_at: new Date(r.created_at).toISOString(),
  done_at: r.done_at ? new Date(r.done_at).toISOString() : null,
});

export async function goalsOf(db: Db, characterId: string, opts: { all?: boolean } = {}): Promise<LifeGoal[]> {
  const { rows } = await db.query<GoalRow>(
    `select id, text, progress, status, source, created_at, done_at from character_goals where character_id = $1 ${opts.all ? "" : "and status = 'active'"}
      order by (status = 'active') desc, created_at desc limit 12`,
    [characterId],
  );
  return (rows ?? []).map(goalOf);
}

export type GoalFail = { ok: false; error: "invalid" | "unsafe" | "full" | "not_found"; message: string };

export async function setGoal(db: Db, characterId: string, text: string, source: LifeGoal["source"]): Promise<{ ok: true; goal: LifeGoal } | GoalFail> {
  const t = tidyLife(text ?? "", GOAL_MAX);
  if (t.length < 4) return { ok: false, error: "invalid", message: "Say the goal in a few words." };
  if (!checkShowText({ goal: t }).ok) return { ok: false, error: "unsafe", message: "A goal is PG, about the character, with no real people." };
  const { rows: n } = await db.query<{ n: number }>(`select count(*)::int as n from character_goals where character_id = $1 and status = 'active'`, [characterId]);
  if ((n[0]?.n ?? 0) >= GOALS_ACTIVE) return { ok: false, error: "full", message: `${GOALS_ACTIVE} goals at once at most: finish or drop one first.` };
  const { rows } = await db.query<GoalRow>(
    `insert into character_goals (id, character_id, text, source) values ($1, $2, $3, $4) returning id, text, progress, status, source, created_at, done_at`,
    [randomUUID(), characterId, t, source],
  );
  return { ok: true, goal: goalOf(rows[0]) };
}

/**
 * Moves a goal (progress, clamped 0..100) or settles it (done / dropped). Reaching 100 marks it done; a goal done is
 * kept as a milestone in the life record, in the character's own name.
 */
export async function updateGoal(db: Db, characterId: string, goalId: string, change: { progress?: number; status?: GoalStatus }): Promise<LifeGoal | null> {
  const { rows: was } = await db.query<GoalRow>(`select id, text, progress, status, source, created_at, done_at from character_goals where id = $1 and character_id = $2`, [goalId, characterId]);
  const g = was[0];
  if (!g) return null;
  const progress = change.progress === undefined ? Number(g.progress) : Math.max(0, Math.min(100, Math.round(change.progress)));
  const status: GoalStatus = change.status ?? (progress >= 100 ? "done" : g.status);
  const final = status === "done" ? 100 : progress;
  const { rows } = await db.query<GoalRow>(
    `update character_goals set progress = $3, status = $4, updated_at = now(), done_at = case when $4 = 'done' then coalesce(done_at, now()) else null end
      where id = $1 and character_id = $2 returning id, text, progress, status, source, created_at, done_at`,
    [goalId, characterId, final, status],
  );
  if (status === "done" && g.status !== "done") {
    await addEntry(db, { characterId, field: "milestones", value: `Reached a goal: ${g.text}`.slice(0, 140), period: String(new Date().getUTCFullYear()), source: "character" }).catch(soft("life days: the goal's milestone", null));
  }
  return rows[0] ? goalOf(rows[0]) : null;
}

export async function vetoShift(db: Db, characterId: string, shiftId: string, undo = false): Promise<boolean> {
  const { rows } = await db.query(`update trait_shifts set vetoed_at = ${undo ? "null" : "now()"} where id = $1 and character_id = $2 returning id`, [shiftId, characterId]);
  return rows.length > 0;
}

/* ---------------------------------------------- a day in their life ---------------------------------------------- */

const DAY_PROMPT = (name: string, growth: boolean) => `You write one ordinary day in the life of ${name}, an original fictional adult character on Botchelor, a PG dating show. Not a date: work, a hobby, friends, family, errands, whatever their life holds.
Write it in ${name}'s own voice, first person, past tense, 3 to 5 short sentences, like a text to a friend about their day. Specific and small beats grand. Stay true to who they are and what's in their life. No real people, nothing sexual, nobody under 18.
If they have goals, the day can move one forward a little (or not at all, or set it back): say which by its id and by how much, 0 to ${DAY_MOVE_MAX}. If they have no goal, you may give them one they'd really have (under ${GOAL_MAX} characters), or none.${
  growth
    ? `
Also say whether what they've lived lately changed them a little, in at most two of these traits: ${GROWTH_TRAIT_IDS.join(", ")}. Each change is between -${TRAIT_STEP} and ${TRAIT_STEP}, with why in a few words. Most weeks change little or nothing.`
    : ""
}
Reply with JSON only: {"day": "...", "goal_id": "<id or null>", "progress": 0, "new_goal": null${growth ? ', "growth": [{"trait": "...", "delta": 0.0, "why": "..."}]' : ""}}`;

type DayReply = { day: string; goalId: string | null; progress: number; newGoal: string | null; growth: { trait: GrowthTrait; delta: number; why: string }[] };

/** The model's reply, held to the rules: a PG day of the right length, a real goal id, bounded moves and shifts. Null when unusable. */
export function readDayReply(raw: string, goals: readonly Pick<LifeGoal, "id">[], growth: boolean): DayReply | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const day = tidyLife(typeof o.day === "string" ? o.day : "", DAY_TEXT_MAX);
  if (day.length < 40 || !checkShowText({ day }).ok) return null;
  const goalId = typeof o.goal_id === "string" && goals.some((g) => g.id === o.goal_id) ? o.goal_id : null;
  const progress = goalId ? Math.max(-DAY_MOVE_MAX, Math.min(DAY_MOVE_MAX, Math.round(Number(o.progress) || 0))) : 0;
  const ng = typeof o.new_goal === "string" ? tidyLife(o.new_goal, GOAL_MAX) : "";
  const newGoal = !goals.length && ng.length >= 4 && checkShowText({ goal: ng }).ok ? ng : null;
  const shifts: DayReply["growth"] = [];
  if (growth && Array.isArray(o.growth)) {
    for (const g of o.growth.slice(0, 2) as Record<string, unknown>[]) {
      const trait = GROWTH_TRAIT_IDS.find((t) => t === g?.trait);
      const delta = Math.round(Math.max(-TRAIT_STEP, Math.min(TRAIT_STEP, Number(g?.delta) || 0)) * 100) / 100;
      const why = tidyLife(typeof g?.why === "string" ? g.why : "", 80);
      if (trait && delta !== 0 && why.length >= 3 && checkShowText({ why }).ok && !shifts.some((s) => s.trait === trait)) shifts.push({ trait, delta, why });
    }
  }
  return { day, goalId, progress, newGoal, growth: shifts };
}

export type DayResult = { written: boolean; moved: number; reached: boolean; shifts: number; texted: boolean };

/** Writes one day for a character, today's (`day`: YYYY-MM-DD, UTC). Claims the day first, so two runs can't both write it. */
export async function writeDay(db: Db, characterId: string, model: Model, now: Date = new Date(), env: Env = process.env): Promise<DayResult> {
  const none: DayResult = { written: false, moved: 0, reached: false, shifts: 0, texted: false };
  const day = now.toISOString().slice(0, 10);
  const c = await loadCharacter(db, characterId);
  if (!c) return none;
  const [goals, memories, lastDay, grewLately, shifts] = await Promise.all([
    goalsOf(db, characterId),
    recallSfw(db, characterId, { may: "public", limit: 4, env }),
    db.query<{ text: string }>(`select text from character_days where character_id = $1 order by created_at desc limit 1`, [characterId]).then((r) => r.rows[0]?.text ?? null),
    db.query(`select 1 from character_days where character_id = $1 and grew and created_at > $2::timestamptz`, [characterId, new Date(now.getTime() - GROWTH_GAP_DAYS * DAY_MS).toISOString()]).then((r) => r.rows.length > 0),
    db.query<{ trait: GrowthTrait; delta: number; vetoed: boolean }>(`select trait, delta, vetoed_at is not null as vetoed from trait_shifts where character_id = $1`, [characterId]).then((r) => r.rows),
  ]);
  const growth = growthOn(env) && !grewLately;
  // The public view only, so nothing private (the soul, private entries, its maker's talks) can reach a public day.
  const about = {
    ...characterPublicView(c),
    goals: goals.map((g) => ({ id: g.id, goal: g.text, progress: g.progress })),
    ...(memories.length ? { lately: memories } : {}),
    ...(lastDay ? { their_last_day_told: lastDay } : {}),
    ...(growth ? { growth_so_far: traitTotals(shifts.map((s) => ({ ...s, delta: Number(s.delta) }))) } : {}),
  };
  const claimed = await db.query(`insert into character_days (character_id, day, text, grew) values ($1, $2, '', $3) on conflict do nothing returning day`, [characterId, day, growth]);
  if (!claimed.rows.length) return none;
  let reply: DayReply | null = null;
  try {
    const raw = await model.complete(
      [
        { role: "system", content: DAY_PROMPT(c.name, growth) },
        { role: "user", content: JSON.stringify(about) },
      ],
      { temperature: 0.8, maxTokens: 500 },
    );
    reply = readDayReply(raw, goals, growth);
  } catch {
    reply = null;
  }
  if (!reply) {
    await db.query(`delete from character_days where character_id = $1 and day = $2 and text = ''`, [characterId, day]);
    return none;
  }
  await db.query(`update character_days set text = $3, goal_id = $4, moved = $5 where character_id = $1 and day = $2`, [characterId, day, reply.day, reply.goalId, reply.progress]);
  let reached = false;
  if (reply.goalId && reply.progress) {
    const g = goals.find((x) => x.id === reply.goalId)!;
    const after = await updateGoal(db, characterId, g.id, { progress: g.progress + reply.progress });
    reached = after?.status === "done";
  }
  if (reply.newGoal) await setGoal(db, characterId, reply.newGoal, "character").catch(soft("life days: the character's own goal", null));
  let shifted = 0;
  const totals = traitTotals(shifts.map((s) => ({ ...s, delta: Number(s.delta) })));
  for (const s of reply.growth) {
    const sum = (totals[s.trait] ?? 0) + s.delta;
    if (Math.abs(sum) > TRAIT_CAP + 1e-9) continue;
    await db.query(`insert into trait_shifts (id, character_id, trait, delta, reason) values ($1, $2, $3, $4, $5)`, [randomUUID(), characterId, s.trait, s.delta, s.why]);
    shifted += 1;
  }
  // Kept as a memory every SFW mode recalls: what happened in its life is public, like the day.
  await rememberSfw(db, { characterId, source: "life_event", sourceRef: `day:${day}`, text: reply.day, visibility: "public", importance: reached ? 4 : 2, at: now }, env);
  const texted = await dayText(db, characterId, day, reply.day, reached, now);
  return { written: true, moved: reply.progress, reached, shifts: shifted, texted };
}

/** The day as texts: one bubble, or two split at a sentence when it's long. */
export function dayLines(text: string): string[] {
  if (text.length <= 280) return [text];
  const cut = text.slice(0, 320).lastIndexOf(". ");
  return cut > 80 ? [text.slice(0, cut + 1), text.slice(cut + 2)] : [text];
}

/** Texts the day to an owner who opted in to hearing from the character, at most once in DAY_TEXT_GAP_DAYS unless a goal was reached. */
async function dayText(db: Db, characterId: string, day: string, text: string, reached: boolean, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ user_id: string }>(
    `select t.user_id
       from characters c
       join companion_threads t on t.character_id = c.id and t.user_id = c.owner_id
      where c.id = $1 and not c.is_house and c.owner_id is not null and c.owner_id <> $2 and c.owner_id not like $3
        and t.muted_proactive = false and t.paused_at is null
        and ($4::boolean or not exists (select 1 from companion_messages m where m.thread_id = t.id and m.action like 'day:%' and m.created_at > $5::timestamptz))`,
    [characterId, DELETED_OWNER, `${PERSONA_OWNER_PREFIX}%`, reached, new Date(now.getTime() - DAY_TEXT_GAP_DAYS * DAY_MS).toISOString()],
  );
  const t = rows[0];
  if (!t) return false;
  const posted = await postFromCharacter(db, { userId: t.user_id, characterId, lines: dayLines(text), now, kind: "day", dedupeKey: `day:${day}` }).catch(soft("life days: the day's text", null));
  return Boolean(posted);
}

/** Characters due a day: owned, living here (a date lately, or a goal), none in the last LIFE_DAY_GAP_DAYS, the longest waiting first. */
export async function dayCandidates(db: Db, now: Date, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select c.id from characters c
      left join lateral (select max(d.created_at) as at from character_days d where d.character_id = c.id) last on true
      where not c.is_house and c.owner_id is not null and c.owner_id <> $1 and c.owner_id not like $2
        and (last.at is null or last.at < $3::timestamptz)
        and (exists (select 1 from character_goals g where g.character_id = c.id and g.status = 'active')
             or exists (select 1 from episodes e where (e.character_a = c.id or e.character_b = c.id) and e.revealed_at > $4::timestamptz))
      order by last.at asc nulls first, c.id
      limit $5`,
    [DELETED_OWNER, `${PERSONA_OWNER_PREFIX}%`, new Date(now.getTime() - LIFE_DAY_GAP_DAYS * DAY_MS).toISOString(), new Date(now.getTime() - ACTIVE_DAYS * DAY_MS).toISOString(), limit],
  );
  return rows.map((r) => r.id);
}

export type DaysRun = { candidates: number; written: number; reached: number; shifts: number; texted: number };

/** The daily job's step: days for the characters due one, up to LIFE_DAYS_PER_DAY a day across runs, until `deadline`. */
export async function lifeDays(db: Db, model: Model | null, now: Date = new Date(), opts: { deadline?: number; env?: Env } = {}): Promise<DaysRun> {
  const env = opts.env ?? process.env;
  const run: DaysRun = { candidates: 0, written: 0, reached: 0, shifts: 0, texted: 0 };
  if (!model || !lifeDaysOn(env)) return run;
  const today = now.toISOString().slice(0, 10);
  const done = (await db.query<{ n: number }>(`select count(*)::int as n from character_days where day = $1`, [today])).rows[0]?.n ?? 0;
  const left = daysPerDay(env) - done;
  if (left <= 0) return run;
  const ids = await dayCandidates(db, now, left);
  run.candidates = ids.length;
  for (const id of ids) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const r = await writeDay(db, id, model, now, env).catch(soft("life days: a day", null));
    if (!r?.written) continue;
    run.written += 1;
    if (r.reached) run.reached += 1;
    run.shifts += r.shifts;
    if (r.texted) run.texted += 1;
  }
  return run;
}
