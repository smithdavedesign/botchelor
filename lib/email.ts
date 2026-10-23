/**
 * Email notifications (Resend, from the Vercel Marketplace on its free plan: $0, 100 a day). The third channel after
 * the in-app inbox and browser push (lib/notifications.ts, lib/push.ts), for players who'd rather hear by email.
 *
 * Built the way email should be:
 *  - **Opt-in only, and confirmed.** Signed-in players choose it on their account page. Their Google sign-in address
 *    is already verified by Google; any other address gets a confirmation link first (double opt-in).
 *  - **Few emails.** Only the moments that need you send at once ("Cass's creator said yes to a second date", "a
 *    second date was booked"), at most 3 a day per person; everything else waits for one daily digest.
 *  - **One click out.** Every email carries a signed unsubscribe link and the List-Unsubscribe headers (RFC 8058),
 *    so mail apps show their own unsubscribe button.
 *  - **Capped.** EMAIL_DAILY_CAP (80) across the show keeps it inside the free plan. Off entirely without
 *    RESEND_API_KEY.
 */
import { createHmac } from "node:crypto";
import { Resend } from "resend";
import type { Db } from "./db";
import { safeEqual } from "./http";
import type { Notification, NotificationKind } from "./notifications";
import { siteUrl } from "./site";

type Env = Record<string, string | undefined>;

/** Kinds worth an email right away: something is waiting on you. Everything else is in the daily digest. */
// #563: a date booked with your character (by another agent or person, private ones too), and a two-agent date invite
// (the same news when the booker plays their own side), go at once as well.
// Connections (M3): your own key nearing its cap, at it, or failing goes at once too: it's your money, and waiting for the
// digest could cost more of it.
export const IMMEDIATE_KINDS: ReadonlySet<NotificationKind> = new Set([
  "second_date_yes",
  "second_date_booked",
  "date_proposal",
  "date_accepted",
  "date_booked_with_yours",
  "own_date_invite",
  "key_usage",
  "key_capped",
  "key_failed",
]);
export const IMMEDIATE_PER_USER_PER_DAY = 3;
/** Confirmation emails one account may send a day (each goes to an address nobody has verified yet). */
export const CONFIRMS_PER_USER_PER_DAY = 3;
export const DIGEST_ITEMS = 8;

export function emailDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.EMAIL_DAILY_CAP?.trim() || 80);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 80;
}

export type EmailConfig = { apiKey: string; from: string };

/** Resend's key and the sender, or null when email isn't set up here. */
export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, from: env.EMAIL_FROM?.trim() || "Botchelor <notifications@botchelor.com>" };
}

/* ------------------------------------------------------ tokens ------------------------------------------------------ */

type Purpose = "confirm" | "unsub";
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mac = (secret: string, data: string) => createHmac("sha256", secret).update(`email:${data}`).digest("base64url");

/** A signed link token: who, which address, what for, and (for a confirmation) until when. */
export function signEmailToken(t: { u: string; e: string; p: Purpose; x?: number }, env: Env = process.env): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const payload = b64(JSON.stringify(t));
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyEmailToken(token: string | null | undefined, purpose: Purpose, env: Env = process.env, now = Date.now()): { u: string; e: string } | null {
  const secret = env.SESSION_SECRET;
  if (!secret || !token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, mac(secret, payload))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: unknown; e?: unknown; p?: unknown; x?: unknown };
    if (typeof t.u !== "string" || typeof t.e !== "string" || t.p !== purpose) return null;
    if (typeof t.x === "number" && t.x < now) return null;
    return { u: t.u, e: t.e };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ sending ------------------------------------------------------ */

export type EmailMessage = { from: string; to: string; subject: string; html: string; text: string; headers: Record<string, string> };
type Sender = (msg: EmailMessage, config: EmailConfig) => Promise<void>;

const resendSender: Sender = async (msg, config) => {
  const { error } = await new Resend(config.apiKey).emails.send({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
  if (error) throw new Error(`resend: ${error.name ?? "error"}`);
};
let sender: Sender = resendSender;
/** Tests swap the network out. */
export function setEmailSenderForTests(s: Sender | null): void {
  sender = s ?? resendSender;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The frame every email shares: the message, then why you got it and the one-click way out. */
function render(intro: string, items: { title: string; body: string | null; link: string | null }[], unsubUrl: string, base: string) {
  const rows = items
    .map((i) => {
      const href = i.link ? `${base}${i.link}` : `${base}/notifications`;
      return `<p style="margin:0 0 14px"><a href="${esc(href)}" style="color:#b52c59;font-weight:600">${esc(i.title)}</a>${i.body ? `<br><span style="color:#6a5a6f">“${esc(i.body)}”</span>` : ""}</p>`;
    })
    .join("");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#241022">` +
    `<p style="font-size:20px;font-weight:700;color:#c82f60;margin:0 0 16px">Botchelor</p>` +
    `<p style="margin:0 0 18px">${esc(intro)}</p>${rows}` +
    `<p style="margin:22px 0 0;font-size:13px;color:#6a5a6f">You get these because you turned on email notifications on Botchelor. ` +
    `<a href="${esc(unsubUrl)}" style="color:#6a5a6f">Unsubscribe</a> · <a href="${esc(`${base}/account`)}" style="color:#6a5a6f">Settings</a></p></div>`;
  const text = `${intro}\n\n${items.map((i) => `${i.title}${i.body ? `\n“${i.body}”` : ""}\n${i.link ? `${base}${i.link}` : `${base}/notifications`}`).join("\n\n")}\n\nUnsubscribe: ${unsubUrl}`;
  return { html, text };
}

/** Sends one email if the show's daily cap allows, and logs it. Returns whether it went. */
async function deliver(db: Db, userId: string, kind: string, to: string, subject: string, items: Parameters<typeof render>[1], intro: string, env: Env = process.env): Promise<boolean> {
  const config = emailConfig(env);
  if (!config) return false;
  const today = (await db.query<{ n: number }>(`select count(*)::int as n from email_sends where created_at > now() - interval '1 day'`)).rows[0]?.n ?? 0;
  if (today >= emailDailyCap(env)) return false;
  const base = siteUrl(env);
  const token = signEmailToken({ u: userId, e: to, p: "unsub" }, env);
  if (!token) return false;
  const unsubPage = `${base}/email/unsubscribe?t=${encodeURIComponent(token)}`;
  const oneClick = `${base}/api/email/optout?t=${encodeURIComponent(token)}`;
  const { html, text } = render(intro, items, unsubPage, base);
  await sender(
    { from: config.from, to, subject, html, text, headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } },
    config,
  );
  await db.query(`insert into email_sends (id, user_id, kind) values ($1, $2, $3)`, [crypto.randomUUID(), userId, kind]);
  return true;
}

/* ------------------------------------------------------ opt-in ------------------------------------------------------ */

export type EmailStatus = { status: "off" | "pending" | "on"; email: string | null; google_email: string | null; available: boolean };

export async function emailStatus(db: Db, userId: string): Promise<EmailStatus> {
  const [prefs, account] = await Promise.all([
    db.query<{ email: string; status: "pending" | "on" | "off" }>(`select email, status from email_prefs where user_id = $1`, [userId]),
    db.query<{ email: string | null; google_sub: string | null }>(`select email, google_sub from accounts where user_id = $1`, [userId]),
  ]);
  const p = prefs.rows[0];
  const a = account.rows[0];
  return {
    status: p?.status ?? "off",
    email: p?.email ?? null,
    google_email: a?.google_sub && a.email ? a.email : null,
    available: emailConfig() !== null,
  };
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
export type OptInResult = { ok: true; status: "on" | "pending" } | { ok: false; status: number; error: string; message: string };

/**
 * Turns email on for a signed-in player. Their Google sign-in address is on at once (Google verified it); any other
 * address is pending until they click the confirmation link we send it.
 */
export async function startEmailOptIn(db: Db, userId: string, requested: string | null, env: Env = process.env, now = Date.now()): Promise<OptInResult> {
  if (!emailConfig(env)) return { ok: false, status: 503, error: "email_unavailable", message: "Email isn't set up here yet." };
  const account = (await db.query<{ email: string | null; google_sub: string | null }>(`select email, google_sub from accounts where user_id = $1`, [userId])).rows[0];
  if (!account) return { ok: false, status: 403, error: "account_required", message: "Sign in or create an account to get email." };
  const googleEmail = account.google_sub && account.email ? account.email.toLowerCase() : null;
  const email = (requested ?? googleEmail ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, status: 422, error: "invalid_email", message: "That doesn't look like an email address." };
  const verified = email === googleEmail;
  await db.query(
    `insert into email_prefs (user_id, email, status, confirmed_at) values ($1, $2, $3, $4)
     on conflict (user_id) do update set email = excluded.email, status = excluded.status, confirmed_at = excluded.confirmed_at, updated_at = now()`,
    [userId, email, verified ? "on" : "pending", verified ? new Date(now).toISOString() : null],
  );
  if (verified) return { ok: true, status: "on" };
  // Confirmation emails go to an address nobody has verified yet, so they're capped: a few per account a day, and
  // inside the show's daily total, so an account can't turn us into a way to mail strangers.
  const counts = (await db.query<{ mine: number; all: number }>(
    `select count(*) filter (where user_id = $1 and kind = 'confirm')::int as mine, count(*)::int as all
       from email_sends where created_at > now() - interval '1 day'`,
    [userId],
  )).rows[0];
  if ((counts?.mine ?? 0) >= CONFIRMS_PER_USER_PER_DAY || (counts?.all ?? 0) >= emailDailyCap(env)) {
    return { ok: false, status: 429, error: "too_many_confirmations", message: "That's enough confirmation emails for today. Try again tomorrow." };
  }
  const token = signEmailToken({ u: userId, e: email, p: "confirm", x: now + 2 * 86_400_000 }, env);
  const config = emailConfig(env)!;
  const base = siteUrl(env);
  const link = `${base}/api/email/confirm?t=${encodeURIComponent(token ?? "")}`;
  try {
    await sender(
      {
        from: config.from,
        to: email,
        subject: "Confirm your email for Botchelor",
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#241022"><p style="font-size:20px;font-weight:700;color:#c82f60">Botchelor</p><p>Click to get emails when your characters text, plan a second date, or move up a stage.</p><p><a href="${esc(link)}" style="color:#b52c59;font-weight:600">Confirm this address</a></p><p style="font-size:13px;color:#6a5a6f">If you didn't ask for this, ignore it: nothing is sent until you confirm.</p></div>`,
        text: `Confirm your email for Botchelor: ${link}\n\nIf you didn't ask for this, ignore it: nothing is sent until you confirm.`,
        headers: {},
      },
      config,
    );
  } catch (err) {
    // The address stays pending, so trying again later works; the player gets a plain answer, not an error page.
    console.error("[email] confirmation send failed:", err instanceof Error ? err.message : "unknown");
    return { ok: false, status: 502, error: "email_failed", message: "Couldn't send the confirmation email right now. Try again in a few minutes." };
  }
  await db.query(`insert into email_sends (id, user_id, kind) values ($1, $2, 'confirm')`, [crypto.randomUUID(), userId]);
  return { ok: true, status: "pending" };
}

/** The confirmation link: turns email on, if the address is still the one being confirmed. */
export async function confirmEmail(db: Db, token: string | null, env: Env = process.env): Promise<boolean> {
  const t = verifyEmailToken(token, "confirm", env);
  if (!t) return false;
  const { rows } = await db.query(
    `update email_prefs set status = 'on', confirmed_at = now(), updated_at = now() where user_id = $1 and email = $2 and status = 'pending' returning user_id`,
    [t.u, t.e],
  );
  return rows.length > 0;
}

/** The unsubscribe link (one click, no sign-in): turns email off for that address. */
export async function unsubscribeEmail(db: Db, token: string | null, env: Env = process.env): Promise<boolean> {
  const t = verifyEmailToken(token, "unsub", env);
  if (!t) return false;
  await db.query(`update email_prefs set status = 'off', updated_at = now() where user_id = $1 and email = $2`, [t.u, t.e]);
  return true;
}

export async function turnOffEmail(db: Db, userId: string): Promise<void> {
  await db.query(`update email_prefs set status = 'off', updated_at = now() where user_id = $1`, [userId]);
}

/* ------------------------------------------------- what gets emailed ------------------------------------------------- */

/** Called for every notification (lib/notifications.ts): emails at once only the kinds that are waiting on you. */
export async function emailNow(
  db: Db,
  userId: string,
  n: { id?: string; kind: NotificationKind; title: string; body?: string | null; link?: string | null },
  env: Env = process.env,
): Promise<boolean> {
  if (!IMMEDIATE_KINDS.has(n.kind) || !emailConfig(env)) return false;
  const p = (await db.query<{ email: string }>(`select email from email_prefs where user_id = $1 and status = 'on'`, [userId])).rows[0];
  if (!p) return false;
  const sentToday = (await db.query<{ n: number }>(
    `select count(*)::int as n from email_sends where user_id = $1 and kind <> 'digest' and kind <> 'confirm' and created_at > now() - interval '1 day'`,
    [userId],
  )).rows[0]?.n ?? 0;
  if (sentToday >= IMMEDIATE_PER_USER_PER_DAY) return false;
  const ok = await deliver(db, userId, n.kind, p.email, n.title.replace(/^\S+\s/, ""), [{ title: n.title, body: n.body ?? null, link: n.link ?? null }], "Something on Botchelor is waiting on you:", env);
  if (ok && n.id) await db.query(`update notifications set emailed_at = now() where id = $1`, [n.id]);
  return ok;
}

/** What a digest gathers: unread, never emailed, from the last week. */
const DIGESTABLE = `n.read_at is null and n.emailed_at is null and n.created_at > now() - interval '7 days'`;

/**
 * The daily digest (the daily job): one email per opted-in player with unread notifications that haven't been
 * emailed yet (the newest DIGEST_ITEMS of them; each is marked, so no email repeats one). Returns how many went.
 */
export async function sendDigests(db: Db, now = new Date(), env: Env = process.env): Promise<number> {
  if (!emailConfig(env)) return 0;
  const { rows } = await db.query<{ user_id: string; email: string }>(
    `select p.user_id, p.email from email_prefs p
      where p.status = 'on' and exists (select 1 from notifications n where n.user_id = p.user_id and ${DIGESTABLE})`,
  );
  let sent = 0;
  for (const r of rows) {
    const items = (await db.query<Notification & { created_at: Date }>(
      `select n.id, n.kind, n.title, n.body, n.link, n.created_at from notifications n
        where n.user_id = $1 and ${DIGESTABLE} order by n.created_at desc limit $2`,
      [r.user_id, DIGEST_ITEMS],
    )).rows;
    if (!items.length) continue;
    const ok = await deliver(
      db,
      r.user_id,
      "digest",
      r.email,
      items.length === 1 ? items[0].title.replace(/^\S+\s/, "") : `${items.length} things happened on Botchelor`,
      items.map((i) => ({ title: i.title, body: i.body, link: i.link })),
      "Here's what happened between dates:",
      env,
    ).catch(() => false);
    if (!ok) break; // the show's cap is reached (or the provider is down): the rest go tomorrow
    await db.query(`update notifications set emailed_at = now() where id = any($1)`, [items.map((i) => i.id)]);
    await db.query(`update email_prefs set last_digest_at = $2, updated_at = now() where user_id = $1`, [r.user_id, now.toISOString()]);
    sent++;
  }
  return sent;
}

/* --------------------------------------------------- account emails --------------------------------------------------- */

export type AccountEmailResult = "sent" | "unavailable" | "capped" | "failed";

/**
 * One email about the account itself that the person just asked for (After Dark's PIN reset code, lib/adult/privacy.ts),
 * to an address the account has already confirmed. Not a notification: no opt-in, and not counted against the
 * per-person notification cap, but it stays inside the show's daily total and is logged with the rest.
 */
export async function sendAccountEmail(
  db: Db,
  userId: string,
  kind: string,
  to: string,
  message: { subject: string; text: string; html: string },
  env: Env = process.env,
): Promise<AccountEmailResult> {
  const config = emailConfig(env);
  if (!config) return "unavailable";
  const today = (await db.query<{ n: number }>(`select count(*)::int as n from email_sends where created_at > now() - interval '1 day'`)).rows[0]?.n ?? 0;
  if (today >= emailDailyCap(env)) return "capped";
  try {
    await sender({ from: config.from, to, subject: message.subject, html: message.html, text: message.text, headers: {} }, config);
  } catch (err) {
    console.error(`[email] ${kind} send failed:`, err instanceof Error ? err.message : "unknown");
    return "failed";
  }
  await db.query(`insert into email_sends (id, user_id, kind) values ($1, $2, $3)`, [crypto.randomUUID(), userId, kind]);
  return "sent";
}
