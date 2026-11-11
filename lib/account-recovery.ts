/**
 * Getting back into a handle-and-password account (2026-11-10, the company pass). A handle needs no email, so until now
 * a forgotten password lost the account for good: its characters, its dates and anything bought on it.
 *
 *  - **A recovery email**, which the owner adds on the account page. Adding it takes the current password, so someone
 *    with a signed-in browser for a minute can't put their own address on the account and take it later. It counts once
 *    its link is clicked, or at once when it's an address this account already confirmed for its notifications. It lives
 *    in `accounts.email`, the column a Google sign-in fills with Google's verified address, so an address is on one
 *    account at most.
 *  - **"Forgot your password?"** takes the handle or that address and always gives the same answer, so nobody can use it
 *    to learn whether a handle or an address has an account. The link goes only to the recovery email. It lasts an hour
 *    and works once, because it's signed together with the password's hash: a new password, from the link or from the
 *    account page, ends it.
 *  - **Changing the password** takes the current one. Wrong tries here count as failed sign-ins (lib/login-guard.ts), so
 *    neither form gets round the sign-in limits.
 *  - **A note to the owner** whenever the password or the recovery email changes, at the address the account had before,
 *    so a change they didn't make doesn't go unseen.
 *
 * Sessions are signed cookies with no server-side store (lib/auth.ts), so a new password doesn't sign other browsers out.
 * The emails' links open pages under /email/ (no 18+ gate there), and each page acts only on a button, so a mail
 * scanner that opens links changes nothing.
 */
import { createHmac } from "node:crypto";
import { maskEmail } from "./adult/discreet";
import { accountForUser, hashPassword, normaliseHandle, PASSWORD_MAX, PASSWORD_MIN, verifyPassword, type Account } from "./auth";
import type { Db } from "./db";
import { emailConfig, sendAccountEmail } from "./email";
import { ApiError, safeEqual } from "./http";
import { contactEmail } from "./legal-entity";
import { LOGIN_WINDOW_MINUTES, loginHeld, recordLoginFailure } from "./login-guard";
import { siteUrl } from "./site";

type Env = Record<string, string | undefined>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** How long a reset link works. It also stops once the password changes. */
export const RESET_LINK_MINUTES = 60;
/** How long a recovery email's confirmation link works. */
export const ADDRESS_LINK_DAYS = 2;
/** Reset links one account can be sent a day, and never two within a minute. */
export const RESETS_PER_DAY = 3;
/** Confirmation links one account can send a day: each goes to an address nobody has confirmed yet. */
export const ADDRESS_CONFIRMS_PER_DAY = 3;
/** "Forgot your password?" from one connection. */
export const FORGOT_LIMITS = { perHour: 5, perDay: 20 };
/** The one answer "Forgot your password?" gives, whatever was asked about. */
export const FORGOT_ANSWER =
  `If that account has a recovery email, a link to choose a new password is on its way. It works for an hour. ` +
  `Signed up with Google? Use Continue with Google instead: there's no password to reset.`;

/** What each email is logged as in email_sends (the per-account caps count these). */
export const RECOVERY_KINDS = {
  reset: "password_reset",
  confirm: "recovery_confirm",
  passwordChanged: "password_changed",
  addressChanged: "recovery_changed",
} as const;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const ACCOUNT_COLUMNS = "user_id, handle, handle_display, email, google_sub, password_hash";

/* ------------------------------------------------------ links ------------------------------------------------------ */

const mac = (secret: string, data: string) => createHmac("sha256", secret).update(`account-recovery:${data}`).digest("base64url");
const encode = (claims: Record<string, unknown>) => Buffer.from(JSON.stringify(claims)).toString("base64url");

/** A token's parts and its claims, before any signature is checked. */
function parse(token: string | null | undefined): { payload: string; sig: string; claims: Record<string, unknown> } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return claims && typeof claims === "object" ? { payload: parts[0], sig: parts[1], claims: claims as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

/**
 * A reset link's token: the account and when it stops working, signed together with the account's password hash as it
 * is now. The hash itself isn't in the token. A new password changes the hash, so the link works once.
 */
export function signResetToken(userId: string, passwordHash: string, env: Env = process.env, now = Date.now()): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const payload = encode({ k: "reset", u: userId, x: now + RESET_LINK_MINUTES * MINUTE });
  return `${payload}.${mac(secret, `${payload}.${passwordHash}`)}`;
}

/** The account a reset link is for, while the link still works; null once it has expired, been used or been tampered with. */
export async function resetLinkAccount(db: Db, token: string | null | undefined, env: Env = process.env, now = Date.now()): Promise<Account | null> {
  const secret = env.SESSION_SECRET;
  const t = parse(token);
  if (!secret || !t || t.claims.k !== "reset" || typeof t.claims.u !== "string" || typeof t.claims.x !== "number" || t.claims.x < now) return null;
  const account = await accountForUser(db, t.claims.u);
  if (!account?.password_hash || !safeEqual(t.sig, mac(secret, `${t.payload}.${account.password_hash}`))) return null;
  return account;
}

/** A recovery email's confirmation token: the account, the address and when it stops working. */
export function signAddressToken(userId: string, email: string, env: Env = process.env, now = Date.now()): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const payload = encode({ k: "address", u: userId, e: email, x: now + ADDRESS_LINK_DAYS * DAY });
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyAddressToken(token: string | null | undefined, env: Env = process.env, now = Date.now()): { u: string; e: string } | null {
  const secret = env.SESSION_SECRET;
  const t = parse(token);
  if (!secret || !t || !safeEqual(t.sig, mac(secret, t.payload))) return null;
  const { k, u, e, x } = t.claims;
  if (k !== "address" || typeof u !== "string" || typeof e !== "string" || typeof x !== "number" || x < now) return null;
  return { u, e };
}

/* ------------------------------------------------------ emails ------------------------------------------------------ */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Message = { subject: string; text: string; html: string };

/** An account email: a few short paragraphs, maybe one link, and a last line in small print. */
function message(subject: string, paragraphs: string[], link: { label: string; href: string } | null, smallPrint: string): Message {
  const text = [...paragraphs, ...(link ? [`${link.label}: ${link.href}`] : []), smallPrint].join("\n\n");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#241022">` +
    `<p style="font-size:20px;font-weight:700;color:#c82f60;margin:0 0 16px">Botchelor</p>` +
    paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join("") +
    (link ? `<p style="margin:0 0 18px"><a href="${esc(link.href)}" style="color:#b52c59;font-weight:600">${esc(link.label)}</a></p>` : "") +
    `<p style="margin:18px 0 0;font-size:13px;color:#6a5a6f">${esc(smallPrint)}</p></div>`;
  return { subject, text, html };
}

const nameOf = (a: Account) => `@${a.handle_display ?? a.handle ?? "your account"}`;

/** How to reach us when a change wasn't theirs: the support address, else the feedback button. */
function helpLine(env: Env): string {
  const support = contactEmail(env);
  return support ? `write to ${support}` : "tell us with the feedback button at the foot of any page";
}

/** A note to the owner after the password or the recovery email changed. Never fails the change itself. */
async function tellOwner(db: Db, a: Account, to: string, change: { password: true } | { address: string | null }, env: Env): Promise<void> {
  const base = siteUrl(env);
  const msg =
    "password" in change
      ? message(
          "Your Botchelor password was changed",
          [
            `The password for ${nameOf(a)} on Botchelor was just changed. If that was you, there's nothing to do.`,
            `If it wasn't, get a new one now: Forgot your password?, under Sign in on the account page, sends a link to this address. Then ${helpLine(env)} so we can look into it.`,
          ],
          { label: "Go to your account", href: `${base}/account` },
          "We send this whenever the password changes, so a change you didn't make doesn't go unseen.",
        )
      : message(
          change.address ? "Your Botchelor recovery email was changed" : "Your Botchelor recovery email was removed",
          [
            change.address
              ? `Password reset links for ${nameOf(a)} on Botchelor now go to ${maskEmail(change.address)}, not to this address.`
              : `${nameOf(a)} on Botchelor no longer has a recovery email, so a forgotten password can't be reset by email.`,
            `If that wasn't you, ${helpLine(env)} straight away and we'll help you get the account back.`,
          ],
          null,
          "We send this to the address that was on the account, so a change you didn't make doesn't go unseen.",
        );
  const kind = "password" in change ? RECOVERY_KINDS.passwordChanged : RECOVERY_KINDS.addressChanged;
  await sendAccountEmail(db, a.user_id, kind, to, msg, env).catch(() => "failed");
}

/** Emails sent to this account of one kind since `since`: for the per-account caps. */
async function sentSince(db: Db, userId: string, kind: string, since: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from email_sends where user_id = $1 and kind = $2 and created_at > $3`, [
    userId,
    kind,
    new Date(since).toISOString(),
  ]);
  return rows[0]?.n ?? 0;
}

/* ---------------------------------------------------- the password ---------------------------------------------------- */

/** The current password, under the sign-in limits: a wrong one counts as a failed sign-in for the handle. */
async function checkPassword(db: Db, a: Account, password: string, visitor: string | null): Promise<void> {
  if (!a.password_hash || !a.handle) {
    throw new ApiError(409, { error: "no_password", message: "This account signs in with Google, so it has no password here." });
  }
  if (await loginHeld(db, a.handle, visitor)) {
    throw new ApiError(429, { error: "too_many_attempts", message: `Too many wrong passwords. Try again in ${LOGIN_WINDOW_MINUTES} minutes.` });
  }
  if (!(await verifyPassword(password, a.password_hash))) {
    await recordLoginFailure(db, a.handle, visitor);
    throw new ApiError(403, { error: "wrong_password", message: "That isn't the account's current password." });
  }
}

async function signedInAccount(db: Db, userId: string): Promise<Account> {
  const a = await accountForUser(db, userId);
  if (!a) throw new ApiError(403, { error: "account_required", message: "Sign in to your account first." });
  return a;
}

function assertNewPassword(password: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new ApiError(422, { error: "bad_password", message: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.` });
  }
}

/** Sets a new password (every reset link sent before it stops working) and tells the recovery email. */
async function setPassword(db: Db, a: Account, password: string, env: Env): Promise<void> {
  assertNewPassword(password);
  await db.query(`update accounts set password_hash = $2, updated_at = now() where user_id = $1`, [a.user_id, await hashPassword(password)]);
  if (a.email) await tellOwner(db, a, a.email, { password: true }, env);
}

/** The account page's "Change password": the current one, then the new one. */
export async function changePassword(db: Db, userId: string, current: string, next: string, visitor: string | null, env: Env = process.env): Promise<void> {
  const a = await signedInAccount(db, userId);
  await checkPassword(db, a, current, visitor);
  await setPassword(db, a, next, env);
}

/* --------------------------------------------------- recovery email --------------------------------------------------- */

export type RecoveryStatus = { available: boolean; has_password: boolean; email: string | null };

/** What the account page shows: whether email works here, and the account's recovery email (a password account's only). */
export async function recoveryStatus(db: Db, userId: string, env: Env = process.env): Promise<RecoveryStatus> {
  const a = await accountForUser(db, userId);
  const hasPassword = Boolean(a?.password_hash);
  return { available: emailConfig(env) !== null, has_password: hasPassword, email: hasPassword ? (a?.email ?? null) : null };
}

/** Puts a confirmed address on the account unless another account has it, and tells the address it replaces. */
async function saveAddress(db: Db, a: Account, email: string, env: Env): Promise<boolean> {
  const taken = await db.query(`select 1 from accounts where lower(email) = $1 and user_id <> $2`, [email, a.user_id]);
  if (taken.rows.length) return false;
  try {
    await db.query(`update accounts set email = $2, updated_at = now() where user_id = $1`, [a.user_id, email]);
  } catch {
    return false; // another account took it a moment ago (accounts.email is unique)
  }
  if (a.email && a.email.toLowerCase() !== email) await tellOwner(db, a, a.email, { address: email }, env);
  return true;
}

export type AddressResult = { status: "set"; email: string } | { status: "sent"; email: string };

/**
 * Adds or changes the recovery email. Takes the current password. An address this account already confirmed for its
 * notifications is set at once; any other gets a link first, and only the link sets it. Whether an address is on another
 * account is said only to whoever clicks its link, so this form can't be used to find out.
 */
export async function setRecoveryEmail(
  db: Db,
  userId: string,
  requested: string,
  password: string,
  visitor: string | null,
  env: Env = process.env,
  now = Date.now(),
): Promise<AddressResult> {
  if (!emailConfig(env)) throw new ApiError(503, { error: "email_unavailable", message: "Email isn't set up here yet." });
  const a = await signedInAccount(db, userId);
  await checkPassword(db, a, password, visitor);
  const email = requested.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ApiError(422, { error: "invalid_email", message: "That doesn't look like an email address." });
  if (a.email?.toLowerCase() === email) return { status: "set", email };
  const confirmed = await db.query(`select 1 from email_prefs where user_id = $1 and lower(email) = $2 and confirmed_at is not null`, [userId, email]);
  if (confirmed.rows.length) {
    if (!(await saveAddress(db, a, email, env))) {
      throw new ApiError(409, { error: "address_taken", message: "That address is on another Botchelor account. Use a different one." });
    }
    return { status: "set", email };
  }
  if ((await sentSince(db, userId, RECOVERY_KINDS.confirm, now - DAY)) >= ADDRESS_CONFIRMS_PER_DAY) {
    throw new ApiError(429, { error: "too_many_confirmations", message: "That's enough confirmation emails for today. Try again tomorrow." });
  }
  const token = signAddressToken(userId, email, env, now);
  if (!token) throw new ApiError(503, { error: "email_unavailable", message: "Email isn't set up here yet." });
  const link = `${siteUrl(env)}/email/confirm-recovery?t=${encodeURIComponent(token)}`;
  const result = await sendAccountEmail(
    db,
    userId,
    RECOVERY_KINDS.confirm,
    email,
    message(
      "Confirm your Botchelor recovery email",
      [
        `Use this address to reset the password for ${nameOf(a)} on Botchelor, if it's ever forgotten?`,
        `Open the link and press the button. It works for ${ADDRESS_LINK_DAYS} days.`,
      ],
      { label: "Confirm this address", href: link },
      "If you didn't ask for this, ignore it: nothing changes unless the button is pressed.",
    ),
    env,
  );
  if (result === "capped") throw new ApiError(429, { error: "email_capped", message: "Email is busy today. Try again tomorrow." });
  if (result !== "sent") throw new ApiError(503, { error: "email_failed", message: "Couldn't send the email right now. Try again in a few minutes." });
  return { status: "sent", email };
}

export type ConfirmResult = "confirmed" | "invalid" | "taken";

/** The confirmation page's button: puts the address on the account, if the link still works and no other account has it. */
export async function confirmRecoveryEmail(db: Db, token: string | null | undefined, env: Env = process.env, now = Date.now()): Promise<ConfirmResult> {
  const t = verifyAddressToken(token, env, now);
  if (!t) return "invalid";
  const a = await accountForUser(db, t.u);
  if (!a?.password_hash) return "invalid";
  if (a.email?.toLowerCase() === t.e) return "confirmed"; // pressed twice
  return (await saveAddress(db, a, t.e, env)) ? "confirmed" : "taken";
}

/** Takes the recovery email off (current password first) and tells the address that was on it. */
export async function removeRecoveryEmail(db: Db, userId: string, password: string, visitor: string | null, env: Env = process.env): Promise<void> {
  const a = await signedInAccount(db, userId);
  await checkPassword(db, a, password, visitor);
  if (!a.email) return;
  await db.query(`update accounts set email = null, updated_at = now() where user_id = $1`, [userId]);
  await tellOwner(db, a, a.email, { address: null }, env);
}

/* ------------------------------------------------- forgot and reset ------------------------------------------------- */

/** One account's reset link, within its caps. Whether it went. */
async function sendResetLink(db: Db, a: Account & { email: string; password_hash: string }, env: Env, now: number): Promise<boolean> {
  if ((await sentSince(db, a.user_id, RECOVERY_KINDS.reset, now - MINUTE)) > 0) return false;
  if ((await sentSince(db, a.user_id, RECOVERY_KINDS.reset, now - DAY)) >= RESETS_PER_DAY) return false;
  const token = signResetToken(a.user_id, a.password_hash, env, now);
  if (!token) return false;
  // After the #: the token never reaches a server log, a Referer header or analytics (app/email/reset-password).
  const link = `${siteUrl(env)}/email/reset-password#t=${encodeURIComponent(token)}`;
  const result = await sendAccountEmail(
    db,
    a.user_id,
    RECOVERY_KINDS.reset,
    a.email,
    message(
      "Reset your Botchelor password",
      [
        `Someone, we hope you, asked to reset the password for ${nameOf(a)} on Botchelor.`,
        `Choose a new one from this link. It works for an hour, and only once.`,
      ],
      { label: "Choose a new password", href: link },
      "If you didn't ask, ignore this email: your password stays as it is.",
    ),
    env,
  );
  return result === "sent";
}

/**
 * "Forgot your password?": a reset link to the recovery email of the account with this handle, or of the account with
 * this address. Returns how many went, for the tests; the route always gives FORGOT_ANSWER, whatever happened.
 */
export async function requestPasswordReset(db: Db, who: string, env: Env = process.env, now = Date.now()): Promise<number> {
  if (!emailConfig(env)) return 0;
  const input = who.trim().toLowerCase();
  let rows: Account[];
  if (input.includes("@")) {
    if (!EMAIL_RE.test(input)) return 0;
    rows = (await db.query<Account>(`select ${ACCOUNT_COLUMNS} from accounts where lower(email) = $1 limit 3`, [input])).rows;
  } else {
    const handle = normaliseHandle(input);
    rows = handle ? (await db.query<Account>(`select ${ACCOUNT_COLUMNS} from accounts where handle = $1`, [handle])).rows : [];
  }
  let sent = 0;
  for (const a of rows) {
    if (!a.email || !a.password_hash) continue; // no recovery email, or a Google account: nothing to send
    if (await sendResetLink(db, { ...a, email: a.email, password_hash: a.password_hash }, env, now)) sent++;
  }
  return sent;
}

/** The reset page's form: a new password for the link's account. Returns the account, which the route signs in. */
export async function resetPassword(db: Db, token: string, password: string, env: Env = process.env, now = Date.now()): Promise<Account> {
  const a = await resetLinkAccount(db, token, env, now);
  if (!a) {
    throw new ApiError(400, {
      error: "invalid_link",
      message: "That link doesn't work any more: each one lasts an hour and works once. Ask for a new one under Sign in.",
    });
  }
  await setPassword(db, a, password, env);
  return a;
}
