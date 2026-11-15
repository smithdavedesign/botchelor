/**
 * "Bring their history" (lib/import-history.ts), the part that needs the server: the kept "two of you" lines go into the
 * companion memory of this person's thread with the character they just made, through the functions the memory page
 * itself uses (lib/companion.ts openThread, lib/companion-memory.ts editFacts "add"), so they show up on
 * /companion/:id/memory as pinned facts the person can edit, unpin or forget, and nowhere else.
 *
 * No store of its own: until the thread can exist (a guest past their free conversations, someone companions aren't
 * open to) the lines wait in the person's own browser (HISTORY_US_KEY) and the page says so.
 */
import { openThread, regenerate } from "./companion";
import { editFacts, listFacts } from "./companion-memory";
import { crisisIntent } from "./crisis";
import type { Db } from "./db";
import { HISTORY_ITEMS_MAX, screenHistoryItem } from "./import-history";
import { maybeCrisis } from "./step-in";

/**
 * A reader's line back in the person's own words ("They want to disappear for good" → "i want to disappear for good").
 * The crisis lists (lib/crisis.ts, lib/step-in.ts) read first-person statements, which is what people type; a reader
 * reports the same thing in the third person, and it must not slip past them for that.
 */
function asTheirOwnWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/\b(themselves|themself|himself|herself)\b/g, "myself")
    .replace(/\b(their|his|her)( own)? life\b/g, "my$2 life")
    .replace(/\b(they|he|she)\b/g, "i")
    .replace(/\b(doesnt|does not|do not)\b/g, "dont")
    .replace(/\bwants\b/g, "want")
    .replace(/\bwishes\b/g, "wish")
    .replace(/\bneeds\b/g, "need");
}

/**
 * The lines that may go into a companion's memory: the memory editor's own rules (PG, lengths: screenHistoryItem), and
 * never the words of a crisis or anything close to one. The editor asks a model about the close ones and pauses the
 * conversation on a real one (lib/companion.ts screenFact); an import fails closed instead, so a pasted log can never
 * pause a conversation that hasn't started or leave a note on someone's mental health.
 */
export function screenUsLines(lines: readonly string[]): { ok: string[]; dropped: number } {
  const ok: string[] = [];
  let dropped = 0;
  for (const raw of lines.slice(0, HISTORY_ITEMS_MAX)) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (screenHistoryItem("us", text) || [text, asTheirOwnWords(text)].some((v) => crisisIntent(v) || maybeCrisis(v))) dropped++;
    else if (!ok.includes(text)) ok.push(text);
  }
  return { ok, dropped: dropped + Math.max(0, lines.length - HISTORY_ITEMS_MAX) };
}

export type Remembered = { ok: true; threadId: string; fresh: boolean; kept: number; dropped: number } | { ok: false };

/**
 * Writes screened lines into the memory of this person's thread with this character, starting the thread when there is
 * none the way a character's own first text does (the AI notice, no model call: openThread `opener: false`). A line the
 * memory already holds is not written twice (the builder may send again); one editFacts refuses is counted as dropped.
 * The caller has already checked that the person owns the character and may talk with companions.
 */
export async function rememberImported(db: Db, userId: string, characterId: string, lines: readonly string[], now: Date = new Date()): Promise<Remembered> {
  const opened = await openThread(db, userId, characterId, now, { opener: false });
  if (!opened.ok) return { ok: false };
  const known = new Set((await listFacts(db, opened.thread_id)).map((f) => f.text.toLowerCase()));
  let kept = 0;
  let dropped = 0;
  for (const [i, text] of lines.entries()) {
    if (known.has(text.toLowerCase())) continue;
    // A millisecond apart, so the memory page lists them in the order the person saw them.
    const problem = await editFacts(db, opened.thread_id, { op: "add", text }, new Date(now.getTime() + lines.length - i));
    if (problem) dropped++;
    else {
      kept++;
      known.add(text.toLowerCase());
    }
  }
  return { ok: true, threadId: opened.thread_id, fresh: !opened.resumed, kept, dropped };
}

/**
 * The character's hello in a thread the import just started, written now that the memory is in, so its first words can
 * use what it remembers (lib/companion.ts regenerate: with nothing said yet, that is the opener, on the companion model,
 * free like every opener). Only into a thread nobody has spoken in; a failed draw leaves the thread as it is and the
 * person says hi first. Returns whether a line was written.
 */
export async function drawImportOpener(db: Db, userId: string, threadId: string, now: Date = new Date()): Promise<boolean> {
  const spoken = await db.query(`select 1 from companion_messages where thread_id = $1 and role <> 'system' limit 1`, [threadId]);
  if (spoken.rows.length) return false;
  const r = await regenerate(db, userId, threadId, now).catch(() => null);
  return Boolean(r?.ok);
}
