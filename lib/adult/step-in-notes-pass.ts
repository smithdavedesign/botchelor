/**
 * The pass that has characters write first (lib/adult/step-in-notes.ts says when and what; this walks the scenes).
 *
 * Run once an hour on After Dark's host (app/api/jobs/step-in-notes, and from the two job routes the scheduler already
 * calls there). For each scene that could be due it asks noteDecision with what's true this minute, takes the scene's
 * claim in one statement (so two passes at once can't both write it), and has the note written
 * (lib/adult/step-in.ts writeStepInNote). A try that writes nothing keeps its claim for NOTE_CLAIM_HOURS, so a scene
 * whose note can't be written isn't tried every hour. Bounded three ways: NOTES_RUN_MAX notes a run, NOTES_RUN_MS of
 * starting new ones, and NOTES_SITE_DAY_MAX notes across the site in any 24 hours.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { eligibleIds } from "./characters";
import { canAfterDark } from "./entitlement";
import { adultAvailable } from "./mode";
import { rolloutOn } from "./rollout";
import { getAdultSettings } from "./settings";
import { writeStepInNote } from "./step-in";
import {
  awayWords,
  NOTE_CLAIM_HOURS,
  NOTE_IDLE_HOURS,
  noteDecision,
  NOTES_RUN_MAX,
  NOTES_RUN_MS,
  NOTES_SITE_DAY_MAX,
  prefsOf,
  type NoteAround,
  type NoteDecision,
  type NotePrefs,
  type NoteScene,
  type NoteWhy,
} from "./step-in-notes";
import { overCap } from "./usage";

// For the job routes that run this pass beside their own work: one import, from the pass.
export { NOTES_RIDE_ALONG } from "./step-in-notes";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Candidate = {
  id: string;
  owner_id: string;
  character_id: string;
  last_at: string | Date;
  note_at: string | Date | null;
  notes_off: boolean;
  paused_at: string | Date | null;
  ended_at: string | Date | null;
  step_in_notes: string | null;
  step_in_notes_at: string | Date | null;
  step_in_quiet_from: number | null;
  step_in_quiet_to: number | null;
  step_in_tz: string | null;
};

const CANDIDATE_COLUMNS = `s.id, s.owner_id, s.character_id, s.last_at, s.note_at, s.notes_off, s.paused_at, s.ended_at,
       p.step_in_notes, p.step_in_notes_at, p.step_in_quiet_from, p.step_in_quiet_to, p.step_in_tz`;

/** What a scene's own lines say: whether anything has been said, and how many notes stand at its end unanswered. */
async function sceneLines(db: Db, sceneId: string): Promise<Pick<NoteScene, "anything_said" | "unanswered">> {
  const { rows } = await db.query<{ role: string; kind: string | null }>(
    `select role, kind from adult_step_in_messages where scene_id = $1 and replaced_by is null and role <> 'system' order by created_at desc, id desc limit 12`,
    [sceneId],
  );
  let unanswered = 0;
  for (const m of rows) {
    if (m.role === "viewer") break;
    if (m.kind === "note") unanswered++;
  }
  return { anything_said: rows.some((m) => m.role === "character"), unanswered };
}

/** What's true of one person this minute, asked once a pass: who they may have, whether it's open to them, the month's cap, the day's notes. */
type Person = { eligible: Set<string>; open: boolean; capped: boolean; lastDay: number };
async function personNow(db: Db, owner: string, now: Date): Promise<Person> {
  const [eligible, admin, settings, available, entitled, capped, lastDay] = await Promise.all([
    eligibleIds(db, owner),
    isAdmin(db, owner).catch(() => false),
    getAdultSettings(db),
    adultAvailable(db).catch(() => false),
    canAfterDark(db, { userId: owner, authenticated: true }, now),
    overCap(db, owner, "step_in", now),
    db.query<{ n: number }>(`select count(*)::int as n from adult_step_in_messages where owner_id = $1 and kind = 'note' and created_at > $2`, [owner, new Date(now.getTime() - DAY).toISOString()]),
  ]);
  // Open to them: After Dark is on, their pass still stands, and Step in's switch is open to them (an admin, or everyone).
  return { eligible, open: available && entitled.ok && rolloutOn(settings.rollout, "companion", admin), capped: capped !== null, lastDay: lastDay.rows[0]?.n ?? 0 };
}

/** When this character last wrote to this person first, in any scene of theirs. */
async function lastFromCharacter(db: Db, owner: string, characterId: string): Promise<Date | null> {
  const at = (
    await db.query<{ at: string | Date | null }>(
      `select max(m.created_at) as at from adult_step_in_messages m join adult_step_in_scenes s on s.id = m.scene_id where m.owner_id = $1 and m.kind = 'note' and s.character_id = $2`,
      [owner, characterId],
    )
  ).rows[0]?.at;
  return at ? new Date(at) : null;
}

async function decide(db: Db, c: Candidate, prefs: NotePrefs, person: Person, now: Date, waive: { idle?: boolean } = {}): Promise<NoteDecision> {
  const lines = await sceneLines(db, c.id);
  const scene: NoteScene = { ended: Boolean(c.ended_at), paused: Boolean(c.paused_at), notes_off: c.notes_off === true, last_at: c.last_at, note_waiting: Boolean(c.note_at), ...lines };
  const around: NoteAround = {
    character_in: person.eligible.has(c.character_id),
    open: person.open,
    capped: person.capped,
    last_from_character: await lastFromCharacter(db, c.owner_id, c.character_id),
    notes_last_day: person.lastDay,
  };
  return noteDecision(prefs, scene, around, now, waive);
}

/**
 * Takes the scene's claim, in one statement: only while it's still a scene a note could be written in, its person still
 * has notes on, and nobody else holds it. False: someone else has it, or it changed under us.
 */
async function claim(db: Db, sceneId: string, now: Date): Promise<boolean> {
  const r = await db.query(
    `update adult_step_in_scenes s set notes_claimed_at = $2
      where s.id = $1 and s.ended_at is null and s.paused_at is null and not s.notes_off and s.note_at is null
        and (s.notes_claimed_at is null or s.notes_claimed_at <= $3)
        and exists (select 1 from adult_prefs p where p.user_id = s.owner_id and p.step_in_notes in ('sometimes', 'daily'))
      returning s.id`,
    [sceneId, now.toISOString(), new Date(now.getTime() - NOTE_CLAIM_HOURS * HOUR).toISOString()],
  );
  return r.rows.length > 0;
}

export type NotesRun = {
  ok: true;
  /** Scenes looked at, notes written, and tries that wrote nothing (no model, or a note that pressed twice). */
  looked: number;
  written: number;
  failed: number;
  /** Why the rest weren't written, by the decision's reason ("claimed": another pass had it). */
  skipped: Partial<Record<NoteWhy | "claimed", number>>;
  /** Why the pass ended. */
  stopped: "done" | "run_max" | "time" | "site_day_max";
};

/** How many notes the whole site has had in the last 24 hours. */
async function siteLastDay(db: Db, now: Date): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from adult_step_in_messages where kind = 'note' and created_at > $1`, [new Date(now.getTime() - DAY).toISOString()])).rows[0]?.n ?? 0;
}

/**
 * One pass: every scene that could be due (its person has notes on, it's running, nothing waits in it, it's been left
 * long enough and nobody holds its claim), the most recently left first, each decided on what's true now.
 */
export async function writeDueNotes(db: Db, now: Date = new Date(), opts: { max?: number; budgetMs?: number; clock?: () => number; siteDayMax?: number } = {}): Promise<NotesRun> {
  const max = opts.max ?? NOTES_RUN_MAX;
  const budget = opts.budgetMs ?? NOTES_RUN_MS;
  const siteMax = opts.siteDayMax ?? NOTES_SITE_DAY_MAX;
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const run: NotesRun = { ok: true, looked: 0, written: 0, failed: 0, skipped: {}, stopped: "done" };
  const skip = (why: NoteWhy | "claimed") => void (run.skipped[why] = (run.skipped[why] ?? 0) + 1);
  let site = await siteLastDay(db, now);
  if (site >= siteMax) return { ...run, stopped: "site_day_max" };
  const { rows } = await db.query<Candidate>(
    `select ${CANDIDATE_COLUMNS}
       from adult_step_in_scenes s join adult_prefs p on p.user_id = s.owner_id
      where p.step_in_notes in ('sometimes', 'daily')
        and s.ended_at is null and s.paused_at is null and not s.notes_off and s.note_at is null
        and s.last_at <= $1
        and (s.notes_claimed_at is null or s.notes_claimed_at <= $2)
      order by s.last_at desc, s.id
      limit 300`,
    [new Date(now.getTime() - NOTE_IDLE_HOURS * HOUR).toISOString(), new Date(now.getTime() - NOTE_CLAIM_HOURS * HOUR).toISOString()],
  );
  const people = new Map<string, Person>();
  for (const c of rows) {
    if (run.written >= max) return { ...run, stopped: "run_max" };
    if (site >= siteMax) return { ...run, stopped: "site_day_max" };
    if (clock() - started > budget) return { ...run, stopped: "time" };
    run.looked++;
    let person = people.get(c.owner_id);
    if (!person) people.set(c.owner_id, (person = await personNow(db, c.owner_id, now)));
    const decision = await decide(db, c, prefsOf(c), person, now);
    if (!decision.write) {
      skip(decision.why);
      continue;
    }
    if (!(await claim(db, c.id, now))) {
      skip("claimed");
      continue;
    }
    const wrote = await writeStepInNote(db, c.id, now, { away: awayWords(c.last_at, now) }).catch(() => null);
    if (wrote?.ok) {
      run.written++;
      site++;
      // The day's count for this person, so their next scene in this pass is held to their pace.
      person.lastDay++;
    } else run.failed++;
  }
  return run;
}

/**
 * An admin has one written now in a scene of their own, to see it work (the ⋯ menu): the same decision with only how
 * long the scene has been left waived, the same claim, the same note. Not found for anyone else.
 */
export async function writeNoteNow(db: Db, viewer: string, sceneId: string, now: Date = new Date()): Promise<{ ok: true; id: string } | { ok: false; status: number; why: NoteWhy | "claimed" | "not_written" | "not_found" }> {
  if (!(await isAdmin(db, viewer).catch(() => false))) return { ok: false, status: 404, why: "not_found" };
  const c = (
    await db.query<Candidate>(`select ${CANDIDATE_COLUMNS} from adult_step_in_scenes s left join adult_prefs p on p.user_id = s.owner_id where s.id = $1 and s.owner_id = $2`, [sceneId, viewer])
  ).rows[0];
  if (!c) return { ok: false, status: 404, why: "not_found" };
  const decision = await decide(db, c, prefsOf(c), await personNow(db, viewer, now), now, { idle: true });
  if (!decision.write) return { ok: false, status: 409, why: decision.why };
  if (!(await claim(db, c.id, now))) return { ok: false, status: 409, why: "claimed" };
  const wrote = await writeStepInNote(db, c.id, now, { away: awayWords(c.last_at, now) }).catch(() => null);
  if (wrote?.ok) return { ok: true, id: wrote.id };
  // Nothing was kept: the claim is let go, so trying again doesn't wait out the lease.
  await db.query(`update adult_step_in_scenes set notes_claimed_at = null where id = $1`, [c.id]);
  return { ok: false, status: 502, why: "not_written" };
}

/** Why a note wasn't written, in words (the ⋯ menu's "write now", for an admin). */
export const NOTE_WHY_WORDS: Record<NoteWhy | "claimed" | "not_written" | "not_found", string> = {
  off: "Writing first is off. Turn it on in your After Dark account first.",
  ended: "This scene has ended.",
  paused: "This scene is paused.",
  told_off: "This scene was told not to be written to first.",
  character_out: "They aren't in your After Dark any more.",
  closed: "Step in isn't open to you right now.",
  nothing_said: "Nothing has been said in this scene yet.",
  note_waiting: "A note is already waiting here.",
  unanswered: "Two notes in a row went unanswered here: the next one waits until you've written.",
  not_idle: "The scene hasn't been left long enough.",
  quiet_hours: "It's inside your quiet hours.",
  character_pace: "They wrote to you first too recently for how often you chose.",
  day_pace: "You've had your notes for today.",
  capped: "This month's replies are used up.",
  claimed: "Another try is already writing here.",
  not_written: "No note could be written just now. Try again in a moment.",
  not_found: "Not found.",
};
