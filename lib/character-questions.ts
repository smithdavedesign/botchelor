/**
 * "The character asks you the rest" (2026-11-15, with one-sentence create, lib/express-create.ts): a character made from
 * one sentence starts with a job nobody chose, interests read off its traits and a profile written from its sheet. After
 * its first date it asks its owner about them, in its companion thread, in its own voice: "Random question. What do I do
 * for work? I feel like I should know." The text carries an answer box (companion_messages.offers, the offer kind
 * `answer`); the answer is saved to the sheet through the edit route's own checks, and the character says thanks.
 *
 * It never nags:
 *  - only to an owner who opted in to that character's texts (companion_threads.muted_proactive = false, the "Hear from"
 *    tap) in a thread that isn't paused, and only once the character has been on a date;
 *  - at most one question a day (QUESTION_GAP_HOURS), never on a day the character already texted first about something
 *    else (a date, the day after, a tease), and at most MAX_QUESTIONS ever;
 *  - only about a field that is still empty or was written by the show (lib/character-question-fields.ts fieldState),
 *    never one the owner wrote, and each field once;
 *  - after UNANSWERED_STOP questions in a row with no answer it stops for good: the last one is marked `stopped`, and
 *    nothing is ever sent again. Silence is never answered with another text.
 *
 * $0: templates only, no model call. Sent from the daily job (app/api/jobs/daily, step character_questions) through
 * postFromCharacter (the notice, the PG and crisis checks, one text per tag, the notification). The pure half (the
 * fields, the words, the box) is lib/character-question-fields.ts.
 */
import { track } from "./analytics";
import { onFanCast } from "./auditions";
import { postFromCharacter } from "./companion";
import type { Db } from "./db";
import type { CharacterExtras } from "./extras";
import { loadOurIds } from "./our-traffic";
import {
  ackLines,
  characterQuestionsOn,
  isStoredQuestion,
  MAX_QUESTIONS,
  nextQuestion,
  plainAckLines,
  QUESTION_GAP_HOURS,
  QUESTION_TAG_LIKE,
  questionLines,
  questionTag,
  UNANSWERED_STOP,
  type QuestionField,
  type QuestionSheet,
  type StoredQuestion,
} from "./character-question-fields";

/** The shape of a text's tag in SQL (lib/companion-shared.ts TEXT_TAG): any text the character sent first. */
const TEXT_TAG_SQL = "^[a-z][a-z0-9_]*:[A-Za-z0-9_.:-]+$";

type Candidate = { thread_id: string; user_id: string; character_id: string; extras: CharacterExtras | null; traits: string[]; want: string };

/**
 * The threads a question may go to today (one query): the owner's own character, opted in and not paused, with a
 * finished date on the show, fewer than MAX_QUESTIONS asked, never stopped, and no text from the character in the last
 * QUESTION_GAP_HOURS (a question, a thanks or a text about a date: at most one of them a day comes from this).
 */
async function candidates(db: Db, now: Date, limit: number): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate>(
    `select t.id as thread_id, t.user_id, c.id as character_id, c.extras, c.traits, c.want
       from companion_threads t
       join characters c on c.id = t.character_id and c.owner_id = t.user_id and not c.is_house
      where t.muted_proactive = false and t.paused_at is null
        and exists (select 1 from episodes e
                     where (e.character_a = c.id or e.character_b = c.id) and e.status = 'ready'
                       and coalesce((e.setup->>'after_dark')::boolean, false) = false)
        and (select count(*) from companion_messages q where q.thread_id = t.id and q.action like $1) < $2
        and not exists (select 1 from companion_messages s where s.thread_id = t.id and s.action like $1 and s.offers->>'stopped' = 'true')
        and not exists (select 1 from companion_messages m
                         where m.thread_id = t.id and m.role = 'character' and m.action ~ $3
                           and m.created_at > $4::timestamptz - make_interval(hours => $5::int))
      order by t.last_at desc, t.id
      limit $6`,
    [QUESTION_TAG_LIKE, MAX_QUESTIONS, TEXT_TAG_SQL, now.toISOString(), QUESTION_GAP_HOURS, limit],
  );
  return rows;
}

/** A thread's questions so far, oldest first: which fields, and whether each was answered. */
async function askedIn(db: Db, threadId: string): Promise<{ id: string; field: string; answered: boolean }[]> {
  const { rows } = await db.query<{ id: string; action: string; offers: unknown }>(
    `select id, action, offers from companion_messages where thread_id = $1 and action like $2 order by created_at asc, id asc`,
    [threadId, QUESTION_TAG_LIKE],
  );
  return rows.map((r) => ({ id: r.id, field: r.action.slice("question:".length), answered: isStoredQuestion(r.offers) && Boolean(r.offers.taken) }));
}

export type QuestionsRun = { sent: number; stopped: number; candidates: number };

/**
 * The daily job's step: each opted-in owner's character asks one question, when it has one left to ask (see the rules at
 * the top). Never for our own identities (lib/our-traffic.ts loadOurIds), nor for a character on this month's cast as a
 * fan pick (its sheet is locked until the month ends, so an answer could not be saved). CHARACTER_QUESTIONS=0 sends none.
 */
export async function sendCharacterQuestions(db: Db, now = new Date(), limit = 50): Promise<QuestionsRun> {
  const run: QuestionsRun = { sent: 0, stopped: 0, candidates: 0 };
  if (!characterQuestionsOn()) return run;
  const rows = await candidates(db, now, limit);
  run.candidates = rows.length;
  if (!rows.length) return run;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  for (const r of rows) {
    if (ours.has(r.user_id)) continue;
    const asked = await askedIn(db, r.thread_id);
    // Two in a row with no answer: that was the last one, for good. Marked on it so a later answer never restarts them.
    const tail = asked.slice(-UNANSWERED_STOP);
    if (tail.length === UNANSWERED_STOP && tail.every((q) => !q.answered)) {
      await db.query(`update companion_messages set offers = offers || '{"stopped": true}'::jsonb where id = $1 and offers is not null`, [tail[tail.length - 1].id]);
      run.stopped++;
      continue;
    }
    const sheet: QuestionSheet = { extras: r.extras, traits: Array.isArray(r.traits) ? r.traits : [], want: r.want ?? "" };
    const field = nextQuestion(sheet, asked.map((q) => q.field));
    if (!field) continue;
    if (await onFanCast(db, r.character_id, now).catch(() => false)) continue;
    const offers: StoredQuestion = { kinds: ["answer"], field };
    const posted = await postFromCharacter(db, { userId: r.user_id, characterId: r.character_id, lines: questionLines(field), now, kind: "question", dedupeKey: questionTag(field), offers }).catch(() => null);
    if (!posted) continue;
    track("character_question", { field });
    run.sent++;
  }
  return run;
}

/* ------------------------------------------------- the answer ------------------------------------------------- */

export type QuestionFail = { ok: false; status: number; error: string; message: string };
export type LoadedQuestion = { ok: true; threadId: string; characterId: string; characterName: string; messageId: string; field: QuestionField; sheet: QuestionSheet };

const no = (status: number, error: string, message: string): QuestionFail => ({ ok: false, status, error, message });
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The question behind an answer box, for this person: the thread is theirs, the character is their own (only an owner
 * edits a sheet), the message is a question, and it has no answer yet.
 */
export async function loadQuestion(db: Db, args: { userId: string; threadId: string; messageId: string }): Promise<LoadedQuestion | QuestionFail> {
  const { rows } = await db.query<{ thread_id: string; character_id: string; name: string; owner_id: string | null; extras: CharacterExtras | null; traits: string[]; want: string; offers: unknown; role: string | null }>(
    `select t.id as thread_id, t.character_id, c.name, c.owner_id, c.extras, c.traits, c.want, m.offers, m.role
       from companion_threads t
       join characters c on c.id = t.character_id
       left join companion_messages m on m.id = $3 and m.thread_id = t.id
      where t.id = $1 and t.user_id = $2`,
    [args.threadId, args.userId, args.messageId],
  );
  const r = rows[0];
  if (!r) return no(404, "not_found", "Not found.");
  if (r.owner_id !== args.userId) return no(403, "not_your_character", `Only ${firstNameOf(r.name)}'s creator can answer that.`);
  if (r.role !== "character" || !isStoredQuestion(r.offers)) return no(404, "no_question", "That text has nothing to answer.");
  if (r.offers.taken) return no(409, "answered", "You already answered that one.");
  return {
    ok: true,
    threadId: r.thread_id,
    characterId: r.character_id,
    characterName: r.name,
    messageId: args.messageId,
    field: r.offers.field,
    sheet: { extras: r.extras, traits: Array.isArray(r.traits) ? r.traits : [], want: r.want ?? "" },
  };
}

/** Marks a question answered: the box goes, and the text keeps its record. */
export async function markAnswered(db: Db, messageId: string, at = new Date()): Promise<void> {
  await db.query(`update companion_messages set offers = offers || jsonb_build_object('taken', $2::jsonb) where id = $1 and offers is not null and offers->'taken' is null`, [
    messageId,
    JSON.stringify({ kind: "answer", at: at.toISOString() }),
  ]);
}

/**
 * The character's thanks once an answer is on the sheet (postFromCharacter, kind `answer`, once per question): the
 * answer said back when it is short and passes the thread's own checks, else a line without it. Whether it went in.
 */
export async function thankFor(db: Db, args: { userId: string; characterId: string; messageId: string; field: QuestionField; answer: string; now?: Date }): Promise<boolean> {
  const base = { userId: args.userId, characterId: args.characterId, now: args.now, kind: "answer", dedupeKey: `answer:${args.messageId}` };
  const quoted = await postFromCharacter(db, { ...base, lines: ackLines(args.field, args.answer) }).catch(() => null);
  if (quoted) return true;
  return (await postFromCharacter(db, { ...base, lines: plainAckLines() }).catch(() => null)) !== null;
}
