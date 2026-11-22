/** Types for scripts/intros-to-bunny.mjs, which stays plain JS so it runs with no build step. */
import type { CopyStore } from "./media-to-bunny.mjs";

type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type Log = (line: string) => void;

export type IntroToMove = { id: string; character_id: string; object_key: string | null; mime: string | null; db_bytes: number; updated_at: string };

export function introKeyFor(id: string, hash16: string): string;
export function introsToMove(db: Db): Promise<IntroToMove[]>;
export function moveIntros(
  db: Db,
  opts?: { apply?: boolean; from?: Pick<CopyStore, "get"> | null; to?: Pick<CopyStore, "put" | "size"> | null; log?: Log; warn?: Log },
): Promise<number>;
