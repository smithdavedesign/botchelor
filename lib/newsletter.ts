/**
 * The Sunday letter: one email a week from the show, after Sunday's reveal, for anyone who asks for it, account or not
 * (docs/newsletter.md). This is the list; lib/newsletter-issue.ts builds each week's letter and sends it.
 *
 * Built the way a mailing list should be:
 *  - **Asked for, then confirmed.** A sign-up stays pending until the link in its confirmation email is clicked (double
 *    opt-in). The form answers the same for a new, pending or confirmed address, so it can't tell anyone who's on the
 *    list. An address gets a confirmation at most once a day and CONFIRMS_PER_SPELL in all; one nobody confirms is
 *    forgotten after PENDING_DAYS.
 *  - **One click out.** Every email carries a signed unsubscribe link and the List-Unsubscribe headers (RFC 8058). An
 *    address that leaves is kept as unsubscribed, so nothing more goes to it until it signs up and confirms again.
 *  - **Capped.** NEWSLETTER_DAILY_CAP (40) emails a day, inside what's left of the show's EMAIL_DAILY_CAP (lib/email.ts),
 *    with a quarter of it kept for confirmations, so a big week's letter never holds up a sign-up.
 *  - **Lawful first.** No letter goes out until NEWSLETTER_POSTAL_ADDRESS is set (CAN-SPAM asks for one in each);
 *    sign-ups and confirmations work before that. Off entirely without RESEND_API_KEY, and never on After Dark's host:
 *    the letter is the show's, PG only.
 *
 * Kept light (no show modules), since the site footer's sign-up asks it whether the letter is open on every page.
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterDarkOnly } from "./after-dark-host";
import type { Db } from "./db";
import { emailConfig, emailDailyCap, sendEmail, type EmailConfig, type EmailMessage } from "./email";
import { safeEqual } from "./http";
import { siteUrl } from "./site";

type Env = Record<string, string | undefined>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Emails a day the letter may send, confirmations included, when NEWSLETTER_DAILY_CAP isn't set. */
export const DEFAULT_DAILY_CAP = 40;
/** How long a confirmation link works. */
export const CONFIRM_LINK_DAYS = 7;
/** Confirmation emails one pending spell can get, a day apart at least. */
export const CONFIRMS_PER_SPELL = 3;
/** A sign-up nobody confirms is forgotten after this long. */
export const PENDING_DAYS = 30;
/** How long the record of who got which letter is kept. */
export const SENDS_KEEP_DAYS = 90;
/** Sign-ups one connection may make (lib/limits.ts). */
export const SIGNUP_LIMITS = { perHour: 5, perDay: 20 };
/** The confirmations one pass of the hourly job may catch up on. */
const CATCH_UP_PER_PASS = 20;
/** What email_sends calls the letter's emails, so they count toward the show's daily cap too. */
export const SEND_KINDS = { confirm: "newsletter_confirm", letter: "newsletter_letter" } as const;
/** email_sends.user_id for the letter's emails: they belong to no account. */
const SENDER_ID = "newsletter";
/** What the hourly job says while the letter waits for its postal address (app/api/jobs/lobby). */
export const WAITING_FOR_ADDRESS = "waiting for NEWSLETTER_POSTAL_ADDRESS";

/* ------------------------------------------------------ settings ------------------------------------------------------ */

/** An env value that's set: blank, or the CHANGE_ME placeholder .do/show.yaml commits, counts as unset. */
export function envSetting(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v && v !== "CHANGE_ME" ? v : null;
}

/**
 * Resend's key and sender for the letter, or null where it's off: email isn't set up, nothing can sign its links
 * (SESSION_SECRET), or this is After Dark's host.
 */
export function newsletterEmail(env: Env = process.env): EmailConfig | null {
  if (afterDarkOnly(env) || !env.SESSION_SECRET) return null;
  const config = emailConfig(env);
  return config && envSetting(config.apiKey) ? config : null;
}

/** Whether the letter is here at all: its sign-up shows, and takes addresses. */
export const newsletterOpen = (env: Env = process.env): boolean => newsletterEmail(env) !== null;

/** The postal address every letter carries (CAN-SPAM), on one line, or null: no letter goes out without it. */
export function postalAddress(env: Env = process.env): string | null {
  const v = envSetting(env.NEWSLETTER_POSTAL_ADDRESS);
  return v ? v.replace(/\s+/g, " ").slice(0, 200) : null;
}

/** off: no email here; waiting_for_address: sign-ups and confirmations work, no letter goes out yet; on: all of it. */
export type NewsletterState = "off" | "waiting_for_address" | "on";

export function newsletterState(env: Env = process.env): NewsletterState {
  if (!newsletterOpen(env)) return "off";
  return postalAddress(env) ? "on" : "waiting_for_address";
}

/** How many emails the letter may send a day, confirmations included (NEWSLETTER_DAILY_CAP). */
export function newsletterDailyCap(env: Env = process.env): number {
  const raw = envSetting(env.NEWSLETTER_DAILY_CAP);
  const n = raw === null ? DEFAULT_DAILY_CAP : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_DAILY_CAP;
}

/* ------------------------------------------------------- tokens ------------------------------------------------------- */

type Purpose = "confirm" | "unsub";
// Its own context, so a token from the show's other emails (lib/email.ts signs "email:") is no good here, nor one of
// these there.
const mac = (secret: string, data: string) => createHmac("sha256", secret).update(`newsletter:${data}`).digest("base64url");

/** A signed link token for one address: what it's for and, for a confirmation, until when. Null without SESSION_SECRET. */
export function signNewsletterToken(t: { e: string; p: Purpose; x?: number }, env: Env = process.env): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

/** The address a token was made for: only one of ours, for this purpose, and (a confirmation) not past its time. */
export function verifyNewsletterToken(token: string | null | undefined, purpose: Purpose, env: Env = process.env, now = Date.now()): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret || !token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined || !safeEqual(sig, mac(secret, payload))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e?: unknown; p?: unknown; x?: unknown };
    if (typeof t.e !== "string" || !t.e || t.p !== purpose) return null;
    if (purpose === "confirm" && (typeof t.x !== "number" || t.x < now)) return null;
    return t.e;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- list -------------------------------------------------------- */

/**
 * Puts an address on the list: a new one, or one that had left, starts a pending spell; a pending or confirmed one stays
 * as it is, so signing up again changes nothing (and doesn't restart the 30 days). The caller answers the same either way.
 */
export async function addSignUp(db: Db, email: string, now: Date = new Date()): Promise<void> {
  await db.query(
    `insert into newsletter_subscribers (email, status, pending_since, attested_adult_at, created_at, updated_at)
     values ($1, 'pending', $2, $2, $2, $2)
     on conflict (email) do update set status = 'pending', pending_since = $2, confirms_sent = 0, attested_adult_at = $2, updated_at = $2
      where newsletter_subscribers.status = 'unsubscribed'`,
    [email, now.toISOString()],
  );
}

/**
 * The confirmation page's button (app/newsletter/confirm): a pending address goes on the list. True when it's on the list
 * now (a second click too); false for a link that's expired or not ours, or an address that left or was forgotten since.
 */
export async function confirmSubscription(db: Db, token: string | null, now: Date = new Date(), env: Env = process.env): Promise<boolean> {
  const email = verifyNewsletterToken(token, "confirm", env, now.getTime());
  if (!email) return false;
  const done = await db.query(
    `update newsletter_subscribers set status = 'confirmed', confirmed_at = $2, pending_since = null, updated_at = $2
      where email = $1 and status = 'pending' returning email`,
    [email, now.toISOString()],
  );
  if (done.rows.length) return true;
  const row = await db.query<{ status: string }>(`select status from newsletter_subscribers where email = $1`, [email]);
  return row.rows[0]?.status === "confirmed";
}

/**
 * Unsubscribes the address a link was made for: the unsubscribe page's button and mail apps' one-click (RFC 8058) both
 * land here. The address is kept as unsubscribed, with when, so nothing more goes to it until it signs up and confirms
 * again; that holds for an address the list had already forgotten, too. True for any good link.
 */
export async function leaveNewsletter(db: Db, token: string | null, now: Date = new Date(), env: Env = process.env): Promise<boolean> {
  const email = verifyNewsletterToken(token, "unsub", env);
  if (!email) return false;
  await db.query(
    `insert into newsletter_subscribers (email, status, unsubscribed_at, created_at, updated_at) values ($1, 'unsubscribed', $2, $2, $2)
     on conflict (email) do update set status = 'unsubscribed', unsubscribed_at = $2, pending_since = null, updated_at = $2
      where newsletter_subscribers.status <> 'unsubscribed'`,
    [email, now.toISOString()],
  );
  return true;
}

/**
 * The hourly job's tidy: a pending spell nobody confirmed in PENDING_DAYS ends (an address that had left goes back to
 * unsubscribed, any other is deleted), and the record of who got which letter goes after SENDS_KEEP_DAYS.
 */
export async function pruneNewsletter(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_DAYS * DAY_MS).toISOString();
  const back = await db.query(
    `update newsletter_subscribers set status = 'unsubscribed', pending_since = null, updated_at = $2
      where status = 'pending' and pending_since < $1 and unsubscribed_at is not null returning email`,
    [cutoff, now.toISOString()],
  );
  const gone = await db.query(`delete from newsletter_subscribers where status = 'pending' and pending_since < $1 and unsubscribed_at is null returning email`, [cutoff]);
  await db.query(`delete from newsletter_sends where created_at < $1`, [new Date(now.getTime() - SENDS_KEEP_DAYS * DAY_MS).toISOString()]);
  return back.rows.length + gone.rows.length;
}

export type SubscriberCounts = { pending: number; confirmed: number; unsubscribed: number };

export async function subscriberCounts(db: Db): Promise<SubscriberCounts> {
  const { rows } = await db.query<{ status: string; n: number }>(`select status, count(*)::int as n from newsletter_subscribers group by status`);
  const n = (status: string) => rows.find((r) => r.status === status)?.n ?? 0;
  return { pending: n("pending"), confirmed: n("confirmed"), unsubscribed: n("unsubscribed") };
}

/* ------------------------------------------------------- budget ------------------------------------------------------- */

export type NewsletterBudget = { confirms: number; letters: number };

/**
 * How many more emails the letter may send now, over a rolling day as lib/email.ts counts: within NEWSLETTER_DAILY_CAP and
 * what's left of the show's EMAIL_DAILY_CAP. Letters stop a quarter short of the cap, so confirmations always have room.
 */
export async function newsletterBudget(db: Db, env: Env = process.env): Promise<NewsletterBudget> {
  const cap = newsletterDailyCap(env);
  const { rows } = await db.query<{ total: number; ours: number; letters: number }>(
    `select count(*)::int as total,
            count(*) filter (where kind = $1 or kind = $2)::int as ours,
            count(*) filter (where kind = $2)::int as letters
       from email_sends where created_at > now() - interval '1 day'`,
    [SEND_KINDS.confirm, SEND_KINDS.letter],
  );
  const used = rows[0] ?? { total: 0, ours: 0, letters: 0 };
  const confirms = Math.max(0, Math.min(cap - used.ours, emailDailyCap(env) - used.total));
  return { confirms, letters: Math.max(0, Math.min(confirms, cap - Math.ceil(cap / 4) - used.letters)) };
}

/** Logs one of the letter's emails where the show's daily cap counts them (lib/email.ts). */
export async function logNewsletterSend(db: Db, kind: (typeof SEND_KINDS)[keyof typeof SEND_KINDS]): Promise<void> {
  await db.query(`insert into email_sends (id, user_id, kind) values ($1, $2, $3)`, [randomUUID(), SENDER_ID, kind]);
}

/** A wait between sends, so a batch keeps under Resend's rate limit. */
export const pause = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/* ------------------------------------------------------- emails ------------------------------------------------------- */

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The colours lib/email.ts draws the show's emails in. */
export const EMAIL_COLOURS = { ink: "#241022", brand: "#c82f60", link: "#b52c59", muted: "#6a5a6f" } as const;

/** Every email from the list in the show's frame: the name, the message, the small print. */
function frame(body: string, foot: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:${EMAIL_COLOURS.ink};line-height:1.5">` +
    `<p style="font-size:20px;font-weight:700;color:${EMAIL_COLOURS.brand};margin:0 0 16px">Botchelor</p>${body}${foot}</div>`
  );
}

/** An email's ways out for its address: the unsubscribe page, and the address mail apps post their one click to. */
function waysOut(email: string, env: Env): { page: string; oneClick: string } | null {
  const token = signNewsletterToken({ e: email, p: "unsub" }, env);
  if (!token) return null;
  const base = siteUrl(env);
  const t = encodeURIComponent(token);
  return { page: `${base}/newsletter/unsubscribe?t=${t}`, oneClick: `${base}/api/newsletter/optout?t=${t}` };
}

/** The small print every email from the list ends with: why it came, the way out, and the postal address once it's set. */
function smallPrint(why: string, unsubscribe: string, postal: string | null): { html: string; text: string } {
  const html =
    `<p style="margin:24px 0 0;font-size:13px;color:${EMAIL_COLOURS.muted}">${escapeHtml(why)} ` +
    `<a href="${escapeHtml(unsubscribe)}" style="color:${EMAIL_COLOURS.muted}">Unsubscribe</a>` +
    `${postal ? `<br>Botchelor · ${escapeHtml(postal)}` : ""}</p>`;
  return { html, text: `${why}\nUnsubscribe: ${unsubscribe}${postal ? `\nBotchelor · ${postal}` : ""}` };
}

/** The List-Unsubscribe headers (RFC 8058): mail apps show their own unsubscribe button, and one click of it is enough. */
const listHeaders = (oneClick: string): Record<string, string> => ({ "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

/** The confirmation email: the link that starts the letter (good for CONFIRM_LINK_DAYS), and the way out. */
export function confirmationEmail(email: string, config: EmailConfig, now: Date = new Date(), env: Env = process.env): EmailMessage | null {
  const token = signNewsletterToken({ e: email, p: "confirm", x: now.getTime() + CONFIRM_LINK_DAYS * DAY_MS }, env);
  const out = waysOut(email, env);
  if (!token || !out) return null;
  const link = `${siteUrl(env)}/newsletter/confirm?t=${encodeURIComponent(token)}`;
  const intro =
    "Someone asked for the Sunday letter at this address: one email a week from Botchelor, after Sunday's reveal, with whose secret came out and the week's best dates.";
  const after = `The link works for ${CONFIRM_LINK_DAYS} days. If it wasn't you, ignore this email: no letter comes unless the link is clicked.`;
  const foot = smallPrint("You got this because this address was entered in the Sunday letter's sign-up on botchelor.com.", out.page, postalAddress(env));
  const html = frame(
    `<p style="margin:0 0 18px">${escapeHtml(intro)}</p>` +
      `<p style="margin:0 0 18px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 20px;border-radius:999px;background:${EMAIL_COLOURS.brand};color:#ffffff;font-weight:700;text-decoration:none">Yes, send me the letter</a></p>` +
      `<p style="margin:0;color:${EMAIL_COLOURS.muted}">${escapeHtml(after)}</p>`,
    foot.html,
  );
  return {
    from: config.from,
    to: email,
    subject: "Confirm the Sunday letter from Botchelor",
    html,
    text: `${intro}\n\nYes, send me the letter: ${link}\n\n${after}\n\n${foot.text}`,
    headers: listHeaders(out.oneClick),
  };
}

/** A week's letter to one address: the issue's body, then the small print with the postal address and this address's way out. */
export function letterEmail(issue: { subject: string; html: string; text: string }, email: string, config: EmailConfig, env: Env = process.env): EmailMessage | null {
  const postal = postalAddress(env);
  const out = waysOut(email, env);
  if (!postal || !out) return null;
  const foot = smallPrint("You get the Sunday letter because you signed up for it on botchelor.com and confirmed your address.", out.page, postal);
  return { from: config.from, to: email, subject: issue.subject, html: frame(issue.html, foot.html), text: `${issue.text}\n\n${foot.text}`, headers: listHeaders(out.oneClick) };
}

export type ConfirmSend = "sent" | "capped" | "not_due" | "failed";

/**
 * Sends an address its confirmation email when it's due one: pending, nothing tried in the last day, fewer than
 * CONFIRMS_PER_SPELL sent this spell, and room left in the day's emails. The try is claimed before the send, so two
 * sign-ups at once send one email; one that failed waits a day, then the hourly job tries again (catchUpConfirmations).
 */
export async function sendConfirmation(db: Db, email: string, now: Date = new Date(), env: Env = process.env): Promise<ConfirmSend> {
  const config = newsletterEmail(env);
  if (!config) return "not_due";
  if ((await newsletterBudget(db, env)).confirms <= 0) return "capped";
  const claimed = await db.query(
    `update newsletter_subscribers set confirm_tried_at = $2, updated_at = $2
      where email = $1 and status = 'pending' and confirms_sent < $3 and (confirm_tried_at is null or confirm_tried_at <= $4)
      returning email`,
    [email, now.toISOString(), CONFIRMS_PER_SPELL, new Date(now.getTime() - DAY_MS).toISOString()],
  );
  if (!claimed.rows.length) return "not_due";
  const msg = confirmationEmail(email, config, now, env);
  if (!msg) return "not_due";
  try {
    await sendEmail(msg, config);
  } catch (err) {
    console.error("[newsletter] confirmation failed:", err instanceof Error ? err.message : "unknown");
    return "failed";
  }
  await db.query(`update newsletter_subscribers set confirm_sent_at = $2, confirms_sent = confirms_sent + 1 where email = $1`, [email, now.toISOString()]);
  await logNewsletterSend(db, SEND_KINDS.confirm);
  return "sent";
}

/**
 * The confirmations that couldn't go at sign-up (the day's emails were used up) or whose send failed: from the hourly
 * job, oldest sign-up first, while there's room and time. Never a second one to an address that got one: that takes the
 * person signing up again.
 */
export async function catchUpConfirmations(db: Db, now: Date = new Date(), env: Env = process.env, opts: { until?: number; pauseMs?: number } = {}): Promise<number> {
  const { rows } = await db.query<{ email: string }>(
    `select email from newsletter_subscribers
      where status = 'pending' and confirms_sent = 0 and (confirm_tried_at is null or confirm_tried_at <= $1)
      order by pending_since, email limit $2`,
    [new Date(now.getTime() - DAY_MS).toISOString(), CATCH_UP_PER_PASS],
  );
  let sent = 0;
  for (const { email } of rows) {
    if (opts.until !== undefined && Date.now() > opts.until) break;
    const result = await sendConfirmation(db, email, now, env);
    // Out of room for today, or the provider is refusing: the next pass picks it up.
    if (result === "capped" || result === "failed") break;
    if (result === "sent") {
      sent++;
      await pause(opts.pauseMs ?? 0);
    }
  }
  return sent;
}

/* ------------------------------------------------------- status ------------------------------------------------------- */

export type NewsletterStatus = {
  state: NewsletterState;
  daily_cap: number;
  subscribers: SubscriberCounts;
  /** The letter's emails in the last 24 hours, and what's left of the day. */
  sent_today: { confirmations: number; letters: number };
  budget: NewsletterBudget;
  issues: { id: string; week_id: string; subject: string; built_at: string; sent: number }[];
};

/** The admin's view (app/api/admin/newsletter): counts only, never an address. */
export async function newsletterStatus(db: Db, env: Env = process.env): Promise<NewsletterStatus> {
  const [subscribers, today, budget, issues] = await Promise.all([
    subscriberCounts(db),
    db.query<{ confirmations: number; letters: number }>(
      `select count(*) filter (where kind = $1)::int as confirmations, count(*) filter (where kind = $2)::int as letters
         from email_sends where created_at > now() - interval '1 day'`,
      [SEND_KINDS.confirm, SEND_KINDS.letter],
    ),
    newsletterBudget(db, env),
    db.query<{ id: string; week_id: string; subject: string; built_at: string | Date; sent: number }>(
      `select id, week_id, subject, built_at, sent from newsletter_issues order by built_at desc limit 8`,
    ),
  ]);
  return {
    state: newsletterState(env),
    daily_cap: newsletterDailyCap(env),
    subscribers,
    sent_today: today.rows[0] ?? { confirmations: 0, letters: 0 },
    budget,
    issues: issues.rows.map((i) => ({ ...i, built_at: new Date(i.built_at).toISOString() })),
  };
}
