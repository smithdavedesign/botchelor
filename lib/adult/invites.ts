/**
 * The invite-only beta (David, 2026-10-31: "Make it invite only, email me and I approve. Free for starters, I'll foot
 * the bill, but not video generation, that's on them. Include that in the welcome email."):
 *  - A signed-in person asks on the subscribe page (app/api/after-dark/invite), once. The request emails the operator
 *    and every admin with a confirmed address (lib/content-reports.ts reportRecipients) a signed review link.
 *  - The link opens a page (app/invites/review) with Approve and Decline. It's a page, not an action, so a mail
 *    scanner that opens links can't approve anyone; the buttons post (app/api/invites/review).
 *  - Approving writes a beta pass (adult_entitlements provider 'beta', BETA_DAYS long) and emails the welcome: scenes
 *    and pictures on the house, video on them (lib/adult/pricing.ts clipsIncluded leaves beta out of the clip allowance).
 */
import { createHmac } from "node:crypto";
import { reportRecipients } from "../content-reports";
import type { Db } from "../db";
import { sendAccountEmail } from "../email";
import { safeEqual } from "../http";
import { contactEmail } from "../legal-entity";
import { siteUrl } from "../site";
import { BETA_PROVIDER } from "./entitlement";
import { getAdultSettings } from "./settings";

type Env = Record<string, string | undefined>;

/** How long a beta pass lasts. */
export const BETA_DAYS = 30;
/** How long a review link works. */
export const REVIEW_LINK_DAYS = 30;
/** The longest note a request carries. */
export const NOTE_MAX = 500;

export type InviteStatus = "pending" | "approved" | "declined";
export type Invite = { user_id: string; email: string; note: string | null; country: string | null; status: InviteStatus; requested_at: string; decided_at: string | null };

export async function getInvite(db: Db, userId: string): Promise<Invite | null> {
  const r = await db.query<Invite>(
    `select user_id, email, note, country, status, requested_at::text as requested_at, decided_at::text as decided_at from adult_invites where user_id = $1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

/** Records a request, once a person: a new one is pending; an existing one is left as it is and returned. */
export async function requestInvite(db: Db, userId: string, input: { email: string; note: string | null; country: string | null }): Promise<{ invite: Invite; created: boolean }> {
  const note = input.note?.trim().slice(0, NOTE_MAX) || null;
  const inserted = await db.query(
    `insert into adult_invites (user_id, email, note, country) values ($1, $2, $3, $4) on conflict (user_id) do nothing returning user_id`,
    [userId, input.email, note, input.country],
  );
  return { invite: (await getInvite(db, userId))!, created: inserted.rows.length > 0 };
}

/* ------------------------------------------------------ the review link ------------------------------------------------------ */

const mac = (secret: string, data: string) => createHmac("sha256", secret).update(`invite:${data}`).digest("base64url");

/** A signed link token for reviewing one person's request, until `days` from now. Null without SESSION_SECRET. */
export function signReviewToken(userId: string, env: Env = process.env, now = Date.now(), days = REVIEW_LINK_DAYS): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ u: userId, x: now + days * 86_400_000 })).toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

/** The person a review token is for, or null when it's forged, malformed or expired. */
export function verifyReviewToken(token: string | null | undefined, env: Env = process.env, now = Date.now()): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret || !token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, mac(secret, payload))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: unknown; x?: unknown };
    if (typeof t.u !== "string" || typeof t.x !== "number" || t.x < now) return null;
    return t.u;
  } catch {
    return null;
  }
}

export const reviewUrl = (token: string, env: Env = process.env) => `${siteUrl(env)}/invites/review?t=${encodeURIComponent(token)}`;

/* ------------------------------------------------------ deciding ------------------------------------------------------ */

/**
 * Approves or declines a pending request. Approving writes the beta pass (active, BETA_DAYS from now; the 18+
 * declaration was recorded with the request) and sends the welcome. A request that's already decided is left alone.
 */
export async function decideInvite(
  db: Db,
  userId: string,
  decision: "approved" | "declined",
  env: Env = process.env,
  now: Date = new Date(),
): Promise<{ ok: true; invite: Invite; welcomed: boolean } | { ok: false; why: "not_found" | "already_decided"; invite: Invite | null }> {
  const invite = await getInvite(db, userId);
  if (!invite) return { ok: false, why: "not_found", invite: null };
  if (invite.status !== "pending") return { ok: false, why: "already_decided", invite };
  const updated = await db.query(`update adult_invites set status = $2, decided_at = $3 where user_id = $1 and status = 'pending' returning user_id`, [
    userId,
    decision,
    now.toISOString(),
  ]);
  if (!updated.rows.length) return { ok: false, why: "already_decided", invite: await getInvite(db, userId) };
  let welcomed = false;
  if (decision === "approved") {
    const end = new Date(now.getTime() + BETA_DAYS * 86_400_000);
    await db.query(
      `insert into adult_entitlements (user_id, subscription_status, period_end, provider, age_verified_at, age_method, age_country, updated_at)
       values ($1, 'active', $2, $3, $4, 'self_declared', $5, now())
       on conflict (user_id) do update set subscription_status = 'active', period_end = excluded.period_end, provider = excluded.provider,
         age_verified_at = coalesce(adult_entitlements.age_verified_at, excluded.age_verified_at),
         age_method = coalesce(adult_entitlements.age_method, excluded.age_method), updated_at = now()`,
      [userId, end.toISOString(), BETA_PROVIDER, invite.requested_at, invite.country],
    );
    const settings = await getAdultSettings(db).catch(() => null);
    const message = welcomeEmail({ base: siteUrl(env), until: end, clipTokens: settings?.clip_tokens ?? 1, reelTokens: settings?.reel_tokens ?? 7 });
    // The welcome asks for replies: send them to the operator, not the no-reply sender.
    welcomed = (await sendAccountEmail(db, userId, "ad_invite_welcome", invite.email, { ...message, replyTo: contactEmail(env) }, env)) === "sent";
  }
  return { ok: true, invite: (await getInvite(db, userId))!, welcomed };
}

/* ------------------------------------------------------ the emails ------------------------------------------------------ */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tokens = (n: number) => `${n} token${n === 1 ? "" : "s"}`;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function frame(lines: string[], links: { label: string; href: string }[]) {
  const text = `${lines.join("\n\n")}\n\n${links.map((l) => `${l.label}: ${l.href}`).join("\n")}\n`;
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#241022">` +
    `<p style="font-size:20px;font-weight:700;color:#c82f60;margin:0 0 16px">Botchelor</p>` +
    lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join("") +
    `<p style="margin:0 0 14px">${links.map((l) => `<a href="${esc(l.href)}" style="color:#b52c59;font-weight:600">${esc(l.label)}</a>`).join(" · ")}</p></div>`;
  return { text, html };
}

/**
 * The welcome, on approval. Discreet like the subscription emails (lib/adult/billing.ts): the subject and the preview
 * don't say what After Dark is. It says what's free (scenes and pictures, for BETA_DAYS) and what isn't (video).
 */
export function welcomeEmail(opts: { base: string; until: Date; clipTokens: number; reelTokens: number }) {
  const base = opts.base.replace(/\/+$/, "");
  const { text, html } = frame(
    [
      "You're in: your invite to After Dark on Botchelor is approved.",
      `It's free until ${day(opts.until)}. Every chapter and the pictures are on us, within the month's fair-use limits.`,
      `Video isn't included: that one's on you. Each clip costs ${tokens(opts.clipTokens)} and the video of the night ${tokens(opts.reelTokens)}. Tokens come in packs from the shop.`,
      "It's an early beta, so some things may be rough. Reply to this email with anything you notice, or anything you'd like to see.",
    ],
    [
      { label: "Start", href: `${base}/after-dark` },
      { label: "Shop", href: `${base}/shop` },
    ],
  );
  return { subject: "Your Botchelor invite", text, html };
}

/** The request, to the operator: who, from where, their note, and the review link. */
export function requestEmail(invite: Invite, link: string, pending: number) {
  const { text, html } = frame(
    [
      `${invite.email} asked for an After Dark invite.`,
      `Account: ${invite.user_id}`,
      `Connecting from: ${invite.country ?? "unknown"}`,
      `Their note: ${invite.note ?? "(none)"}`,
      `Approving gives them ${BETA_DAYS} days free: scenes and pictures on you, video on them (the welcome email says so). ${pending} request${pending === 1 ? "" : "s"} waiting.`,
    ],
    [{ label: "Approve or decline", href: link }],
  );
  return { subject: `After Dark invite request: ${invite.email}`, text, html };
}

/** Emails the request to the operator and every admin with a confirmed address. Returns how many went. */
export async function emailRequest(db: Db, invite: Invite, env: Env = process.env): Promise<number> {
  const token = signReviewToken(invite.user_id, env);
  if (!token) return 0;
  const pending = Number((await db.query<{ n: number }>(`select count(*)::int as n from adult_invites where status = 'pending'`)).rows[0]?.n ?? 0);
  const message = requestEmail(invite, reviewUrl(token, env), pending);
  let sent = 0;
  for (const { userId, email } of await reportRecipients(db, env)) {
    if ((await sendAccountEmail(db, userId, "ad_invite_request", email, message, env)) === "sent") sent++;
  }
  return sent;
}
