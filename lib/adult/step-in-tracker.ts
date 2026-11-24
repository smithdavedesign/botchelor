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
 * This module is the sheet itself (what's kept, which sheet holds, what's said to the writer and shown on the page);
 * what the read is asked and how its answer is settled is lib/adult/step-in-tracker-read.ts, and the scene's own rows
 * are lib/adult/step-in.ts's. Client-safe: no server imports, and nothing the scene's page doesn't need.
 */
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
/** Room for the answer: the changes it lists first, then six short lines. */
export const TRACKER_REPLY_TOKENS = 420;

/**
 * Ways a model says "nothing here" or "I don't know": never a state of the scene, so never a line of the sheet or a
 * thing on one. The first live reads (2026-11-24) kept "nothing on" as what a character was wearing after an opening
 * that never mentioned her clothes, then "holding nothing" in place of them. ("nothing but a towel" and "nothing left
 * on" do say something, and aren't these.)
 */
export const NOT_A_THING =
  /^(?:(?:holding|carrying|wearing|has|with)\s+)?(?:nothing|none|no ?one|no (?:clothes|clothing|items?|objects?|things?)|n\/?a|unknown|unspecified|undisclosed|empty|null|same|unchanged|as before|no change|not (?:said|stated|known|mentioned|specified|described|applicable|given|clear|noted|yet said|yet known))(?:\s+(?:on|yet|at all|said|stated|known|noted|mentioned|specified|described|held|else|here|so far|in (?:the |her |his |their |your |either |both )?hands?))*[.!]?$|^(?:(?:the |her |his |their |both )?hands? (?:are |is )?(?:empty|free)|empty[- ]handed|empty hands)[.!]?$|^[-–—.?…\s]+$/i;

/** One line of a sheet as it's kept: on one line, held to its length, "" for anything that only says there's nothing. */
export function sheetLine(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "").trim();
  if (!text || NOT_A_THING.test(text)) return "";
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
 * things stood before this turn, since what the viewer has just written can change it. It lists what the scene has
 * established and never claims to be everything (the sheet may know one piece of what someone has on), so it asks
 * that what's listed isn't contradicted, not that nothing else exists. Null with nothing to say.
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
  return `(For continuity, how things stood just before this. ${parts.join(" ")} Keep to it: what's listed stays as it is until the story changes it, and nothing listed is somewhere else or back on. Anything not listed that your reply brings in gets a word on where it came from. Don't recite any of it.)`;
}

/** What each line is called on the scene's page. */
export function trackerLabels(name: string): Record<TrackerField, string> {
  return { where: "Where you are", them: `${name} has on`, you: "You have on", around: "Within reach" };
}
