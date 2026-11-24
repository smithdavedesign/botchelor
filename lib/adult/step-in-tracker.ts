/**
 * A Step in scene's continuity sheet (docs/audits/2026-11-23-scenes-and-side-pictures.md, row 6: "a tracker of where
 * the scene is"; David, 2026-11-24: "a scene tracker, so a character doesn't pick up a sweater she never had"). The
 * gap it closes was written down on the first Step in test (2026-11-19): nothing kept what was physically true, so a
 * character could put on, pick up or sit down on something the scene never had, and a long scene forgot what anyone
 * was wearing once the lines that said so had left the prompt.
 *
 * The sheet is four short lines: where the two of them are, what the character has on (and holds), what the viewer has
 * on (only ever from their own lines), and the few things in play around them.
 *
 *  - **Read after every reply**, past the response (lib/adult/step-in.ts stepInTrack, run by stepInFollowUp): one small
 *    call on After Dark's own model, shown the sheet so far and only the lines since it was last read, which says how
 *    things stand now. Each line it writes is held to what a recap is before it's kept; one that fails keeps what was
 *    there. A first read is told where the scene is set and what the character starts in (their part's costume in a
 *    roleplay, else their own clothes).
 *  - **Said to the writer** in the turn the reply answers (trackerCue, lib/adult/step-in-prompt.ts), never in the
 *    system prompt: that and every earlier turn stay the same from reply to reply, and a note beside the reply holds
 *    better than one a few thousand words up.
 *  - **The viewer's to correct**: the scene's ⋯ menu shows it ("Where things stand"), and a line they rewrite is kept
 *    as theirs (their words are read as a line of theirs is first).
 *
 * The sheet is kept with the reply it was read at, and the one before it: when that reply is drawn again, taken back or
 * flipped to another draw, the sheet falls back to how things stood before it (sheetFor), so a discarded reply's
 * events never stay on the sheet. When the scene has moved somewhere else since the sheet was read, where they were
 * and what was around them are left out until the next reply is read (afterMove).
 *
 * This module is the pure part (what's asked, how the answer is read, what's kept and what's said); the scene's own
 * rows are lib/adult/step-in.ts's. Client-safe: no server imports.
 */
import type { ChatMessage } from "../model";

/** Each line of the sheet, at most this long. */
export const TRACKER_FIELD_MAX = 160;
/** The sheet's lines, in the order they're shown and said. */
export const TRACKER_FIELDS = ["where", "them", "you", "around"] as const;
export type TrackerField = (typeof TRACKER_FIELDS)[number];

/**
 * How things stand: `where` the two of them are, what the character has on and holds (`them`), what the viewer has on
 * and holds (`you`: only from their own lines), and the things in play nobody is wearing or holding (`around`). Each a
 * plain list of things, with no names and no pronouns in it, so the same words read right to the viewer ("You have
 * on") and to the character ("What they have on"). "" for a line nothing is known of.
 */
export type SceneSheet = { where: string; them: string; you: string; around: string };
export const NO_SHEET: SceneSheet = { where: "", them: "", you: "", around: "" };
export const sheetIsEmpty = (s: SceneSheet): boolean => TRACKER_FIELDS.every((f) => !s[f]);

/** A sheet and the turn it's good as of (a reply it was read at; the newest turn when the viewer corrected it; null: before anything was said). */
export type SheetAt = { upto: string | null; sheet: SceneSheet };
/**
 * What the scene keeps (adult_step_in_scenes.tracker): the sheet, the turn it's good as of, and the sheet as it stood
 * before that turn was read. `reads` and `cost`: how many times it has been read and what that came to (dollars, as
 * the provider reports it), for the books.
 */
export type StoredTracker = SheetAt & { before: SheetAt | null; reads?: number; cost?: number };

/** The new lines a read is shown, and the most of each (a reply can be four paragraphs). */
export const TRACKER_NEW_LINES = 6;
/** With no sheet to start from, the scene's last turns instead. */
export const TRACKER_COLD_LINES = 8;
export const TRACKER_LINE_CHARS = 600;
export const TRACKER_REPLY_CHARS = 1600;
/** Room for the answer: four short lines. */
export const TRACKER_REPLY_TOKENS = 260;

/** Ways a model says "nothing here". No clothes at all is asked for as "naked", so none of these can mean that. */
const NOTHING = /^(?:none|nothing|nothing (?:yet|said|known|noted)|n\/?a|unknown|not (?:said|stated|known|mentioned|specified)|unspecified|-+|\.+)\.?$/i;

/** One line of a sheet as it's kept: on one line, held to its length, "" for anything that only says there's nothing. */
export function sheetLine(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "").trim();
  if (!text || NOTHING.test(text)) return "";
  if (text.length <= TRACKER_FIELD_MAX) return text;
  // Too long: cut at the last whole thing that fits, else at the last whole word.
  const cut = text.slice(0, TRACKER_FIELD_MAX);
  const at = Math.max(cut.lastIndexOf(";"), cut.lastIndexOf(","));
  return (at > TRACKER_FIELD_MAX / 2 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : TRACKER_FIELD_MAX)).trim();
}

/** A kept sheet read back: null for anything that isn't one. */
function sheetOf(raw: unknown): SceneSheet | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!TRACKER_FIELDS.some((f) => typeof o[f] === "string")) return null;
  return { where: sheetLine(o.where), them: sheetLine(o.them), you: sheetLine(o.you), around: sheetLine(o.around) };
}

const sheetAt = (raw: unknown): SheetAt | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { upto?: unknown; sheet?: unknown };
  const sheet = sheetOf(o.sheet);
  return sheet ? { upto: typeof o.upto === "string" && o.upto ? o.upto : null, sheet } : null;
};

/** What the scene's row keeps, read back; null when it keeps nothing readable. */
export function storedTracker(raw: unknown): StoredTracker | null {
  const now = sheetAt(raw);
  if (!now) return null;
  const o = raw as { before?: unknown; reads?: unknown; cost?: unknown };
  return { ...now, before: sheetAt(o.before), reads: typeof o.reads === "number" ? o.reads : 0, cost: typeof o.cost === "number" ? o.cost : 0 };
}

/**
 * The sheet that holds for the scene as it stands. `standing`: the ids of the turns standing in the scene (nothing
 * drawn again and set aside, nothing taken back). The kept sheet when the turn it's good as of still stands; else the
 * one before it, on the same condition; else none, and the next read starts from the scene's last turns. So drawing a
 * reply again, taking an exchange back or flipping to another draw never leaves that reply's events on the sheet.
 */
export function sheetFor(stored: unknown, standing: ReadonlySet<string>): SheetAt | null {
  const kept = storedTracker(stored);
  if (!kept) return null;
  const stands = (id: string | null) => id === null || standing.has(id);
  if (stands(kept.upto)) return { upto: kept.upto, sheet: kept.sheet };
  return kept.before && stands(kept.before.upto) ? kept.before : null;
}

/** A standing turn as the sheet needs it: its id, and whether it's the line that says the scene moved somewhere else. */
export type TrackerTurn = { id: string; moved?: boolean };

/**
 * The sheet that holds now, and whether the scene has moved somewhere else since it was read (a "the scene moves" line
 * stands after the turn it's good as of): then where they were and what was around them no longer hold (afterMove).
 */
export function sheetNow(stored: unknown, turns: readonly TrackerTurn[]): (SheetAt & { moved: boolean }) | null {
  const now = sheetFor(stored, new Set(turns.map((t) => t.id)));
  if (!now) return null;
  const at = now.upto === null ? -1 : turns.findIndex((t) => t.id === now.upto);
  return { ...now, moved: now.upto !== null && turns.slice(at + 1).some((t) => t.moved) };
}

/** A sheet once the scene has moved somewhere else: what they have on goes with them; the place and its things don't. */
export const afterMove = (sheet: SceneSheet): SceneSheet => ({ ...sheet, where: "", around: "" });

/** The sheet as a page shows it and a prompt says it: without where and around when the scene has moved since. */
export const sheetShown = (now: (SheetAt & { moved: boolean }) | null): SceneSheet | null => (now ? (now.moved ? afterMove(now.sheet) : now.sheet) : null);

/** One of the new lines a read is shown: the viewer's, the character's, or the scene moving (its text: the place). */
export type TrackerLine = { who: "them" | "character" | "moved"; text: string };

export type TrackerInput = {
  /** The character's first name. */
  name: string;
  /** The sheet so far; null for a first read. */
  base: SceneSheet | null;
  /** Where the scene is set and what the character starts in, while the sheet doesn't say: for a first read. */
  seed?: { place: string; wearing: string | null } | null;
  /** The lines since the sheet was last read, oldest first. */
  lines: readonly TrackerLine[];
};

/**
 * What the read is asked: the sheet so far, the lines since, and how things stand now. To the model the character's
 * line is "character" and the viewer's "person" (a key called "you" in a sheet about two people reads as the model
 * itself); parseSheet puts them back.
 */
export function trackerMessages(input: TrackerInput): ChatMessage[] {
  const { name } = input;
  const said = input.lines
    .map((l) => {
      const text = l.text.replace(/\s+/g, " ").trim();
      if (l.who === "moved") return `(The scene moves: the two of them are now at ${text}.)`;
      return l.who === "them" ? `The person: ${text.slice(0, TRACKER_LINE_CHARS)}` : `${name}: ${text.slice(0, TRACKER_REPLY_CHARS)}`;
    })
    .join("\n");
  const b = input.base;
  const sheet = b ? `The sheet so far:\n${JSON.stringify({ where: b.where, character: b.them, person: b.you, around: b.around })}` : "There is no sheet yet.";
  const seed = input.seed ? `The scene is set at ${input.seed.place}.${input.seed.wearing ? ` Unless the lines say otherwise, ${name} starts in: ${input.seed.wearing}.` : ""}` : "";
  return [
    {
      role: "system",
      content: `You keep the continuity sheet of a private scene of adult fiction between a person and ${name}, an AI character: where the two of them are and what is physically true right now, so that nothing in the scene appears, vanishes or changes without the story saying so. You note only what the lines say or plainly show, never what might be true. You answer with JSON and nothing else.`,
    },
    {
      role: "user",
      content: [
        sheet,
        seed,
        `The newest lines, oldest first ("The person" is the one ${name} is with):\n${said}`,
        [
          "Write the sheet as it stands after these lines. Keep, word for word, every part the new lines don't change; change only what they change; leave out what is gone.",
          '- "where": the spot the two of them are in now, in a few words (the room, and where in it). When the scene moves, it is the new place.',
          `- "character": what ${name} has on right now, piece by piece, then anything ${name} is holding. A piece that has come off is left out; with nothing on at all, "naked".`,
          '- "person": what the person has on or is holding, only from what the person\'s own lines say about themselves. "" until they have said.',
          '- "around": the things in play that nobody is wearing or holding, and where each one is (a parcel on the hall shelf). Four at most; "" for none.',
          `Plain facts in the present tense, each a list of things: no names, no "he", "she" or "they", no feelings, nothing that has not been said. One line each, under ${TRACKER_FIELD_MAX} characters.`,
          'Reply with a JSON object: {"where": "...", "character": "...", "person": "...", "around": "..."}',
        ].join("\n"),
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

/**
 * The sheet a read answered with: all four lines, each on one line and held to its length. Null for anything else (no
 * JSON, a line missing, a reply meant for something else), and for a sheet with nothing on it: then nothing is kept
 * and the sheet stays as it was.
 */
export function parseSheet(raw: string): SceneSheet | null {
  const found = raw.match(/\{[\s\S]*\}/);
  if (!found) return null;
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(found[0]) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const them = o.character ?? o.them;
  const you = o.person ?? o.you;
  if (![o.where, them, you, o.around].every((v) => typeof v === "string")) return null;
  const sheet: SceneSheet = { where: sheetLine(o.where), them: sheetLine(them), you: sheetLine(you), around: sheetLine(o.around) };
  return sheetIsEmpty(sheet) ? null : sheet;
}

/**
 * The sheet that's kept of a read: a line that fails `ok` (what a recap is held to, lib/adult/step-in.ts) isn't kept,
 * and what was there before stays in its place.
 */
export function holdSheet(next: SceneSheet, before: SceneSheet | null, ok: (text: string) => boolean): SceneSheet {
  const keep = (f: TrackerField) => (next[f] && !ok(next[f]) ? (before?.[f] ?? "") : next[f]);
  return { where: keep("where"), them: keep("them"), you: keep("you"), around: keep("around") };
}

const noStop = (s: string) => s.trim().replace(/[.\s]+$/, "");

/**
 * The sheet as the character is told it, in the turn its reply answers (lib/adult/step-in-prompt.ts stepInMessages): to
 * the character "you" is itself and "they" the viewer, so the sheet's `them` is what the character has on. It says how
 * things stood before this turn, since what the viewer has just written can change it. Null with nothing to say.
 */
export function trackerCue(sheet: SceneSheet | null | undefined): string | null {
  if (!sheet) return null;
  const parts = [
    sheet.where ? `Where you both are: ${noStop(sheet.where)}.` : "",
    sheet.them ? `What you have on: ${noStop(sheet.them)}.` : "",
    sheet.you ? `What they have on: ${noStop(sheet.you)}.` : "",
    sheet.around ? `Within reach: ${noStop(sheet.around)}.` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return `(For continuity, how things stood just before this. ${parts.join(" ")} Keep to it, changed only by what has happened since: nothing else is worn, held or in the room unless your reply brings it in and says where it came from. Don't recite any of it.)`;
}

/** What each line is called on the scene's page. */
export function trackerLabels(name: string): Record<TrackerField, string> {
  return { where: "Where you are", them: `${name} has on`, you: "You have on", around: "Within reach" };
}
