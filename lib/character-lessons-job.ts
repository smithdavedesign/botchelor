/**
 * The daily job's lessons step and the one weekly text (lib/character-lessons.ts has the writer, the checks and the
 * readers; this half talks to the companion thread, so prompts can read lessons without importing it).
 */
import { track } from "./analytics";
import {
  characterLessonsOn,
  ensureCharacterLessons,
  lessonCandidates,
  lessonModels,
  LESSONS_PER_DAY,
  loadLessons,
  type LessonCandidate,
  type LessonSet,
} from "./character-lessons";
import { postFromCharacter } from "./companion";
import type { Db } from "./db";
import type { Model } from "./model";
import { loadOurIds } from "./our-traffic";
import { DELETED_OWNER } from "./rules";
import { PERSONA_OWNER_PREFIX } from "./step-in-shared";
import { soft } from "./soft";

/* ------------------------------------------------ the weekly text ------------------------------------------------ */

/** The text a character sends its owner when new lessons land (pure): what it's been thinking, and one question. */
export function lessonTextLines(l: LessonSet): string[] {
  return ["I've been thinking.", l.lines[0], l.trying_next ?? l.lines[1] ?? "Does that sound like me to you?"];
}

/**
 * One text from the character to its owner about its new lessons, when the owner opted in to hearing from it
 * (companion_threads.muted_proactive = false) and the thread isn't paused. At most one a week: the tag is the week's,
 * and a thread that got a lessons text in the last seven days gets none (two weeks' rows can be a day apart).
 * Never to a step-in persona or the deleted owner; the caller leaves our own identities out.
 */
export async function lessonText(db: Db, characterId: string, l: LessonSet & { week: string }, now: Date = new Date()): Promise<boolean> {
  if (!characterLessonsOn()) return false;
  const { rows } = await db.query<{ thread_id: string; user_id: string }>(
    `select t.id as thread_id, t.user_id
       from characters c
       join companion_threads t on t.character_id = c.id and t.user_id = c.owner_id
      where c.id = $1 and not c.is_house and c.owner_id is not null and c.owner_id <> $2 and c.owner_id not like $3
        and t.muted_proactive = false and t.paused_at is null
        and not exists (select 1 from companion_messages m where m.thread_id = t.id and m.action like 'lessons:%' and m.created_at > $4::timestamptz - interval '7 days')`,
    [characterId, DELETED_OWNER, `${PERSONA_OWNER_PREFIX}%`, now.toISOString()],
  );
  const t = rows[0];
  if (!t) return false;
  const posted = await postFromCharacter(db, { userId: t.user_id, characterId, lines: lessonTextLines(l), now, kind: "lessons", dedupeKey: `lessons:${l.week}` }).catch(soft("lessons job: post the lessons", null));
  return Boolean(posted);
}

/* ------------------------------------------------ the daily step ------------------------------------------------ */

export type LessonsRun = {
  candidates: number;
  written: number;
  by_model: number;
  by_template: number;
  /** Of `written`, the ones for our own identities' characters (admins, the house-run crowd, test names): counted apart. */
  ours: number;
  texts: number;
  /** The tokens the day's calls used (failed attempts included), whatever they cost. */
  input_tokens: number;
  output_tokens: number;
  /** What the day's calls cost in USD (null when a call ran on a model with no known price), and per character written. */
  cost_usd: number | null;
  cost_per_character_usd: number | null;
  stopped: "done" | "day_cap" | "deadline" | "off";
};

/**
 * The daily job's step: writes this week's lessons for the characters that qualify, at most LESSONS_PER_DAY a day
 * (counted from the rows written today, so a second run the same day doesn't start over), stopping at `deadline`.
 * People's characters first, then the house cast, then our own identities' (the crowd, test characters): theirs are
 * written when there's room, on the free model or the template only (never the paid fallback), counted apart, and
 * never texted. Then each owner who opted in gets the one weekly text.
 */
export async function runCharacterLessons(
  db: Db,
  now: Date = new Date(),
  /** `models`: the free model first, then any paid fallback (lessonModels by default). */
  opts: { models?: readonly Model[]; limit?: number; deadline?: number; gapMs?: number } = {},
): Promise<LessonsRun> {
  const run: LessonsRun = { candidates: 0, written: 0, by_model: 0, by_template: 0, ours: 0, texts: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_per_character_usd: null, stopped: "done" };
  if (!characterLessonsOn()) return { ...run, cost_usd: null, stopped: "off" };
  const day = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  const today = (await db.query<{ n: number }>(`select count(*)::int as n from character_lessons where created_at >= $1::timestamptz and created_at <= $2::timestamptz`, [day, now.toISOString()])).rows[0]?.n ?? 0;
  const room = Math.max(0, (opts.limit ?? LESSONS_PER_DAY) - Number(today));
  const candidates = await lessonCandidates(db, now);
  run.candidates = candidates.length;
  if (!candidates.length) return { ...run, cost_usd: null };
  if (!room) return { ...run, cost_usd: null, stopped: "day_cap" };
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  const isOurs = (c: LessonCandidate) => c.owner_id !== null && ours.has(c.owner_id);
  // People first, the cast next, ours last: the day's cap is spent on real characters before test ones.
  const rank = (c: LessonCandidate) => (isOurs(c) ? 2 : c.is_house ? 1 : 0);
  const queue = [...candidates].sort((x, y) => rank(x) - rank(y) || y.fresh - x.fresh).slice(0, room);
  if (queue.length < candidates.length) run.stopped = "day_cap";
  const models = opts.models ?? lessonModels();
  // Our own identities' characters (the house-run crowd, test characters) never spend: the free model, then the template.
  const freeOnly = models.slice(0, 1);
  let priced = true;
  for (const [i, c] of queue.entries()) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
      run.stopped = "deadline";
      break;
    }
    if (i > 0 && opts.gapMs) await new Promise((ok) => setTimeout(ok, opts.gapMs));
    const r = await ensureCharacterLessons(db, c.id, now, { models: isOurs(c) ? freeOnly : models }).catch(soft("lessons job: write the lessons", null));
    if (!r || "skipped" in r) continue;
    run.written++;
    if (r.source === "model") run.by_model++;
    else run.by_template++;
    run.input_tokens += r.cost.input_tokens;
    run.output_tokens += r.cost.output_tokens;
    if (r.cost.cost_usd === null && r.cost.input_tokens > 0) priced = false;
    else run.cost_usd = (run.cost_usd ?? 0) + (r.cost.cost_usd ?? 0);
    if (isOurs(c)) {
      run.ours++;
      continue;
    }
    if (c.is_house || c.owner_id === null) continue;
    const l = await loadLessons(db, c.id).catch(soft("lessons job: load the lessons", null));
    if (l && l.week === r.week && (await lessonText(db, c.id, l, now).catch(soft("lessons job: text the owner", false)))) run.texts++;
  }
  run.cost_usd = priced ? Math.round((run.cost_usd ?? 0) * 1e6) / 1e6 : null;
  run.cost_per_character_usd = run.cost_usd !== null && run.written ? Math.round((run.cost_usd / run.written) * 1e6) / 1e6 : null;
  // Counts only, ours apart, never the words.
  track("character_lessons", {
    written: run.written - run.ours,
    ours: run.ours,
    by_model: run.by_model,
    by_template: run.by_template,
    texts: run.texts,
    candidates: run.candidates,
    cost_usd: run.cost_usd,
    stopped: run.stopped,
  });
  return run;
}
