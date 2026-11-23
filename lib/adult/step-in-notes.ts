/**
 * The character writes first, in Step in. David, 2026-11-23: "Messages sent first, with quiet hours (Kindroid, Nomi).
 * This is the biggest, and the one most tied to people coming back."
 *
 * What the field does (docs/audits/2026-11-23-scenes-and-side-pictures.md, row 9): Kindroid's proactive messages are
 * opt-in and stop after three go unanswered; Nomi has four frequencies. What people complain about in this corner of
 * the field is the opposite of a feature: characters that guilt a person for leaving, or plead with them to stay.
 *
 * So, a person who has a scene running with a character and has been away a while comes back to find the character
 * wrote first: one short note, in the scene, in their own voice, with something easy to answer.
 *  - **Off until the person turns it on** (adult_prefs.step_in_notes), with how often ("sometimes" or "daily"), their
 *    quiet hours, and the time zone their browser gave, which is what the quiet hours are judged in. Off stops
 *    everything at once and deletes nothing that was written. One scene can be told not to (notes_off).
 *  - **When** (noteDecision): only a scene that is running, whose character is still in their After Dark, where Step
 *    in and After Dark are still open to them, with something already said in it, idle NOTE_IDLE_HOURS or more, with
 *    no note waiting that they haven't seen, outside their quiet hours, inside their pace (PACES), with the month's
 *    replies not used up, and not after NOTES_UNANSWERED notes in a row that they never wrote back to.
 *  - **What** (lib/adult/step-in.ts writeStepInNote, lib/adult/step-in-prompt.ts noteCue): one reply through the same
 *    draw and the same checks as any reply, asked for with its own cue; then held to notePressure, a list of the ways a
 *    note can guilt or press someone. A draft that trips it is drawn once more; if that one does too, nothing is
 *    written and nothing is counted. A note is one of the month's replies.
 *  - **Where it shows**: After Dark's own pages only (the scene, Step in's front page, a character's card, the hub's
 *    tile, a dot on the header's door). Nothing leaves the site: no email, no push. The show never reads any of it.
 *
 * This module is the person's choice, the decision, the guard and what the pages ask; the pass that walks the scenes
 * is lib/adult/step-in-notes-pass.ts. It never imports lib/adult/step-in.ts (which imports this).
 */
import type { Db } from "../db";

/** How often, when it's on. */
export const NOTE_PACES = ["sometimes", "daily"] as const;
export type NotePace = (typeof NOTE_PACES)[number];
/**
 * What each pace allows: at most one note from any one character in `characterHours`, and `perDay` notes in all in any
 * 24 hours.
 */
export const PACES: Record<NotePace, { characterHours: number; perDay: number; label: string; says: string }> = {
  sometimes: { characterHours: 72, perDay: 1, label: "Sometimes", says: "At most one note every three days from any one of them, and one a day in all." },
  daily: { characterHours: 24, perDay: 2, label: "Daily", says: "At most one note a day from any one of them, and two a day in all." },
};

/** A scene is written to only once it has been left this long. */
export const NOTE_IDLE_HOURS = 8;
/** After this many notes in a row with no line from the person between them, a scene gets no more until they write. */
export const NOTES_UNANSWERED = 2;
/** The quiet hours a person starts with: 22:00 to 08:00 in their own clock. */
export const QUIET_DEFAULT = { from: 22, to: 8 } as const;
/** One pass writes at most this many notes, stops starting new ones after this long, and the whole site this many a day. */
export const NOTES_RUN_MAX = 25;
export const NOTES_RUN_MS = 150_000;
export const NOTES_SITE_DAY_MAX = 300;
/**
 * A pass that rides along on another job's route (the hourly showcase check, After Dark's daily job) shares that
 * route's five minutes with the work it's there for: fewer notes, and a shorter time to start them in.
 */
export const NOTES_RIDE_ALONG = { max: 10, budgetMs: 60_000 } as const;
/** How long a pass's claim on a scene lasts: a try that wrote nothing keeps the scene from being tried again for this long. */
export const NOTE_CLAIM_HOURS = 6;

/** What the person agrees to when they turn it on: said beside the switch, and kept with the download. */
export const NOTES_ABOUT =
  "When this is on, someone you have a scene running with can write to you first while you're away: one short note, waiting in the scene. To keep to your quiet hours, Botchelor stores your time zone, the hours you picked and how often. A note counts as one of the month's replies. Nothing is emailed or sent to your phone, and turning it off stops it at once.";

export type NotePrefs = {
  /** Null: off. */
  pace: NotePace | null;
  /** Their quiet hours, two whole hours (0 to 23) in their own clock; the same hour twice means none. */
  quiet_from: number;
  quiet_to: number;
  /** The IANA zone the quiet hours are judged in. */
  time_zone: string;
  /** When they turned it on; null while it's off. */
  turned_on_at: string | null;
};

export const NOTES_OFF: NotePrefs = { pace: null, quiet_from: QUIET_DEFAULT.from, quiet_to: QUIET_DEFAULT.to, time_zone: "UTC", turned_on_at: null };

/* ------------------------------------------------ the clock ------------------------------------------------ */

/**
 * A time zone the runtime knows, as it was given (an alias like "UTC" or "US/Pacific" included, and "Asia/Kolkata" kept
 * as that, not as the older name the runtime files it under), else "UTC".
 */
export function timeZoneOf(raw: unknown): string {
  if (typeof raw !== "string") return "UTC";
  const zone = raw.trim();
  if (!zone || zone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(zone)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** The hour of the day (0 to 23) it is in a zone at a moment. */
export function localHour(now: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: timeZoneOf(timeZone), hour: "numeric", hourCycle: "h23" }).formatToParts(now).find((p) => p.type === "hour");
  const hour = Number(part?.value);
  return Number.isInteger(hour) ? hour % 24 : now.getUTCHours();
}

const hourOf = (raw: unknown, fallback: number): number => {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
};

/**
 * Whether a moment is inside someone's quiet hours, by the whole hour in their own zone. From 22 to 8 is 22:00 up to
 * 07:59 (it wraps midnight); from 13 to 15 is 13:00 up to 14:59; the same hour twice is no quiet hours at all.
 */
export function inQuietHours(now: Date, prefs: Pick<NotePrefs, "quiet_from" | "quiet_to" | "time_zone">): boolean {
  const { quiet_from: from, quiet_to: to } = prefs;
  if (from === to) return false;
  const h = localHour(now, prefs.time_zone);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** How long they've been away, in the words the note's cue uses. */
export function awayWords(lastAt: Date | string, now: Date): string {
  const hours = (now.getTime() - new Date(lastAt).getTime()) / 3_600_000;
  return hours < 20 ? "a few hours" : hours < 44 ? "since yesterday" : "a few days";
}

/* ------------------------------------------------ the decision ------------------------------------------------ */

export type NoteScene = {
  ended: boolean;
  paused: boolean;
  /** This scene was told not to. */
  notes_off: boolean;
  /** When anything was last written in it. */
  last_at: Date | string;
  /** A note is waiting that they haven't seen. */
  note_waiting: boolean;
  /** Whether anything has been said in it yet (a scene made in one click and never opened has nothing). */
  anything_said: boolean;
  /** How many notes stand at its end with no line of the person's after them. */
  unanswered: number;
};

export type NoteAround = {
  /** Their character is still one they may have in After Dark. */
  character_in: boolean;
  /** Step in and After Dark are both still open to them. */
  open: boolean;
  /** The month's replies are used up. */
  capped: boolean;
  /** When this character last wrote to them first, in any scene. */
  last_from_character: Date | string | null;
  /** How many notes they've had in all in the last 24 hours. */
  notes_last_day: number;
};

export type NoteWhy = "off" | "ended" | "paused" | "told_off" | "character_out" | "closed" | "nothing_said" | "note_waiting" | "unanswered" | "not_idle" | "quiet_hours" | "character_pace" | "day_pace" | "capped";
export type NoteDecision = { write: true } | { write: false; why: NoteWhy };

/**
 * Whether a scene gets a note now. Pure: everything it needs is passed in. `waive.idle`: an admin trying it on their
 * own scene (the ⋯ menu's "write now"), where only how long the scene has been left is waived; every other rule holds.
 */
export function noteDecision(prefs: NotePrefs, scene: NoteScene, around: NoteAround, now: Date, waive: { idle?: boolean } = {}): NoteDecision {
  const no = (why: NoteWhy): NoteDecision => ({ write: false, why });
  if (!prefs.pace) return no("off");
  if (scene.ended) return no("ended");
  if (scene.paused) return no("paused");
  if (scene.notes_off) return no("told_off");
  if (!around.character_in) return no("character_out");
  if (!around.open) return no("closed");
  if (!scene.anything_said) return no("nothing_said");
  if (scene.note_waiting) return no("note_waiting");
  if (scene.unanswered >= NOTES_UNANSWERED) return no("unanswered");
  if (!waive.idle && now.getTime() - new Date(scene.last_at).getTime() < NOTE_IDLE_HOURS * 3_600_000) return no("not_idle");
  if (inQuietHours(now, prefs)) return no("quiet_hours");
  const pace = PACES[prefs.pace];
  if (around.last_from_character && now.getTime() - new Date(around.last_from_character).getTime() < pace.characterHours * 3_600_000) return no("character_pace");
  if (around.notes_last_day >= pace.perDay) return no("day_pace");
  if (around.capped) return no("capped");
  return { write: true };
}

/* ------------------------------------------------ the guard ------------------------------------------------ */

/** Whoever is writing: "I" in what they say, "she", "he" or "they" in the narration around it. */
const I = "(?:i|we|she|he|they)";
const HAS = "(?:['’]ve|['’]d| have| had)";
const ME = "(?:me|her|him|them)";
const pressure = (source: string) => new RegExp(source, "i");
/**
 * The ways a note can make someone feel bad for being away, or press them to come back. A note that does any of these
 * isn't kept (lib/adult/step-in.ts draws it once more, then writes nothing). Deliberately short and literal: it reads
 * what the character says ("I've been waiting") and the narration around it ("She had been waiting"), and it would
 * rather lose a harmless note than keep one of these.
 */
export const NOTE_PRESSURE: readonly { id: string; pattern: RegExp }[] = [
  // Asking where they went, or why.
  { id: "where_were_you", pattern: pressure(`\\bwhere (?:have you been|did you (?:go|disappear|vanish|run off)|were you|you${HAS} been|you (?:went|disappeared))\\b|\\bwhere['’]?ve you been\\b`) },
  {
    id: "why_did_you_leave",
    pattern: pressure(
      `\\bwhy (?:did|would) you (?:leave|go away|stop|disappear|vanish|stay away|ignore)\\b|\\bwhy (?:haven['’]?t|hadn['’]?t|didn['’]?t|don['’]?t|won['’]?t) you (?:come|write|written|answer(?:ed)?|repl(?:y|ied)|call(?:ed)?|say|said)\\b|\\bwhy you(?:['’]d| had)? (?:left|gone|stopped)\\b`,
    ),
  },
  // Saying they were waited for, or counting the time.
  { id: "been_waiting", pattern: pressure(`\\b${I}${HAS}? been waiting\\b|\\b${I} waited (?:for you|up|all)\\b|\\bstill waiting\\b|\\bwaiting (?:for you|on you|up for you)\\b|\\bkept (?:${ME} )?waiting\\b`) },
  {
    id: "how_long",
    pattern: pressure(`\\bit(?:['’]s| has| had) been (?:so long|too long|ages|forever|days|hours)\\b|\\bhow long (?:it['’]?s been|you['’]?ve been gone|has it been)\\b|\\b(?:so|too) long (?:since|without) (?:you|we)\\b|\\bfinally (?:back|decided to)\\b|\\bit['’]?s about time\\b`),
  },
  // Asking them not to go, or to come back.
  {
    id: "dont_leave",
    pattern: pressure(`\\bdon['’]?t (?:you (?:dare )?)?(?:leave|go|disappear|vanish|run off)(?: away)? (?:me|again|like that|on me)\\b|\\bnever leave me\\b|\\bplease (?:come back|don['’]?t go|don['’]?t leave|stay with me)\\b|\\bcome back to me\\b`),
  },
  {
    id: "need_you",
    pattern: pressure(
      `\\bwithout you,? ${I}\\b|\\b${I} (?:can['’]?t|cannot|couldn['’]?t) (?:go on|cope|do this|live|function)\\b|\\b(?:i['’]?m|i am|she was|he was|they were|she['’]?s|he['’]?s) (?:nothing|lost|empty|so lonely|all alone) without you\\b|\\b${I} need(?:s|ed)? you (?:back|here|to come)\\b|\\b(?:can['’]?t|couldn['’]?t) (?:sleep|eat|breathe) without you\\b`,
    ),
  },
  // Putting the blame on them, or on themselves.
  {
    id: "did_i_do_wrong",
    pattern: pressure(`\\b(?:did|had) ${I} (?:do|done|say|said) something(?: wrong)?\\b|\\bwas it something ${I} (?:said|did)\\b|\\bare you (?:mad|angry|upset|done) (?:at|with) ${ME}\\b|\\bwhat did i do\\b|\\bwhat ${I}${HAS} done wrong\\b`),
  },
  {
    id: "forgot_me",
    pattern: pressure(
      `\\b(?:did|have|had) you forg(?:e|o)t(?:ten)?(?: about)? ${ME}\\b|\\byou${HAS}? forgot(?:ten)? (?:about )?${ME}\\b|\\bforgotten (?:about )?${ME}\\b|\\babandoned ${ME}\\b|\\bleft ${ME} (?:here|alone|waiting|hanging|behind)\\b|\\bignor(?:e|ing|ed) ${ME}\\b`,
    ),
  },
  {
    id: "hurt",
    pattern: pressure(
      `\\bit hurts? (?:that|when) you\\b|\\byou hurt ${ME}\\b|\\b(?:i['’]?m|i am|she was|he was|they were) hurt\\b|\\bbroke (?:my|her|his|their) heart\\b|\\bmiss(?:ed|es)? you so much it\\b|\\b${I}${HAS}? been (?:so )?(?:lonely|miserable|worried sick)\\b|\\bcried (?:myself|herself|himself|themselves|all night|over you|for you)\\b`,
    ),
  },
  // Asking something of them.
  { id: "you_promised", pattern: pressure(`\\byou(?:['’]d| had)? promised\\b|\\byou said you(?:['’]d| would)\\b|\\bpromise me\\b|\\bpromise you(?:['’]ll| will)\\b|\\byou owe ${ME}\\b`) },
];

/** The first way a note presses or guilts, by its id; null for a note that does none of them. */
export function notePressure(text: string): string | null {
  const plain = text.replace(/\s+/g, " ");
  return NOTE_PRESSURE.find((p) => p.pattern.test(plain))?.id ?? null;
}

/* ------------------------------------------------ the person's choice ------------------------------------------------ */

type PrefsRow = { step_in_notes: string | null; step_in_notes_at: string | Date | null; step_in_quiet_from: number | null; step_in_quiet_to: number | null; step_in_tz: string | null };
const PREFS_COLUMNS = "step_in_notes, step_in_notes_at, step_in_quiet_from, step_in_quiet_to, step_in_tz";

const paceOf = (raw: unknown): NotePace | null => (NOTE_PACES as readonly string[]).includes(String(raw)) ? (raw as NotePace) : null;

export function prefsOf(row: Partial<PrefsRow> | null | undefined): NotePrefs {
  const pace = paceOf(row?.step_in_notes);
  return {
    pace,
    quiet_from: hourOf(row?.step_in_quiet_from, QUIET_DEFAULT.from),
    quiet_to: hourOf(row?.step_in_quiet_to, QUIET_DEFAULT.to),
    time_zone: timeZoneOf(row?.step_in_tz),
    turned_on_at: pace && row?.step_in_notes_at ? new Date(row.step_in_notes_at).toISOString() : null,
  };
}

/** A person's choice: off (the default) or how often, their quiet hours and their zone. */
export async function notePrefs(db: Db, viewer: string): Promise<NotePrefs> {
  const row = (await db.query<PrefsRow>(`select ${PREFS_COLUMNS} from adult_prefs where user_id = $1`, [viewer]).catch(() => ({ rows: [] as PrefsRow[] }))).rows[0];
  return prefsOf(row);
}

export type NotePrefsInput = { pace: NotePace | null; quiet_from?: number; quiet_to?: number; time_zone?: string };

/**
 * Saves their choice. `pace: null` is off: nothing more is written from that moment (the pass reads this before every
 * note), and what they'd set is kept so turning it on again finds it. A zone the runtime doesn't know is kept as UTC.
 */
export async function setNotePrefs(db: Db, viewer: string, input: NotePrefsInput): Promise<NotePrefs> {
  const before = await notePrefs(db, viewer);
  const pace = input.pace === null ? null : paceOf(input.pace);
  const from = hourOf(input.quiet_from, before.quiet_from);
  const to = hourOf(input.quiet_to, before.quiet_to);
  const zone = input.time_zone === undefined ? before.time_zone : timeZoneOf(input.time_zone);
  await db.query(
    `insert into adult_prefs (user_id, step_in_notes, step_in_notes_at, step_in_quiet_from, step_in_quiet_to, step_in_tz)
     values ($1, $2, case when $2::text is null then null else now() end, $3, $4, $5)
     on conflict (user_id) do update set
       step_in_notes = excluded.step_in_notes,
       step_in_notes_at = case when excluded.step_in_notes is null then null else coalesce(adult_prefs.step_in_notes_at, now()) end,
       step_in_quiet_from = excluded.step_in_quiet_from,
       step_in_quiet_to = excluded.step_in_quiet_to,
       step_in_tz = excluded.step_in_tz,
       updated_at = now()`,
    [viewer, pace, from, to, zone],
  );
  return notePrefs(db, viewer);
}

/** Their choice taken away whole (After Dark's "delete my profile"): off, and the zone and hours they'd given with it. */
export async function clearNotePrefs(db: Db, viewer: string): Promise<void> {
  await db.query(`update adult_prefs set step_in_notes = null, step_in_notes_at = null, step_in_quiet_from = null, step_in_quiet_to = null, step_in_tz = null, updated_at = now() where user_id = $1`, [viewer]);
}

/** What After Dark's download says about it. */
export async function exportNotes(db: Db, viewer: string): Promise<{ about: string; on: boolean; how_often: NotePace | null; quiet_hours: { from: number; to: number }; time_zone: string | null; turned_on_at: string | null; scenes_told_not_to: string[] }> {
  const row = (await db.query<PrefsRow>(`select ${PREFS_COLUMNS} from adult_prefs where user_id = $1`, [viewer])).rows[0];
  const prefs = prefsOf(row);
  const off = await db.query<{ id: string }>(`select id from adult_step_in_scenes where owner_id = $1 and notes_off order by created_at`, [viewer]);
  return {
    about: NOTES_ABOUT,
    on: prefs.pace !== null,
    how_often: prefs.pace,
    quiet_hours: { from: prefs.quiet_from, to: prefs.quiet_to },
    // Only a zone they actually gave: the default isn't theirs.
    time_zone: row?.step_in_tz ? prefs.time_zone : null,
    turned_on_at: prefs.turned_on_at,
    scenes_told_not_to: off.rows.map((r) => r.id),
  };
}

/* ------------------------------------------------ what the pages ask ------------------------------------------------ */

/** Whether a scene of theirs is written to first, and tells it not to (or to again). False when it isn't theirs. */
export async function setSceneNotes(db: Db, viewer: string, sceneId: string, off: boolean): Promise<boolean> {
  const r = await db.query(`update adult_step_in_scenes set notes_off = $3 where id = $1 and owner_id = $2 returning id`, [sceneId, viewer, off]);
  return r.rows.length > 0;
}

/** They've seen the note that was waiting in a scene of theirs (its page opened, or they wrote in it): nothing waits there now. */
export async function seenNote(db: Db, viewer: string, sceneId: string): Promise<boolean> {
  const r = await db.query(`update adult_step_in_scenes set note_at = null where id = $1 and owner_id = $2 and note_at is not null returning id`, [sceneId, viewer]);
  return r.rows.length > 0;
}

/** A note waiting for someone: the scene it's in, who wrote it (their id and first name), when, and how it starts. */
export type NoteWaiting = { scene: string; character: string; name: string; at: string; line: string };

/** The first sentence or so of a note, for the pages that say one is waiting. */
export function noteLine(text: string, max = 140): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf('." '), cut.lastIndexOf('?" '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/**
 * The notes waiting for someone (scenes still running, a note in each they haven't seen), the newest first: one query
 * for a whole page (Step in's front page, the Characters page, the hub's tile).
 */
export async function notesWaiting(db: Db, viewer: string): Promise<NoteWaiting[]> {
  const { rows } = await db.query<{ scene: string; character: string; name: string | null; at: string | Date; text: string | null }>(
    `select s.id as scene, s.character_id as character, c.name, s.note_at as at,
            (select m.text from adult_step_in_messages m where m.scene_id = s.id and m.kind = 'note' and m.replaced_by is null order by m.created_at desc, m.id desc limit 1) as text
       from adult_step_in_scenes s left join characters c on c.id = s.character_id
      where s.owner_id = $1 and s.note_at is not null and s.ended_at is null
      order by s.note_at desc limit 20`,
    [viewer],
  );
  return rows.map((r) => ({ scene: r.scene, character: r.character, name: (r.name ?? "Someone").trim().split(/\s+/)[0] || "Someone", at: new Date(r.at).toISOString(), line: noteLine(r.text ?? "") }));
}

/** How many scenes have a note waiting for someone (the header's dot). */
export async function notesWaitingCount(db: Db, viewer: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from adult_step_in_scenes where owner_id = $1 and note_at is not null and ended_at is null`, [viewer])).rows[0]?.n ?? 0;
}
