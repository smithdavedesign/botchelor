/**
 * Who the show may feature (2026-11-14 hygiene): a deleted account's characters (lib/rules.ts DELETED_OWNER; the
 * account is gone, the character stays only so aired dates keep both names) never win an award, lead a board or head
 * a list. The Reunion's "Biggest disaster" was a deleted account's test character. One fragment, used by every public
 * board, so a new one can't forget the rule.
 *
 * Privacy is a different rule: a private character is still named, by name only (lib/directory.ts privateAmong), so
 * nothing here checks visibility. Episodes have their own public test (lib/date-number.ts publicDateSql).
 */
import { DELETED_OWNER } from "./rules";

/** SQL: the character in `alias` belongs to a live account (or to the house). */
export const listedCharacterSql = (alias: string) => `${alias}.owner_id is distinct from '${DELETED_OWNER}'`;

/** SQL: both characters of the episode in `e` belong to live accounts (no join needed). */
export const listedDateSql = (e: string) =>
  `(select ${listedCharacterSql("la")} from characters la where la.id = ${e}.character_a)
   and (select ${listedCharacterSql("lb")} from characters lb where lb.id = ${e}.character_b)`;
