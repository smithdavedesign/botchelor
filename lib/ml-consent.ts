/**
 * Opt-in consent to use a person's Botchelor data for machine learning: training, fine-tuning, evaluation datasets
 * (David, 2026-10-22). Opt-in, per account, and revocable: no row, or `granted = false`, means no.
 *
 * What it gates: only what goes INTO a dataset. The show still records what it records (that's how it runs), but a
 * dataset builder must filter every row through `consentedOwnerSql` — and, separately, to aired public dates only;
 * private, unlisted and After Dark data never enters a dataset, whatever the consent says (scripts/eval/).
 *
 * Agents: an MCP agent's characters belong to its agent id; when the agent is linked to a person's account
 * (agent_links), the person's choice covers them. House characters belong to the show and need no consent.
 */
import { recordChoice } from "./choice-history";
import type { Db } from "./db";

/** The wording version a person agreed to: bump it when the privacy page's training sentence changes meaning. */
export const ML_CONSENT_VERSION = "2026-10-22";

export type MlConsent = { granted: boolean; version: string | null; decided_at: string | null };

export async function getMlConsent(db: Db, userId: string): Promise<MlConsent> {
  const r = (await db.query<{ granted: boolean; version: string; decided_at: string | Date }>(`select granted, version, decided_at from ml_consents where user_id = $1`, [userId]))
    .rows[0];
  return r ? { granted: r.granted, version: r.version, decided_at: new Date(r.decided_at).toISOString() } : { granted: false, version: null, decided_at: null };
}

/** Records a signed-in account's choice. Only a real account can consent (an anonymous id can't speak for anyone). */
export async function setMlConsent(db: Db, userId: string, granted: boolean): Promise<MlConsent> {
  await db.query(
    `insert into ml_consents (user_id, granted, version, decided_at)
     select $1, $2, $3, now() where exists (select 1 from accounts where user_id = $1)
     on conflict (user_id) do update set granted = excluded.granted, version = excluded.version, decided_at = now()`,
    [userId, granted, ML_CONSENT_VERSION],
  );
  const now = await getMlConsent(db, userId);
  // Every decision, with its wording version: what someone agreed to, and when, stays provable after they change it.
  if (now.version) await recordChoice(db, { kind: "ml_consent", userId, value: { granted: now.granted, version: now.version } });
  return now;
}

/**
 * SQL: true when the owner id in `ownerExpr` has consented — their own row, or the account their agent is linked to.
 * For dataset builders: `where ${consentedOwnerSql("c.owner_id")}`.
 */
export const consentedOwnerSql = (ownerExpr: string) =>
  `exists (select 1 from ml_consents mc where mc.granted and (mc.user_id = ${ownerExpr}
     or mc.user_id = (select al.user_id from agent_links al where al.agent_id = ${ownerExpr})))`;
