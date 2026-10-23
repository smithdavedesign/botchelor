/**
 * Paging for long lists (David, 2026-10-22: "paginate long lists"). Pure helpers shared by the one pager component
 * (app/Pager.tsx) and the pages that use it: what page a `?page=` means, how many pages a list has, the slice a page
 * shows, which page numbers the pager draws, and a page's address with every other search param kept.
 */

/** The highest `?page=` taken at face value; a bigger number is junk and reads as page 1. */
const MAX_PAGE = 100_000;

/**
 * A `?page=` search param as a page number: a whole number from 1, else 1. A repeated param uses the first; "0",
 * "-2", "2.5", "1e3", "abc" and absurdly large numbers all read as 1, so a hand-typed URL never errors.
 */
export function parsePage(raw: string | string[] | undefined | null): number {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (!/^\d{1,9}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= MAX_PAGE ? n : 1;
}

/** How many pages `total` items make at `per` a page: at least 1, so an empty list is one (empty) page. */
export function pageCount(total: number, per: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, per)));
}

/** A page number pulled into 1..pages (a page past the end shows the last one). */
export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, pages));
}

export type Paged<T> = { items: T[]; page: number; pages: number; total: number; per: number };

/** One page of a list already in memory (the page is clamped, so a stale link still shows something). */
export function pageOf<T>(all: readonly T[], page: number, per: number): Paged<T> {
  const pages = pageCount(all.length, per);
  const p = clampPage(page, pages);
  return { items: all.slice((p - 1) * per, p * per), page: p, pages, total: all.length, per };
}

/** The SQL `limit` and `offset` for a page. */
export function pageBounds(page: number, per: number): { limit: number; offset: number } {
  return { limit: per, offset: (Math.max(1, Math.floor(page) || 1) - 1) * per };
}

/**
 * The page numbers a pager draws: always the first and last, the current one and `span` either side, and a "gap"
 * where numbers are left out. Seven pages or fewer show every number.
 */
export function pageWindow(page: number, pages: number, span = 1): (number | "gap")[] {
  if (pages <= 1) return pages === 1 ? [1] : [];
  const p = clampPage(page, pages);
  if (pages <= 5 + 2 * span) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, Math.min(p - span, pages - 1 - 2 * span - 1));
  const to = Math.min(pages - 1, Math.max(p + span, 2 + 2 * span + 1));
  if (from > 2) out.push("gap");
  for (let n = from; n <= to; n++) out.push(n);
  if (to < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

type Params = Record<string, string | string[] | undefined>;

/**
 * A page's address: `path` with the current search params, `key` set to the page (left out for page 1, so page 1 is
 * the plain URL), and an optional `#hash` to land back on the list.
 */
export function pageHref(path: string, params: Params, key: string, page: number, hash?: string): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === key || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  if (page > 1) q.set(key, String(page));
  const s = q.toString();
  return `${path}${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}
