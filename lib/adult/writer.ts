/**
 * Each person's writer (lib/adult/writer-config.ts): the one they picked while it's still on the list, else the default.
 * Kept in adult_prefs, one row a person, which goes with their account (lib/account.ts).
 */
import type { Db } from "../db";
import { getAdultSettings } from "./settings";
import type { WriterModel } from "./writer-config";

export type WriterOptions = { models: WriterModel[]; chosen: string; default: string };

export async function writerOptions(db: Db, userId: string): Promise<WriterOptions> {
  const { writer } = await getAdultSettings(db);
  const mine = (await db.query<{ writer_model: string | null }>(`select writer_model from adult_prefs where user_id = $1`, [userId])).rows[0]?.writer_model ?? null;
  const chosen = mine && writer.models.some((m) => m.id === mine) ? mine : writer.default;
  return { models: writer.models, chosen, default: writer.default };
}

/** The model id that writes this person's scenes. */
export async function writerFor(db: Db, userId: string): Promise<string> {
  return (await writerOptions(db, userId)).chosen;
}

/** Their writer whole: its id, and how much it thinks before it writes (added to each reply's budget). */
export async function writerChoice(db: Db, userId: string): Promise<{ id: string; think_tokens: number }> {
  const o = await writerOptions(db, userId);
  return { id: o.chosen, think_tokens: o.models.find((m) => m.id === o.chosen)?.think_tokens ?? 0 };
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
