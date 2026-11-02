/**
 * What every signed-out visitor sees alike (the home page's boards, the watch lobby, the cast directory, the showcase's
 * first pages), kept in this server's memory for a few seconds, so a page for someone new doesn't wait on the database
 * (David, 2026-11-02: "other performance benefits": the main pages took 0.7–1.1 s, nearly all of it one database round
 * trip after another, each across the country: the database is in Oregon, the app in New York).
 *
 * - Only for no one in particular: a signed-in viewer's call goes to the database as before (`forViewer`).
 * - An entry lives SHARED_TTL_MS at most and is never served older; one load runs at a time per key, and a failed one
 *   isn't kept.
 * - Each caller gets its own copy (structuredClone), so a page that sorts or trims what it got can't change the next one's.
 *   Something that can't be copied (a function, a class instance) is handed over as it is and never kept, so a page
 *   can't fail on the cache.
 * - Anything that takes something off the public pages at once (a report, a removal, a visibility change) drops it all
 *   (lib/graph-cache.ts invalidateGraph calls clearSharedCache), as it does the Constellation's.
 * - Off outside production (tests and scripts read the database every time), unless a test turns it on.
 */

export const SHARED_TTL_MS = 30_000;
/** At most this many entries (pages and filters make keys); the oldest go first. */
const MAX_ENTRIES = 300;

type Entry = { at: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();
let forced: boolean | null = null;

const on = () => forced ?? (process.env.NODE_ENV === "production" && !process.env.VITEST);

/** Tests: switch the cache on or off regardless of the environment (null: back to the default), emptied either way. */
export function setSharedCacheForTests(enabled: boolean | null): void {
  forced = enabled;
  entries.clear();
}

/** Forget everything kept: the next visit to each page loads afresh. */
export function clearSharedCache(): void {
  entries.clear();
}

/** `load()`'s result, at most SHARED_TTL_MS old, shared by every caller asking under `key`. */
export async function shared<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  if (!on()) return load();
  const hit = entries.get(key);
  if (hit && now - hit.at <= SHARED_TTL_MS) return copy(key, (await hit.value) as T);
  const value = load();
  entries.delete(key);
  entries.set(key, { at: now, value });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return copy(key, await value);
}

/** Its own copy for this caller; anything that can't be copied isn't kept. */
function copy<T>(key: string, value: T): T {
  try {
    return structuredClone(value);
  } catch {
    entries.delete(key);
    return value;
  }
}

/** For a page's viewer: the shared copy when they're no one in particular (signed out), else straight from `load()`. */
export function forViewer<T>(viewerId: string | null | undefined, key: string, load: () => Promise<T>): Promise<T> {
  return viewerId ? load() : shared(key, load);
}
