/**
 * Browser-side marks the engagement beacon (app/engagement.ts) reads back later, kept in sessionStorage so they live for
 * one tab's visit and never reach another viewer. Client-safe, no server code.
 *
 * `date_started` → `date_watched` (the 2026-11-14 core plan, "honest date_watched"): the wizard stamps the moment a date
 * is sent (app/create/CreateWizard.tsx sendOnDate), and the theater sends how long it took the creator to reach the
 * ending as `ms_since_start`, or null when the stamp isn't there (a replay in another tab, storage blocked).
 */
export const DATE_STARTED_AT_KEY = "bz_date_started_at";

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Marks when a date was sent; nothing when storage is blocked. */
export function stampDateStarted(now: number = Date.now(), storage: Storage | null = store()): void {
  try {
    storage?.setItem(DATE_STARTED_AT_KEY, String(Math.floor(now)));
  } catch {
    /* a private window, or storage turned off */
  }
}

/**
 * The early verdict (PR3): the filming stage fired `date_watched` for this date when its verdict card showed. When the
 * finished date then opens in the theater (`?play=1&from=N`) in the same tab, the theater reads this and doesn't count
 * the same ending twice. Per episode, so another date in the tab still counts.
 */
export const DATE_WATCHED_LIVE_KEY = "bz_date_watched_live";

export function markDateWatchedLive(episodeId: string, storage: Storage | null = store()): void {
  try {
    storage?.setItem(DATE_WATCHED_LIVE_KEY, episodeId);
  } catch {
    /* a private window, or storage turned off */
  }
}

/** Whether the stage already counted this date's ending in this tab. */
export function dateWatchedLive(episodeId: string, storage: Storage | null = store()): boolean {
  try {
    return storage?.getItem(DATE_WATCHED_LIVE_KEY) === episodeId;
  } catch {
    return false;
  }
}

/** Milliseconds since the stamp, or null without one (or one from the future, or unreadable storage). */
export function msSinceDateStarted(now: number = Date.now(), storage: Storage | null = store()): number | null {
  try {
    const raw = storage?.getItem(DATE_STARTED_AT_KEY);
    if (!raw) return null;
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0 || at > now) return null;
    return Math.round(now - at);
  } catch {
    return null;
  }
}

/**
 * Where a viewer left the theater (the 2026-11-16 Monday read): in 30 days the few outside viewers who pressed Watch all
 * left within 45 seconds and nobody reached an ending, but nothing said at which line. `theater_left` carries how far
 * they got (`line` of `of`, `pct`) and how long they stayed (`secs`, capped at an hour), `via` "exit" (the Exit
 * button) or "hidden" (the tab went away), and `auto` when ?play=1 opened it (a clip's or a season page's link) rather
 * than the Watch button. Once per opening, never after the ending (that's `date_watched`). Pure.
 */
export function theaterLeftProps(input: { line: number; of: number; openedAt: number; now: number; via: "exit" | "hidden"; auto: boolean; intro?: boolean }) {
  const of = Math.max(0, Math.floor(input.of));
  const line = Math.min(of, Math.max(0, Math.floor(input.line)));
  const secs = Math.min(3600, Math.max(0, Math.round((input.now - input.openedAt) / 1000)));
  // `intro`: this opening began with the cold open (lib/cold-open.ts); line 0 with it is leaving from the card itself.
  return { via: input.via, line, of, pct: of ? Math.round((100 * line) / of) : 0, secs, auto: input.auto, ...(input.intro === undefined ? {} : { intro: input.intro }) };
}
