/** Types for scripts/media-to-bunny.mjs, which stays plain JS so it runs with no build step. */
export type CopyStore = {
  name: string;
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  size(key: string): Promise<number | null>;
  sha256?(key: string): Promise<string | null>;
};
type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: { id: string; object_key: string; mime: string | null }[] }> };
type Log = (line: string) => void;

export const BUNNY_STORAGE_HOSTS: Readonly<Record<string, string>>;
export function keyHashMatches(key: string, bytes: Buffer): boolean;
export function bunnyStorage(env: Record<string, string | undefined>, fetchImpl?: typeof fetch, pause?: (ms: number) => Promise<void>): CopyStore;
export function copyAll(
  db: Db,
  from: CopyStore,
  to: CopyStore,
  opts?: { dryRun?: boolean; batch?: number; limit?: number; tables?: string[]; log?: Log; warn?: Log },
): Promise<number>;
export function verifyAll(db: Db, store: CopyStore, opts?: { tables?: string[]; log?: Log }): Promise<number>;
