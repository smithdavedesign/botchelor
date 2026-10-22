/**
 * Opt-in consent to use a person's Botchelor data for machine learning: training, fine-tuning, evaluation datasets
 * (David, 2026-10-22). Opt-in, per account, and revocable: no row, or `granted = false`, means no. docs/data-plan.md
 * sets out what it covers.
 *
 * What it gates: only what goes INTO a dataset. The show still records what it records (that's how it runs), but a
 * dataset builder must filter every row through `consentedOwnerSql` — the characters on a date AND the people whose
 * votes it reads — and, separately, to aired public dates only; private, unlisted and After Dark data never enters a
 * dataset, whatever the consent says (scripts/eval/export-preferences.mjs).
 *
 * Wording: a consent counts only for the wording it was given to (`ML_CONSENT_VERSION`). When that changes, everyone
 * who opted in under the old wording counts as no until they opt in again.
 *
 * Agents: an MCP agent's characters belong to its agent id; when the agent is linked to a person's account
 * (agent_links), the person's choice covers what the agent did from the moment of that link on. A relinked agent's past
 * belongs to whoever it played for then, so the new account's consent never reaches back over it. House characters
 * belong to the show and need no consent.
 */
import { recordChoice } from "./choice-history";
import type { Db } from "./db";

/** The wording version a person agreed to: bump it when the privacy page's training sentence changes meaning. */
export const ML_CONSENT_VERSION = "2026-10-22";
// It's written into SQL as a literal (consentedOwnerSql), so it stays a plain token.
if (!/^[\w.-]+$/.test(ML_CONSENT_VERSION)) throw new Error("ML_CONSENT_VERSION must be letters, digits, dots and dashes");

/**
 * `granted` is whether the consent counts now: on, and for the current wording. `outdated` says the person said yes to
 * an older wording, so the account page can ask again.
 */
export type MlConsent = { granted: boolean; version: string | null; decided_at: string | null; outdated?: true };

export async function getMlConsent(db: Db, userId: string): Promise<MlConsent> {
  const r = (await db.query<{ granted: boolean; version: string; decided_at: string | Date }>(`select granted, version, decided_at from ml_consents where user_id = $1`, [userId]))
    .rows[0];
  if (!r) return { granted: false, version: null, decided_at: null };
  const current = r.version === ML_CONSENT_VERSION;
  return { granted: r.granted && current, version: r.version, decided_at: new Date(r.decided_at).toISOString(), ...(r.granted && !current ? { outdated: true as const } : {}) };
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
 * SQL: true when the owner id in `ownerExpr` has consented, for the current wording — their own row, or the account
 * their agent was linked to at `atExpr` (the time of the date or the vote: a link made later covers nothing earlier).
 * The one definition every dataset builder uses (scripts/eval/export-preferences.mjs loads this module, never a copy):
 * `where ${consentedOwnerSql("c.owner_id", "e.created_at")}`.
 */
export const consentedOwnerSql = (ownerExpr: string, atExpr: string) =>
  `exists (select 1 from ml_consents mc where mc.granted and mc.version = '${ML_CONSENT_VERSION}' and (mc.user_id = ${ownerExpr}
     or mc.user_id = (select al.user_id from agent_links al where al.agent_id = ${ownerExpr} and al.linked_at <= ${atExpr})))`;
