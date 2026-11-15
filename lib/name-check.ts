import type { Db } from "./db";
import { suggestFreeNames } from "./names";
import { notPersonaSql } from "./step-in-shared";

/**
 * Whether a character name is already on the show, and free ones like it (#249/#477). Names compare trimmed and
 * case-blind. `exceptId` is the character being edited, which may keep its own.
 */
export async function nameCheck(db: Db, wanted: string, exceptId: string | null = null): Promise<{ twin: { id: string; name: string } | null; freeNames: () => Promise<string[]> }> {
  const name = wanted.trim();
  const twin = name
    ? ((
        await db.query<{ id: string; name: string }>(
          // A "you" on a step-in date holds no name (lib/step-in-shared.ts): a visitor called Sam doesn't take "Sam".
          `select id, name from characters where lower(trim(name)) = lower($1) and id is distinct from $2::text and ${notPersonaSql()} limit 1`,
          [name, exceptId],
        )
      ).rows[0] ?? null)
    : null;
  const freeNames = async () => {
    const taken = new Set((await db.query<{ name: string }>(`select lower(trim(name)) as name from characters where ${notPersonaSql()}`)).rows.map((r) => r.name));
    // From the name as it's on the show, so "juno MARLOWE" suggests "Perpetua Marlowe".
    return suggestFreeNames(twin?.name ?? name, taken);
  };
  return { twin, freeNames };
}
