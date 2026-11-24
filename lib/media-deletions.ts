/**
 * Files in the stores deleted once nothing points at them (2026-11-22 audit: deleting an account removed its rows, and
 * After Dark's and the Studios' files stayed in Bunny and the bucket).
 *
 * The database queues them: every column that names a file (MEDIA_KEY_COLUMNS) has a trigger (lib/db.ts,
 * media_file_gone) that puts the old key in media_deletions when its row is deleted or names another file. So every way
 * a row goes queues its file with nothing to remember at the call: a person deleting their account, a character or a
 * picture, the cascades from those, a picture drawn again, a race's losing copy.
 *
 * The daily upkeep (app/api/jobs/daily, deleteDueMedia) deletes a file MEDIA_DELETE_DELAY_MS after it was queued: a
 * deletion in Bunny can't be undone, so the wait is the time to stop one made by mistake (delete its row from
 * media_deletions). When it's due the key is checked again, and a row that names it then keeps the file (outcome
 * 'kept'), so a file two rows share stays while one of them does. A store that fails is asked again the next day, up to
 * MEDIA_DELETE_TRIES times; the row then says why (outcome 'failed') for a person to look at.
 *
 * Deleted from every store this server has settings for (lib/object-store.ts mediaStores): a file of any area can be in
 * either, since the host that made it decided (After Dark's own host keeps everything in Bunny). The areas that live on
 * Bunny (lib/object-store.ts onBunny: After Dark's, the cast's hellos) wait while Bunny isn't one of them, so a host
 * without its settings never calls one of those gone.
 *
 * Only the live show deletes (DEPLOY_ENV=production, not After Dark's own host, which reaches Bunny alone). A
 * developer's machine or a preview can have the stores' settings with a copy of the rows (a branch of the database),
 * where a row it deleted is one production still has.
 */
import { afterDarkOnly } from "./after-dark-host";
import type { Db } from "./db";
import { isProductionDeploy } from "./deploy";
import { mediaStores, onBunny, type ObjectStore } from "./object-store";

/** How long a queued file waits before it's deleted (the trigger's `interval '7 days'` in lib/db.ts). */
export const MEDIA_DELETE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
/** How many days in a row a store may fail one file before it's left for a person. */
export const MEDIA_DELETE_TRIES = 5;
/** Files one run deletes at most (each is a request or two to a store). */
export const MEDIA_DELETE_BATCH = 200;
/** How long one run may take: the rest wait for tomorrow's (the daily job's other steps come after it). */
export const MEDIA_DELETE_BUDGET_MS = 60_000;
/** How long a finished row is kept, as the record of what was deleted. */
const DONE_KEPT_DAYS = 90;

/**
 * Every column that holds a key in the stores, each with its trigger in lib/db.ts. A file is deleted only when none of
 * them names it any more. A new table that keeps files (lib/object-store.ts keepBytes) is added here and given its
 * trigger: tests/media-deletions.test.ts reads the schema for both. (companion_messages.voice_key and
 * show_shots.portrait_key name a row and a portrait, not a file.)
 */
export const MEDIA_KEY_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ["adult_images", "object_key"],
  ["adult_talks", "object_key"],
  ["adult_presence", "object_key"],
  ["studio_pg_pictures", "object_key"],
  ["look_tiles", "object_key"],
  ["media_exports", "object_key"],
  ["companion_voice", "object_key"],
  ["face_kits", "object_key"],
  ["show_shots", "object_key"],
  ["date_film", "object_key"],
  ["live_face_compares", "audio_key"],
  ["live_face_renders", "mp4_key"],
  ["live_face_clips", "object_key"],
  ["character_intros", "audio_key"],
  ["character_intros", "object_key"],
  ["place_sounds", "object_key"],
  ["home_clips", "loop_key"],
  ["home_clips", "poster_key"],
  ["home_clips", "cut_key"],
];

/** Which of these keys a row still names (any of MEDIA_KEY_COLUMNS). */
export async function referencedKeys(db: Db, keys: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!keys.length) return found;
  for (const [table, column] of MEDIA_KEY_COLUMNS) {
    const { rows } = await db.query<{ key: string }>(`select ${column} as key from ${table} where ${column} = any($1::text[])`, [keys]);
    for (const r of rows) found.add(r.key);
  }
  return found;
}

export type MediaDeletionRun = { deleted: number; kept: number; failed: number; waiting: number; skipped?: string };

/**
 * Deletes the files whose wait is over and that no row names, from every store this server reaches (the daily upkeep).
 * A file a row names again is kept (outcome 'kept'); one a store failed on is tried again tomorrow. `stores` (tests)
 * stands in for this server's, and for the check that it's the live show.
 */
export async function deleteDueMedia(
  db: Db,
  opts: { now?: Date; stores?: { store: ObjectStore; bunny: boolean }[]; budgetMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<MediaDeletionRun> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const run: MediaDeletionRun = { deleted: 0, kept: 0, failed: 0, waiting: 0 };
  // Old records first: what was deleted stays on the list DONE_KEPT_DAYS.
  await db.query(`delete from media_deletions where done_at is not null and done_at < $1::timestamptz - interval '${DONE_KEPT_DAYS} days'`, [now.toISOString()]);
  const env = opts.env ?? process.env;
  if (!opts.stores && (!isProductionDeploy(env) || afterDarkOnly(env))) return { ...run, skipped: "not_live_show" };
  let stores: { store: ObjectStore; bunny: boolean }[];
  try {
    stores = opts.stores ?? mediaStores(env);
  } catch (err) {
    // Settings that don't read (lib/object-store.ts bunnyConfig): nothing is deleted until they do.
    console.error(`[media-deletions] no store: ${err instanceof Error ? err.message : "unknown"}`);
    return { ...run, skipped: "store_settings" };
  }
  if (!stores.length) return { ...run, skipped: "no_store" };
  const due = (
    await db.query<{ key: string; tries: number }>(
      `select key, tries from media_deletions where done_at is null and due_at <= $1 order by due_at limit ${MEDIA_DELETE_BATCH}`,
      [now.toISOString()],
    )
  ).rows;
  if (!due.length) return run;
  const used = await referencedKeys(
    db,
    due.map((d) => d.key),
  );
  const finish = (key: string, outcome: "deleted" | "kept" | "failed", error: string | null = null) =>
    db.query(`update media_deletions set done_at = $2, outcome = $3, last_error = coalesce($4, last_error) where key = $1`, [key, now.toISOString(), outcome, error]);
  const hasBunny = stores.some((s) => s.bunny);
  for (const { key, tries } of due) {
    if (Date.now() - started > (opts.budgetMs ?? MEDIA_DELETE_BUDGET_MS)) break;
    if (used.has(key)) {
      await finish(key, "kept");
      run.kept++;
      continue;
    }
    // After Dark's files and the other Bunny areas are in Bunny: without it here, they wait for a run that has it.
    if (onBunny(key) && !hasBunny) {
      run.waiting++;
      continue;
    }
    try {
      for (const { store } of stores) await store.remove(key);
      await finish(key, "deleted");
      run.deleted++;
    } catch (err) {
      const why = (err instanceof Error ? err.message : "unknown").slice(0, 300);
      if (tries + 1 >= MEDIA_DELETE_TRIES) {
        await finish(key, "failed", why);
      } else {
        await db.query(`update media_deletions set tries = tries + 1, last_error = $2, due_at = $3::timestamptz + interval '1 day' where key = $1`, [key, why, now.toISOString()]);
      }
      run.failed++;
    }
  }
  if (run.deleted || run.kept || run.failed) console.log(`[media-deletions] deleted ${run.deleted}, kept ${run.kept} (still used), failed ${run.failed}, waiting ${run.waiting}`);
  return run;
}
