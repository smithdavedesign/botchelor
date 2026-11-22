import type { Db } from "./db";

/**
 * A share of this server's database pool for one kind of request: at most `max` of its queries at a time, the rest
 * waiting their turn here without holding a connection. Pages keep the rest of the pool (lib/db.ts POOL_SIZE, 10 on
 * prod). The image route is the one that needs it (2026-11-22 audit: a page of 195 faces opened while Cloudflare's cache
 * was empty sent 195 image requests at once, each with its own reads, and everyone else waited for a connection).
 */
export type PoolShare = { readonly max: number; running: number; waiting: (() => void)[] };

export const poolShare = (max: number): PoolShare => ({ max: Math.max(1, max), running: 0, waiting: [] });

/** `db` with every query run inside `share`. A freed place goes straight to the next in line, so `max` is never passed. */
export function withinShare(db: Db, share: PoolShare): Db {
  const inTurn = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (share.running < share.max) share.running++;
    else await new Promise<void>((resolve) => share.waiting.push(resolve)); // handed a place that's already counted
    try {
      return await run();
    } finally {
      const next = share.waiting.shift();
      if (next) next();
      else share.running--;
    }
  };
  return {
    query: <T = Record<string, unknown>,>(sql: string, params?: unknown[]) => inTurn(() => db.query<T>(sql, params)),
    exec: (sql: string) => inTurn(() => db.exec(sql)),
  };
}
