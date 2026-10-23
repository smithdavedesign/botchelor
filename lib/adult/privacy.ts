/**
 * After Dark's discreet mode, the server side (docs/after-dark.md "Discreet mode"; the shared pieces are in
 * lib/adult/discreet.ts). Per account, in adult_privacy:
 *
 *  - **Blur** (on by default): every After Dark picture and video stays blurred until it's tapped (one CSS hook on the
 *    After Dark layouts, app/after-dark/discreet.css).
 *  - **Neutral title** (on by default): every After Dark page's tab says "Botchelor".
 *  - **PIN** (off by default, 4 to 6 digits): asked for before any After Dark page renders, on each device. Only a slow
 *    salted hash is stored (scrypt, a random salt per PIN, peppered with an HMAC of SESSION_SECRET, so the table alone
 *    can't be brute-forced). The PIN itself is never stored, logged or sent back.
 *
 * A device that enters the PIN gets a signed cookie (bz_ad_unlock) for 12 hours. It names the account and the PIN's
 * version, so a new or removed PIN signs every device out. Until then the pages, the APIs and the media route answer as
 * if After Dark weren't there (lib/adult/mode.ts adultViewer). Five wrong tries (PIN, reset code or password alike) set
 * a 15-minute wait; each try is counted before it's checked, so parallel guesses can't go past the five.
 *
 * Forgot the PIN: the signed-in owner, plus an 8-digit code sent to the account's confirmed email when it has one, or
 * the account's password when it has no email. There is no other way round it: no admin override, no back door.
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "../auth";
import type { Db } from "../db";
import { sendAccountEmail } from "../email";
import { json, safeEqual } from "../http";
import { siteUrl } from "../site";
import {
  DEFAULT_PRIVACY,
  maskEmail,
  PIN_LOCKOUT_MINUTES,
  PIN_MAX_TRIES,
  PIN_RE,
  RESET_CODE_MINUTES,
  RESET_CODE_RE,
  UNLOCK_HOURS,
  waitText,
  type Privacy,
} from "./discreet";
import { canAfterDark } from "./entitlement";

type Env = Record<string, string | undefined>;
const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
const secretOf = (env: Env): string | null => env.SESSION_SECRET || null;
const mac = (secret: string, data: string): string => createHmac("sha256", secret).update(data).digest("base64url");
const iso = (ms: number): string => new Date(ms).toISOString();

/* ------------------------------------------------------ the PIN hash ------------------------------------------------------ */

/** scrypt's cost for a new PIN hash: 2^15 (about a tenth of a second). Stored with the hash, so it can rise later. */
export const PIN_SCRYPT_N = 1 << 15;
const PIN_SCRYPT = { r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const PIN_KEYLEN = 32;
let workForTests: number | null = null;
/** Tests hash at a lower cost; production always uses PIN_SCRYPT_N. */
export function setPinWorkForTests(n: number | null): void {
  workForTests = n;
}

const scryptKey = (secret: Buffer, salt: Buffer, n: number): Promise<Buffer> =>
  new Promise((ok, fail) => scrypt(secret, salt, PIN_KEYLEN, { N: n, ...PIN_SCRYPT }, (err, key) => (err ? fail(err) : ok(key))));

/** The PIN as scrypt's input: an HMAC of it under SESSION_SECRET, so a copy of the table alone can't be guessed through. */
function peppered(pin: string, env: Env): Buffer {
  const secret = secretOf(env);
  if (!secret) throw new Error("A PIN needs SESSION_SECRET");
  return createHmac("sha256", secret).update(`after-dark-pin:${pin}`).digest();
}

/** `pin1$<N>$<salt>$<hash>` (base64url): a fresh random salt for every PIN. */
export async function hashPin(pin: string, env: Env = process.env): Promise<string> {
  if (!PIN_RE.test(pin)) throw new Error("A PIN is 4 to 6 digits");
  const n = workForTests ?? PIN_SCRYPT_N;
  const salt = randomBytes(16);
  return `pin1$${n}$${b64url(salt)}$${b64url(await scryptKey(peppered(pin, env), salt, n))}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined, env: Env = process.env): Promise<boolean> {
  if (!stored || !PIN_RE.test(pin)) return false;
  const [scheme, nText, saltText, hashText] = stored.split("$");
  const n = Number(nText);
  // A cost above 2^16 would need more memory than PIN_SCRYPT allows; nothing this code writes goes past 2^15.
  if (scheme !== "pin1" || !Number.isInteger(n) || n < 2 || n > 1 << 16 || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scryptKey(peppered(pin, env), Buffer.from(saltText, "base64url"), n);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ---------------------------------------------------- the device cookie ---------------------------------------------------- */

export const UNLOCK_COOKIE = "bz_ad_unlock";
const UNLOCK_SECONDS = UNLOCK_HOURS * 60 * 60;

/**
 * This device is unlocked: `adu1.<payload>.<sig>`, payload = base64url JSON {u: account, v: the PIN's version, e: expiry in
 * seconds}. Its own prefix and HMAC context, so it's never taken for a session, a carry or an email token, or they for it.
 */
export function signUnlock(userId: string, version: number, env: Env = process.env, now = Date.now()): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const payload = b64url(JSON.stringify({ u: userId, v: version, e: Math.floor(now / 1000) + UNLOCK_SECONDS }));
  return `adu1.${payload}.${mac(secret, `after-dark-unlock:${payload}`)}`;
}

/** True when the token unlocks this account at this PIN version and hasn't expired. */
export function verifyUnlock(token: string | null | undefined, userId: string, version: number, env: Env = process.env, now = Date.now()): boolean {
  const secret = secretOf(env);
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "adu1") return false;
  if (!safeEqual(parts[2], mac(secret, `after-dark-unlock:${parts[1]}`))) return false;
  try {
    const t = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as { u?: unknown; v?: unknown; e?: unknown };
    return t.u === userId && t.v === version && typeof t.e === "number" && t.e > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
export const unlockCookie = (token: string): string => `${UNLOCK_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${UNLOCK_SECONDS}${secure()}`;
export const clearUnlockCookie = (): string => `${UNLOCK_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

/** The unlock cookie from a request's Cookie header. */
export function unlockTokenFromRequest(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === UNLOCK_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/* ------------------------------------------------------ the settings ------------------------------------------------------ */

type Row = { blur: boolean; neutral_title: boolean; pin_hash: string | null; pin_version: number; pin_failures: number; pin_locked_until: string | Date | null };
const COLUMNS = "blur, neutral_title, pin_hash, pin_version, pin_failures, pin_locked_until";

async function row(db: Db, userId: string): Promise<Row | null> {
  return (await db.query<Row>(`select ${COLUMNS} from adult_privacy where user_id = $1`, [userId])).rows[0] ?? null;
}

const toPrivacy = (r: Row | null): Privacy => (r ? { blur: r.blur, neutral_title: r.neutral_title, pin: Boolean(r.pin_hash) } : { ...DEFAULT_PRIVACY });

export async function getPrivacy(db: Db, userId: string): Promise<Privacy> {
  return toPrivacy(await row(db, userId));
}

/** Turns blur or the neutral title on or off; anything left out stays as it is. */
export async function savePrivacy(db: Db, userId: string, patch: { blur?: boolean; neutral_title?: boolean }): Promise<Privacy> {
  const r = await db.query<Row>(
    `insert into adult_privacy (user_id, blur, neutral_title) values ($1, coalesce($2::boolean, true), coalesce($3::boolean, true))
     on conflict (user_id) do update set blur = coalesce($2::boolean, adult_privacy.blur),
       neutral_title = coalesce($3::boolean, adult_privacy.neutral_title), updated_at = now()
     returning ${COLUMNS}`,
    [userId, patch.blur ?? null, patch.neutral_title ?? null],
  );
  return toPrivacy(r.rows[0] ?? null);
}

/** The signed-in account After Dark is open to (lib/adult/entitlement.ts), whether or not this device is unlocked. */
export async function privacyOwner(db: Db, auth: { userId: string; authenticated: boolean } | null): Promise<string | null> {
  return auth?.authenticated && (await canAfterDark(db, auth)).ok ? auth.userId : null;
}

/** Whether this device must enter the account's PIN first: there is one, and the device's cookie doesn't unlock it. */
export async function isLocked(db: Db, userId: string, token: string | null | undefined, now = Date.now(), env: Env = process.env): Promise<boolean> {
  const r = await row(db, userId);
  return Boolean(r?.pin_hash) && !verifyUnlock(token, userId, r!.pin_version, env, now);
}

export const lockedForRequest = (db: Db, userId: string, req: Request, now = Date.now()): Promise<boolean> =>
  isLocked(db, userId, unlockTokenFromRequest(req), now);

export const lockedForCookies = (db: Db, userId: string, store: { get(name: string): { value: string } | undefined }, now = Date.now()): Promise<boolean> =>
  isLocked(db, userId, store.get(UNLOCK_COOKIE)?.value ?? null, now);

/* ------------------------------------------------------- the tries ------------------------------------------------------- */

export type Attempt =
  | { ok: true; version: number }
  | { ok: false; error: "wrong"; tries_left: number }
  | { ok: false; error: "too_many_tries"; retry_after_seconds: number }
  | { ok: false; error: "no_pin" };

async function lockOut(db: Db, userId: string, now: number): Promise<Attempt> {
  await db.query(`update adult_privacy set pin_failures = 0, pin_locked_until = $2, updated_at = $3 where user_id = $1`, [
    userId,
    iso(now + PIN_LOCKOUT_MINUTES * 60_000),
    iso(now),
  ]);
  return { ok: false, error: "too_many_tries", retry_after_seconds: PIN_LOCKOUT_MINUTES * 60 };
}

/**
 * One try at anything that proves it's the owner (the PIN, a reset code, the account password). The try is counted
 * first, in one statement, and only then checked, so five guesses sent at once can't become fifty. A right answer
 * clears the count; the fifth wrong one sets the wait. Nothing is tried while a wait is on.
 */
async function attempt(db: Db, userId: string, check: (r: Row) => Promise<boolean>, now: number): Promise<Attempt> {
  const reserved = (
    await db.query<Row>(
      `update adult_privacy set pin_failures = pin_failures + 1, updated_at = $2
        where user_id = $1 and pin_hash is not null and (pin_locked_until is null or pin_locked_until <= $2) and pin_failures < $3
        returning ${COLUMNS}`,
      [userId, iso(now), PIN_MAX_TRIES],
    )
  ).rows[0];
  if (!reserved) {
    const r = await row(db, userId);
    if (!r?.pin_hash) return { ok: false, error: "no_pin" };
    const until = r.pin_locked_until ? new Date(r.pin_locked_until).getTime() : 0;
    if (until > now) return { ok: false, error: "too_many_tries", retry_after_seconds: Math.ceil((until - now) / 1000) };
    // Five counted with no wait set (a request that died between the two writes): set it now.
    return lockOut(db, userId, now);
  }
  if (await check(reserved)) {
    await db.query(`update adult_privacy set pin_failures = 0, pin_locked_until = null, updated_at = $2 where user_id = $1`, [userId, iso(now)]);
    return { ok: true, version: reserved.pin_version };
  }
  if (reserved.pin_failures >= PIN_MAX_TRIES) return lockOut(db, userId, now);
  return { ok: false, error: "wrong", tries_left: PIN_MAX_TRIES - reserved.pin_failures };
}

/** A failed try as an API answer: what was wrong, the tries left, or when the wait ends (with Retry-After). */
export function attemptReply(a: Exclude<Attempt, { ok: true }>, what: "PIN" | "code" | "password"): { status: number; body: Record<string, unknown>; headers: Record<string, string> } {
  if (a.error === "too_many_tries") {
    return {
      status: 429,
      body: { error: "too_many_tries", retry_after_seconds: a.retry_after_seconds, message: `Too many tries. Try again ${waitText(a.retry_after_seconds)}.` },
      headers: { "retry-after": String(a.retry_after_seconds) },
    };
  }
  if (a.error === "no_pin") return { status: 409, body: { error: "no_pin", message: "There's no PIN set." }, headers: {} };
  const left = `${a.tries_left} ${a.tries_left === 1 ? "try" : "tries"} left`;
  const wrong = what === "PIN" ? "That's not the PIN." : what === "code" ? "That code isn't right." : "That's not the account's password.";
  return { status: 401, body: { error: `wrong_${what.toLowerCase()}`, tries_left: a.tries_left, message: `${wrong} ${left}.` }, headers: {} };
}

/** A JSON answer with extra headers and cookies (this device's unlock cookie, a Retry-After). */
export function replyWith(body: unknown, status = 200, extra: { headers?: Record<string, string>; cookies?: string[] } = {}): Response {
  const res = json(body, status);
  for (const [k, v] of Object.entries(extra.headers ?? {})) res.headers.set(k, v);
  for (const c of extra.cookies ?? []) res.headers.append("set-cookie", c);
  return res;
}

/** A failed try, answered (attemptReply). */
export function failedTry(a: Exclude<Attempt, { ok: true }>, what: "PIN" | "code" | "password"): Response {
  const r = attemptReply(a, what);
  return replyWith(r.body, r.status, { headers: r.headers });
}

/** The PIN, tried: right gives the version to unlock this device at. */
export async function tryPin(db: Db, userId: string, pin: string, now = Date.now(), env: Env = process.env): Promise<Attempt> {
  return attempt(db, userId, (r) => verifyPin(pin, r.pin_hash, env), now);
}

/** A new PIN (the caller has already checked the current one, if there was one). Signs every other device out. */
export async function setPin(db: Db, userId: string, pin: string, now = Date.now(), env: Env = process.env): Promise<{ version: number }> {
  const hash = await hashPin(pin, env);
  const r = await db.query<{ pin_version: number }>(
    `insert into adult_privacy (user_id, pin_hash, pin_version, updated_at) values ($1, $2, 1, $3)
     on conflict (user_id) do update set pin_hash = excluded.pin_hash, pin_version = adult_privacy.pin_version + 1,
       pin_failures = 0, pin_locked_until = null, updated_at = excluded.updated_at
     returning pin_version`,
    [userId, hash, iso(now)],
  );
  return { version: r.rows[0].pin_version };
}

/** No PIN any more (removed, or reset through the account). Every device's unlock cookie stops counting. */
export async function clearPin(db: Db, userId: string, now = Date.now()): Promise<void> {
  await db.query(
    `update adult_privacy set pin_hash = null, pin_version = pin_version + 1, pin_failures = 0, pin_locked_until = null, updated_at = $2 where user_id = $1`,
    [userId, iso(now)],
  );
}

/* ------------------------------------------------------ forgot the PIN ------------------------------------------------------ */

/** How this account can prove it's the owner: a code to its confirmed email (shown masked), else its password. */
export type ResetWays = { email: string | null; password: boolean };

/** The account's confirmed address: its Google sign-in email, else the notification address it confirmed. */
async function accountEmail(db: Db, userId: string): Promise<string | null> {
  const a = (await db.query<{ email: string | null; google_sub: string | null }>(`select email, google_sub from accounts where user_id = $1`, [userId])).rows[0];
  if (a?.google_sub && a.email) return a.email;
  const p = (await db.query<{ email: string }>(`select email from email_prefs where user_id = $1 and confirmed_at is not null`, [userId])).rows[0];
  return p?.email ?? null;
}

export async function resetWays(db: Db, userId: string): Promise<ResetWays> {
  const email = await accountEmail(db, userId);
  if (email) return { email: maskEmail(email), password: false };
  const a = (await db.query<{ password_hash: string | null }>(`select password_hash from accounts where user_id = $1`, [userId])).rows[0];
  return { email: null, password: Boolean(a?.password_hash) };
}

/**
 * The code for a 15-minute window: 8 digits from an HMAC of the account, the PIN's version and the window. Nothing to
 * store; a reset (or a new PIN) changes the version, so a code works once. The one before this window's still works,
 * so a code is good for 15 to 30 minutes.
 */
export function resetCode(userId: string, version: number, window: number, env: Env = process.env): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const digest = createHmac("sha256", secret).update(`after-dark-pin-reset:${userId}:${version}:${window}`).digest();
  return String(digest.readUIntBE(0, 5) % 100_000_000).padStart(8, "0");
}
const windowOf = (now: number) => Math.floor(now / (RESET_CODE_MINUTES * 60_000));

function resetCodeValid(code: string, userId: string, version: number, now: number, env: Env): boolean {
  if (!RESET_CODE_RE.test(code)) return false;
  const w = windowOf(now);
  return [w, w - 1].some((win) => {
    const expected = resetCode(userId, version, win, env);
    return expected !== null && safeEqual(code, expected);
  });
}

/** Reset codes one account may be sent: one a minute, five a day. */
export const RESET_SENDS_PER_DAY = 5;
const RESET_KIND = "pin_reset";

export type SendResult = { ok: true; to: string } | { ok: false; status: number; error: string; message: string };

/** Emails the owner a reset code, when the account has a confirmed address. Neutral words: no After Dark in it. */
export async function sendResetCode(db: Db, userId: string, now = Date.now(), env: Env = process.env): Promise<SendResult> {
  const r = await row(db, userId);
  if (!r?.pin_hash) return { ok: false, status: 409, error: "no_pin", message: "There's no PIN to reset." };
  const email = await accountEmail(db, userId);
  if (!email) return { ok: false, status: 409, error: "no_email", message: "This account has no confirmed email to send a code to." };
  const sent = (
    await db.query<{ day: number; recent: number }>(
      `select count(*)::int as day, count(*) filter (where created_at > now() - interval '60 seconds')::int as recent
         from email_sends where user_id = $1 and kind = $2 and created_at > now() - interval '1 day'`,
      [userId, RESET_KIND],
    )
  ).rows[0];
  if ((sent?.recent ?? 0) > 0) return { ok: false, status: 429, error: "too_soon", message: "A code is on its way. Give it a minute before asking for another." };
  if ((sent?.day ?? 0) >= RESET_SENDS_PER_DAY) return { ok: false, status: 429, error: "too_many_codes", message: "That's enough codes for today. Try again tomorrow." };
  const code = resetCode(userId, r.pin_version, windowOf(now), env);
  if (!code) return { ok: false, status: 503, error: "unavailable", message: "Codes can't be sent here." };
  const shown = `${code.slice(0, 4)} ${code.slice(4)}`;
  const base = siteUrl(env);
  const result = await sendAccountEmail(
    db,
    userId,
    RESET_KIND,
    email,
    {
      subject: "Your Botchelor PIN reset code",
      text:
        `Your code is ${shown}. It works for ${RESET_CODE_MINUTES} minutes.\n\n` +
        `You asked to reset the privacy PIN on your Botchelor account. Type the code where you asked for it.\n\n` +
        `If that wasn't you, ignore this email: your PIN stays as it is, and nobody can reset it without this code.\n\n${base}`,
      html:
        `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#241022">` +
        `<p style="font-size:20px;font-weight:700;color:#c82f60">Botchelor</p>` +
        `<p>Your code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:0 0 12px">${shown}</p>` +
        `<p>It works for ${RESET_CODE_MINUTES} minutes. You asked to reset the privacy PIN on your Botchelor account: type the code where you asked for it.</p>` +
        `<p style="font-size:13px;color:#6a5a6f">If that wasn't you, ignore this email: your PIN stays as it is, and nobody can reset it without this code.</p></div>`,
    },
    env,
  );
  if (result === "sent") return { ok: true, to: maskEmail(email) };
  if (result === "capped") return { ok: false, status: 429, error: "email_capped", message: "Email is busy today. Try again tomorrow." };
  return { ok: false, status: 503, error: "email_unavailable", message: "Couldn't send a code right now. Try again in a few minutes." };
}

/** The emailed code: right takes the PIN off (the owner sets a new one), and counts as a try either way. */
export async function resetWithCode(db: Db, userId: string, code: string, now = Date.now(), env: Env = process.env): Promise<Attempt> {
  const a = await attempt(db, userId, async (r) => resetCodeValid(code, userId, r.pin_version, now, env), now);
  if (a.ok) await clearPin(db, userId, now);
  return a;
}

/**
 * The account password, for an account with no confirmed email: right takes the PIN off. An account with an email has to
 * use the code, so a password someone saw over a shoulder isn't enough on its own.
 */
export async function resetWithPassword(
  db: Db,
  userId: string,
  password: string,
  now = Date.now(),
): Promise<Attempt | { ok: false; error: "use_email" } | { ok: false; error: "no_password" }> {
  if (await accountEmail(db, userId)) return { ok: false, error: "use_email" };
  const hash = (await db.query<{ password_hash: string | null }>(`select password_hash from accounts where user_id = $1`, [userId])).rows[0]?.password_hash;
  if (!hash) return { ok: false, error: "no_password" };
  const a = await attempt(db, userId, () => verifyPassword(password, hash), now);
  if (a.ok) await clearPin(db, userId, now);
  return a;
}

/* -------------------------------------------------------- the pages -------------------------------------------------------- */

/** What an After Dark layout needs for this viewer: whether to ask for the PIN, and the discreet settings. */
export type AfterDarkView = { owner: string | null; locked: boolean; blur: boolean; neutralTitle: boolean; reset: ResetWays | null };

export async function afterDarkView(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null,
  token: string | null | undefined,
  now = Date.now(),
  env: Env = process.env,
): Promise<AfterDarkView> {
  const owner = await privacyOwner(db, auth).catch(() => null);
  if (!owner) return { owner: null, locked: false, blur: DEFAULT_PRIVACY.blur, neutralTitle: DEFAULT_PRIVACY.neutral_title, reset: null };
  const r = await row(db, owner);
  const p = toPrivacy(r);
  const locked = Boolean(r?.pin_hash) && !verifyUnlock(token, owner, r!.pin_version, env, now);
  return { owner, locked, blur: p.blur, neutralTitle: p.neutral_title, reset: locked ? await resetWays(db, owner) : null };
}
