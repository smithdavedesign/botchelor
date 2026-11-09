/**
 * A real age check through Didit (didit.me; David, 2026-11-09: "Didit"), for the places where the law asks for one before
 * After Dark: the UK (pictures, video and voice), Australia and Brazil (all of it). lib/jurisdiction.ts VERIFY_OPENS
 * names them; a pass changes nothing anywhere else.
 *
 * Built and off: with DIDIT_API_KEY, DIDIT_WORKFLOW_ID and DIDIT_WEBHOOK_SECRET not all set, no session is made, no pass
 * counts, and every place is what it was (diditOn).
 *
 * The flow: the person asks (app/api/after-dark/verify), we create a Didit session for the workflow (an age estimation
 * from a selfie on the liveness step, with an ID check as the workflow's fallback for borderline ages) and send them to
 * Didit's hosted page. Didit sends them back to app/api/after-dark/verify/return, where we read the decision from Didit's
 * API ourselves (the query string is only a hint), and it also posts a signed webhook to
 * app/api/after-dark/verify/webhook. Either way lands in recordAgeResult, which is idempotent.
 *
 * What we keep (adult_age_checks): passed or not, the method ('didit'), when, and the country they verified from. Never
 * the selfie, an ID, a birth date, an estimated age or Didit's payload. A pass lasts AGE_PASS_DAYS, then they verify
 * again.
 *
 * Didit's docs, read 2026-11-09:
 *  - Create a session: https://docs.didit.me/sessions-api/create-session (POST https://verification.didit.me/v3/session/,
 *    x-api-key, body workflow_id + vendor_data + callback + metadata; answers session_id + url; the callback gets
 *    ?verificationSessionId=&status=).
 *  - Read a decision: https://docs.didit.me/sessions-api/retrieve-session (GET /v3/session/{id}/decision/).
 *  - Webhooks: https://docs.didit.me/integration/webhooks (X-Timestamp within 300 s; X-Signature = HMAC-SHA256 hex of
 *    the raw body; X-Signature-V2 = the same over the body's canonical JSON, keys sorted, compact; -Previous variants
 *    for 24 h after the secret is rotated; status "Approved" / "Declined" / ...; vendor_data and metadata echoed back).
 *  - Age estimation: https://docs.didit.me/core-technology/age-estimation/overview (Mode A: age estimation on the
 *    workflow's liveness node, age_estimation_decline_threshold 18; "Adaptive Age Verification" sends borderline ages to
 *    an ID check). Didit's own price claim: about $0.10 an age estimate.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db";
import { verifyOpens, type Access } from "../jurisdiction";
import { billingFlagged } from "./billing";

/** Didit's verification API. */
export const DIDIT_API = "https://verification.didit.me";
/** How long a pass lasts. */
export const AGE_PASS_DAYS = 365;
/** How far a webhook's X-Timestamp may be from now (Didit's docs: reject past 300 seconds). */
export const WEBHOOK_TOLERANCE_S = 300;
/** Session starts per person (and per address): each one can cost a check. */
export const VERIFY_LIMITS = { perHour: 3, perDay: 6 };

type Env = Record<string, string | undefined>;
export type DiditConfig = { apiKey: string; workflowId: string; webhookSecret: string };

/** Didit's settings, or null while any is missing (the feature is then off). */
export function diditConfig(env: Env = process.env): DiditConfig | null {
  const apiKey = env.DIDIT_API_KEY?.trim();
  const workflowId = env.DIDIT_WORKFLOW_ID?.trim();
  const webhookSecret = env.DIDIT_WEBHOOK_SECRET?.trim();
  return apiKey && workflowId && webhookSecret ? { apiKey, workflowId, webhookSecret } : null;
}

/** Whether age checks are on. */
export const diditOn = (env: Env = process.env): boolean => diditConfig(env) !== null;

export type AgeCheckState = "passed" | "failed" | "none";

/** Where this person's age check stands: a current pass, a failed last try, or nothing (or expired, or the feature off). */
export async function ageCheckState(db: Db, userId: string, now: Date = new Date()): Promise<AgeCheckState> {
  if (!diditOn()) return "none";
  const row = (await db.query<{ passed: boolean; checked_at: Date | string }>(`select passed, checked_at from adult_age_checks where user_id = $1`, [userId])).rows[0];
  if (!row) return "none";
  if (!row.passed) return "failed";
  return new Date(row.checked_at).getTime() > now.getTime() - AGE_PASS_DAYS * 86_400_000 ? "passed" : "none";
}

/** Whether this person holds a current pass (and the feature is on). */
export const hasAgePass = async (db: Db, userId: string, now: Date = new Date()): Promise<boolean> => (await ageCheckState(db, userId, now)) === "passed";

/**
 * Whether to offer "Verify your age" to this person here: the feature on, a signed-in person, a place a pass would open
 * further (and isn't open to them yet), and someone who could use After Dark once it opens (entitled already, or able to
 * start the taste, ask for an invite or subscribe: not held by a chargeback or refund flag). "failed" when they tried
 * and didn't pass (they may try again).
 */
export async function ageCheckOffer(db: Db, here: Access & { userId?: string | null; entitled: { ok: boolean } }): Promise<"offer" | "failed" | null> {
  if (!diditOn() || !here.userId || here.mode === "open" || !verifyOpens(here.place)) return null;
  if (!here.entitled.ok && (await billingFlagged(db, here.userId))) return null;
  return (await ageCheckState(db, here.userId)) === "failed" ? "failed" : "offer";
}

const country = (value: unknown): string | null => (typeof value === "string" && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null);

export type AgeOutcome = "passed" | "failed" | "pending" | "ignored";

/** What a Didit status means for us: only Approved passes and only Declined fails; anything else is still on its way. */
export function outcomeOf(status: unknown): Exclude<AgeOutcome, "ignored"> {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (s === "approved") return "passed";
  if (s === "declined") return "failed";
  return "pending";
}

/**
 * Records a decided check, idempotently: a current pass is never overwritten (a replayed or late webhook, or a decline
 * arriving after a pass, changes nothing), so a pass's year runs from when it was first recorded. Anything else (no
 * row, a failed try, an expired pass) takes the new result.
 */
export async function recordAgeResult(db: Db, userId: string, passed: boolean, where: string | null, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - AGE_PASS_DAYS * 86_400_000).toISOString();
  const r = await db.query(
    `insert into adult_age_checks (user_id, passed, method, checked_at, country) values ($1, $2, 'didit', $3, $4)
     on conflict (user_id) do update set passed = excluded.passed, method = excluded.method, checked_at = excluded.checked_at, country = excluded.country
       where not (adult_age_checks.passed and adult_age_checks.checked_at > $5)
     returning user_id`,
    [userId, passed, now.toISOString(), country(where), since],
  );
  return r.rows.length > 0;
}

/** Applies a Didit decision (a webhook's body or the decision API's answer) for the person it names. */
export async function applyDecision(db: Db, body: { status?: unknown; vendor_data?: unknown; metadata?: unknown }, expectUser?: string): Promise<AgeOutcome> {
  const userId = typeof body.vendor_data === "string" ? body.vendor_data : null;
  if (!userId || (expectUser !== undefined && userId !== expectUser)) return "ignored";
  const outcome = outcomeOf(body.status);
  if (outcome === "pending") return outcome;
  const meta = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {};
  await recordAgeResult(db, userId, outcome === "passed", country(meta.country));
  return outcome;
}

/** Starts a Didit session for this person; the url of Didit's page to send them to. Throws when Didit refuses. */
export async function createAgeSession(userId: string, where: string | null, callback: string, config: DiditConfig): Promise<{ sessionId: string; url: string }> {
  const res = await fetch(`${DIDIT_API}/v3/session/`, {
    method: "POST",
    headers: { "x-api-key": config.apiKey, "content-type": "application/json" },
    body: JSON.stringify({ workflow_id: config.workflowId, vendor_data: userId, callback, metadata: { country: country(where) } }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { session_id?: unknown; url?: unknown };
  if (!res.ok || typeof data.url !== "string" || typeof data.session_id !== "string") throw new Error(`didit session failed (${res.status})`);
  return { sessionId: data.session_id, url: data.url };
}

/** Reads a session's decision from Didit. */
export async function fetchDecision(sessionId: string, config: DiditConfig): Promise<{ status?: unknown; vendor_data?: unknown; metadata?: unknown }> {
  const res = await fetch(`${DIDIT_API}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
    headers: { "x-api-key": config.apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`didit decision failed (${res.status})`);
  return (await res.json()) as { status?: unknown; vendor_data?: unknown; metadata?: unknown };
}

/** Didit's canonical JSON for X-Signature-V2: keys sorted at every level, compact, Unicode kept. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const hmac = (secret: string, text: string): string => createHmac("sha256", secret).update(text, "utf8").digest("hex");

function sameHex(given: string | null, expected: string): boolean {
  const g = given?.trim().toLowerCase() ?? "";
  if (g.length !== expected.length || !/^[0-9a-f]+$/.test(g)) return false;
  return timingSafeEqual(Buffer.from(g, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Whether a webhook is Didit's: X-Timestamp within WEBHOOK_TOLERANCE_S, and X-Signature over the raw body or
 * X-Signature-V2 over its canonical JSON (or either's -Previous twin, during a secret rotation) matches our secret.
 * The deprecated X-Signature-Simple signs only the envelope, so it isn't accepted.
 */
export function diditSignatureOk(raw: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const ts = Number(headers.get("x-timestamp"));
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > WEBHOOK_TOLERANCE_S) return false;
  const rawSig = hmac(secret, raw);
  if (sameHex(headers.get("x-signature"), rawSig) || sameHex(headers.get("x-signature-previous"), rawSig)) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const v2 = hmac(secret, canonicalJson(parsed));
  return sameHex(headers.get("x-signature-v2"), v2) || sameHex(headers.get("x-signature-v2-previous"), v2);
}
