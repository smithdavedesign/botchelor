import type { Db } from "./db";
import { suggestFreeNames } from "./names";

/**
 * Whether a character name is already on the show, and free ones like it (#249/#477). Names compare trimmed and
 * case-blind. `exceptId` is the character being edited, which may keep its own.
 */
export async function nameCheck(db: Db, wanted: string, exceptId: string | null = null): Promise<{ twin: { id: string; name: string } | null; freeNames: () => Promise<string[]> }> {
  const name = wanted.trim();
  const twin = name
    ? ((
        await db.query<{ id: string; name: string }>(
          `select id, name from characters where lower(trim(name)) = lower($1) and id is distinct from $2::text limit 1`,
          [name, exceptId],
        )
      ).rows[0] ?? null)
    : null;
  const freeNames = async () => {
    const taken = new Set((await db.query<{ name: string }>(`select lower(trim(name)) as name from characters`)).rows.map((r) => r.name));
    return suggestFreeNames(name, taken);
  };
  return { twin, freeNames };
}
