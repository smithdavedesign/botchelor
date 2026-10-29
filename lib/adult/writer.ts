/**
 * Each person's writer (lib/adult/writer-config.ts): the one they picked while it's still on the list, else the default.
 * Kept in adult_prefs, one row a person, which goes with their account (lib/account.ts).
 */
import type { Db } from "../db";
import { getAdultSettings } from "./settings";
import { FALLBACK_WRITER, type WriterModel } from "./writer-config";

/** `picked`: whether `chosen` is one they picked (not the default). */
export type WriterOptions = { models: WriterModel[]; chosen: string; default: string; picked: boolean };

export async function writerOptions(db: Db, userId: string): Promise<WriterOptions> {
  const { writer } = await getAdultSettings(db);
  const mine = (await db.query<{ writer_model: string | null }>(`select writer_model from adult_prefs where user_id = $1`, [userId])).rows[0]?.writer_model ?? null;
  const picked = Boolean(mine && writer.models.some((m) => m.id === mine));
  return { models: writer.models, chosen: picked ? mine! : writer.default, default: writer.default, picked };
}

/** The model id that writes this person's scenes. */
export async function writerFor(db: Db, userId: string): Promise<string> {
  return (await writerOptions(db, userId)).chosen;
}

/**
 * Their writer whole: its id, and how much it thinks before it writes (added to each reply's budget). `opening`: the
 * night's first lines, which someone has just pressed Start for (the audit, 2026-10-29: about 70 s a step on GLM-4.6, so
 * the first press sat a minute or more with nothing on screen). Unless they picked a writer themselves, the fast one
 * writes those, and their own takes over from the next step.
 */
export async function writerChoice(db: Db, userId: string, opts: { opening?: boolean } = {}): Promise<{ id: string; think_tokens: number }> {
  const o = await writerOptions(db, userId);
  const id = opts.opening && !o.picked && o.models.some((m) => m.id === FALLBACK_WRITER) ? FALLBACK_WRITER : o.chosen;
  return { id, think_tokens: o.models.find((m) => m.id === id)?.think_tokens ?? 0 };
}

/** Picks a writer (null: back to the default). False when it isn't one of the writers on offer. */
export async function setWriter(db: Db, userId: string, id: string | null): Promise<boolean> {
  if (id !== null && !(await getAdultSettings(db)).writer.models.some((m) => m.id === id)) return false;
  await db.query(
    `insert into adult_prefs (user_id, writer_model) values ($1, $2) on conflict (user_id) do update set writer_model = excluded.writer_model, updated_at = now()`,
    [userId, id],
  );
  return true;
}
