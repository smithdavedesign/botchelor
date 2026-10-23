/**
 * The admin's view of every stored key's sealing (docs/PRDs/connections.md "Security model"): how many are sealed under
 * KEY_ENCRYPTION_SECRET (v2) and how many still under SESSION_SECRET (legacy), people's and the house's, and the button
 * that seals every legacy one again as v2 at once instead of waiting for each to be read. Counts only: no key, sealed or
 * not, ever leaves here.
 */
import type { Db } from "./db";
import { openConnection } from "./connections";
import { currentSealVersion, keySecretState, sealVersion, type KeySecretState, type SealVersion } from "./key-crypto";
import { adultKeys, KEY_COLUMNS } from "./adult/settings";

type Env = Record<string, string | undefined>;
export type SealCounts = { v2: number; legacy: number };
export type KeyStoreStatus = {
  /** KEY_ENCRYPTION_SECRET: set and used, unset, or set but too short to use. */
  secret: KeySecretState;
  /** What a key saved now is sealed with. */
  writes: SealVersion | null;
  people: SealCounts;
  house: SealCounts;
};

export async function keyStoreStatus(db: Db, env: Env = process.env): Promise<KeyStoreStatus> {
  const people = (await db.query<{ ciphertext: string }>(`select ciphertext from user_connections`)).rows;
  const r = (await db.query<Record<string, string | null>>(`select * from adult_settings where id = 1`).catch(() => ({ rows: [] as Record<string, string | null>[] }))).rows[0];
  const house = KEY_COLUMNS.map((c) => r?.[`${c}_ciphertext`]).filter((c): c is string => Boolean(c));
  const count = (list: string[]): SealCounts => ({
    v2: list.filter((c) => sealVersion({ ciphertext: c }) === "v2").length,
    legacy: list.filter((c) => sealVersion({ ciphertext: c }) === "legacy").length,
  });
  return { secret: keySecretState(env), writes: currentSealVersion(env), people: count(people.map((p) => p.ciphertext)), house: count(house) };
}

/**
 * Seals every legacy key again as v2 now (each one is opened and sealed again in place, as a read would). Only with
 * KEY_ENCRYPTION_SECRET on. Returns how many moved, and how many couldn't be opened (they stay as they are, and show on
 * their owners' cards as needing to be pasted again).
 */
export async function resealAll(db: Db, env: Env = process.env): Promise<{ people: number; house: number; unreadable: number }> {
  if (keySecretState(env) !== "on") return { people: 0, house: 0, unreadable: 0 };
  const before = await keyStoreStatus(db, env);
  const legacy = (await db.query<{ user_id: string; provider: string; ciphertext: string }>(`select user_id, provider, ciphertext from user_connections`)).rows.filter(
    (r) => sealVersion(r) === "legacy",
  );
  let unreadable = 0;
  for (const r of legacy) if ((await openConnection(db, r.user_id, r.provider, env)) === null) unreadable++;
  await adultKeys(db, env);
  const after = await keyStoreStatus(db, env);
  // A house key still legacy after its read couldn't be opened either.
  return { people: before.people.legacy - after.people.legacy, house: before.house.legacy - after.house.legacy, unreadable: unreadable + after.house.legacy };
}
