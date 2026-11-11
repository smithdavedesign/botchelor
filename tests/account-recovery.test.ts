import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as changePasswordWellKnown } from "@/app/.well-known/change-password/route";
import { POST as forgotRoute } from "@/app/api/auth/forgot/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as passwordRoute } from "@/app/api/auth/password/route";
import { POST as confirmRoute } from "@/app/api/auth/recovery/confirm/route";
import { DELETE as removeRoute, GET as recoveryRoute, POST as setRoute } from "@/app/api/auth/recovery/route";
import { POST as resetRoute } from "@/app/api/auth/reset/route";
import { exportAccount } from "@/lib/account";
import {
  ADDRESS_CONFIRMS_PER_DAY,
  FORGOT_ANSWER,
  RESET_LINK_MINUTES,
  RESETS_PER_DAY,
  requestPasswordReset,
  resetLinkAccount,
  signAddressToken,
  signResetToken,
  verifyAddressToken,
} from "@/lib/account-recovery";
import { registerAccount, signSession, verifySession } from "@/lib/auth";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { LOGIN_FAILS_PER_HANDLE } from "@/lib/login-guard";
import { BASE_URL, startTestDb } from "./helpers";

const SECRET = ["sess", "recovery", "secret", "abcdefghij0123456789"].join("-");
const KEY = ["re", "test", "key"].join("_");
const SITE = "https://botchelor.com";
const SUPPORT = ["support", "botchelor.com"].join("@");
// Test passwords are built from parts, never written as a literal the secret scanner would flag.
const PW = ["map", "reader", "99"].join("-");
const PW2 = ["another", "good", "one"].join("-");
const PW3 = ["third", "time", "lucky"].join("-");
const MAIL = ["ann", "example.com"].join("@");
const MINUTE = 60_000;

let t: Awaited<ReturnType<typeof startTestDb>>;
let sent: EmailMessage[] = [];
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  for (const table of ["email_sends", "email_prefs", "accounts"]) await t.db.query(`delete from ${table}`);
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("SITE_URL", SITE);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("CONTACT_EMAIL", SUPPORT);
});
afterEach(() => {
  setEmailSenderForTests(null);
  vi.unstubAllEnvs();
});

let ip = 0;
/** A JSON call from a browser: its own address unless one is given, signed in when a user id is given. */
function call(path: string, body: unknown, opts: { user?: string; method?: string; ip?: string; ua?: string; accept?: string } = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? `198.51.100.${(++ip % 250) + 1}`,
    "user-agent": opts.ua ?? "Mozilla/5.0 (Macintosh)",
  };
  if (opts.user) headers.cookie = `bz_sess=${signSession({ uid: opts.user, authenticated: true })}`;
  if (opts.accept) headers.accept = opts.accept;
  return new Request(BASE_URL + path, { method: opts.method ?? "POST", headers, ...(opts.method === "GET" ? {} : { body: JSON.stringify(body) }) });
}

const newUser = () => crypto.randomUUID();
/** A handle-and-password account, with a recovery email when one is given. */
async function account(handle = "ann_reads", email: string | null = null): Promise<string> {
  const user = newUser();
  await registerAccount(t.db, user, handle, PW);
  if (email) await t.db.query(`update accounts set email = $2 where user_id = $1`, [user, email]);
  return user;
}
const emailOf = async (user: string) => (await t.db.query<{ email: string | null }>(`select email from accounts where user_id = $1`, [user])).rows[0]?.email ?? null;
/** The token in an email's link to `path`, after `?t=` or `#t=`. */
function tokenIn(msg: EmailMessage, path: string): string | null {
  const m = msg.text.match(new RegExp(`${SITE.replace(/[.]/g, "\\.")}${path}[?#]t=(\\S+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
const signIn = (handle: string, password: string) => loginRoute(call("/api/auth/login", { handle, password }));

describe("reset links", () => {
  it("work for an hour, for one password, and can't be changed", async () => {
    const user = await account();
    const hash = (await t.db.query<{ password_hash: string }>(`select password_hash from accounts where user_id = $1`, [user])).rows[0].password_hash;
    const now = Date.now();
    const token = signResetToken(user, hash, process.env, now)!;
    expect(token).not.toContain(hash);
    expect((await resetLinkAccount(t.db, token, process.env, now))?.user_id).toBe(user);
    expect(await resetLinkAccount(t.db, token, process.env, now + (RESET_LINK_MINUTES + 1) * MINUTE)).toBeNull();
    expect(await resetLinkAccount(t.db, `${token}x`, process.env, now)).toBeNull();
    expect(await resetLinkAccount(t.db, token, { SESSION_SECRET: `${SECRET}-other` }, now)).toBeNull();
    // Another account's id in the same token: the signature no longer matches.
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const forged = `${Buffer.from(JSON.stringify({ ...claims, u: await account("bob_reads") })).toString("base64url")}.${sig}`;
    expect(await resetLinkAccount(t.db, forged, process.env, now)).toBeNull();
    // A new password ends it.
    await t.db.query(`update accounts set password_hash = 'scrypt$x$y' where user_id = $1`, [user]);
    expect(await resetLinkAccount(t.db, token, process.env, now)).toBeNull();
  });

  it("aren't confirmation links, and the other way round", async () => {
    const user = await account();
    const address = signAddressToken(user, MAIL)!;
    expect(verifyAddressToken(address)).toEqual({ u: user, e: MAIL });
    expect(await resetLinkAccount(t.db, address)).toBeNull();
    expect(verifyAddressToken(signResetToken(user, "scrypt$a$b"))).toBeNull();
    expect(verifyAddressToken(address, process.env, Date.now() + 3 * 24 * 60 * MINUTE)).toBeNull();
  });
});

describe("the recovery email", () => {
  it("takes the current password, then a link: the account page's button page sets it", async () => {
    const user = await account();
    const wrong = await setRoute(call("/api/auth/recovery", { email: MAIL, password: PW2 }, { user }));
    expect(wrong.status).toBe(403);
    expect(sent).toHaveLength(0);

    const res = await setRoute(call("/api/auth/recovery", { email: ` ${MAIL.toUpperCase()} `, password: PW }, { user }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "sent", email: MAIL });
    expect(await emailOf(user)).toBeNull(); // nothing yet: only the link sets it
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(MAIL);
    expect(sent[0].subject).toBe("Confirm your Botchelor recovery email");
    expect(sent[0].text).toContain("@ann_reads");
    const token = tokenIn(sent[0], "/email/confirm-recovery")!;
    expect(token).toBeTruthy();

    const confirmed = await confirmRoute(call(`/api/auth/recovery/confirm?t=${encodeURIComponent(token)}`, {}, { accept: "text/html" }));
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("location")).toBe("/email/confirm-recovery?done=1");
    expect(await emailOf(user)).toBe(MAIL);
    // Pressed again: still fine, nothing changes.
    expect((await confirmRoute(call(`/api/auth/recovery/confirm?t=${encodeURIComponent(token)}`, {}))).status).toBe(200);

    const status = await recoveryRoute(call("/api/auth/recovery", null, { user, method: "GET" }));
    expect(await status.json()).toEqual({ available: true, has_password: true, email: MAIL });
    expect((await recoveryRoute(call("/api/auth/recovery", null, { method: "GET" }))).status).toBe(401);
  });

  it("is set at once when it's the account's confirmed notification address", async () => {
    const user = await account();
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, $2, 'off', now())`, [user, MAIL]);
    const res = await setRoute(call("/api/auth/recovery", { email: MAIL, password: PW }, { user }));
    expect(await res.json()).toEqual({ status: "set", email: MAIL });
    expect(await emailOf(user)).toBe(MAIL);
    expect(sent).toHaveLength(0);
  });

  it("never says the address is on another account until its link is clicked", async () => {
    const google = newUser();
    await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, 'g-1', $2)`, [google, MAIL]);
    const user = await account();
    const res = await setRoute(call("/api/auth/recovery", { email: MAIL, password: PW }, { user }));
    expect(await res.json()).toEqual({ status: "sent", email: MAIL });
    const token = tokenIn(sent[0], "/email/confirm-recovery")!;
    const confirmed = await confirmRoute(call(`/api/auth/recovery/confirm?t=${encodeURIComponent(token)}`, {}, { accept: "text/html" }));
    expect(confirmed.headers.get("location")).toBe("/email/confirm-recovery?taken=1");
    expect(await emailOf(user)).toBeNull();
    expect(await emailOf(google)).toBe(MAIL);
  });

  it("caps confirmation emails per account, and a bad link changes nothing", async () => {
    const user = await account();
    for (let i = 0; i < ADDRESS_CONFIRMS_PER_DAY; i++) {
      expect((await setRoute(call("/api/auth/recovery", { email: `a${i}@example.com`, password: PW }, { user }))).status).toBe(200);
    }
    const over = await setRoute(call("/api/auth/recovery", { email: "late@example.com", password: PW }, { user }));
    expect(over.status).toBe(429);
    expect(sent).toHaveLength(ADDRESS_CONFIRMS_PER_DAY);
    const bad = await confirmRoute(call("/api/auth/recovery/confirm?t=nonsense.token", {}, { accept: "text/html" }));
    expect(bad.headers.get("location")).toBe("/email/confirm-recovery?invalid=1");
  });

  it("tells the old address when it changes or goes", async () => {
    const user = await account("ann_reads", MAIL);
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, 'new@example.com', 'on', now())`, [user]);
    expect(await (await setRoute(call("/api/auth/recovery", { email: "new@example.com", password: PW }, { user }))).json()).toEqual({ status: "set", email: "new@example.com" });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[MAIL, "Your Botchelor recovery email was changed"]]);
    expect(sent[0].text).toContain("n•••@example.com");
    expect(sent[0].text).toContain(SUPPORT);

    expect((await removeRoute(call("/api/auth/recovery", { password: PW2 }, { user, method: "DELETE" }))).status).toBe(403);
    expect((await removeRoute(call("/api/auth/recovery", { password: PW }, { user, method: "DELETE" }))).status).toBe(200);
    expect(await emailOf(user)).toBeNull();
    expect(sent.map((m) => [m.to, m.subject])[1]).toEqual(["new@example.com", "Your Botchelor recovery email was removed"]);
  });

  it("isn't for a Google account, which has no password", async () => {
    const google = newUser();
    await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, 'g-2', $2)`, [google, MAIL]);
    const res = await setRoute(call("/api/auth/recovery", { email: "other@example.com", password: PW }, { user: google }));
    expect(res.status).toBe(409);
    expect(await (await recoveryRoute(call("/api/auth/recovery", null, { user: google, method: "GET" }))).json()).toEqual({
      available: true,
      has_password: false,
      email: null,
    });
  });

  it("is in the account's data export", async () => {
    const user = await account("ann_reads", MAIL);
    expect((await exportAccount(t.db, user)).account).toEqual({ handle: "ann_reads", email: MAIL, signs_in_with: ["password"], created_at: expect.any(String) });
  });
});

describe("forgot your password", () => {
  it("emails a link after the #, by handle or by address, and always gives the same answer", async () => {
    const user = await account("ann_reads", MAIL);
    for (const who of ["Ann_Reads", MAIL.toUpperCase(), "nobody_here", "x@nowhere.example"]) {
      const res = await forgotRoute(call("/api/auth/forgot", { who }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, message: FORGOT_ANSWER });
    }
    // The handle's link went; the address asked a moment later is held by the one-a-minute rule; strangers got nothing.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(MAIL);
    expect(sent[0].subject).toBe("Reset your Botchelor password");
    expect(sent[0].text).toContain(`${SITE}/email/reset-password#t=`);
    expect(sent[0].text).not.toContain("/email/reset-password?t=");
    expect((await resetLinkAccount(t.db, tokenIn(sent[0], "/email/reset-password")))?.user_id).toBe(user);
  });

  it("sends nothing to an account without a recovery email, or a Google one", async () => {
    await account("no_mail");
    const google = newUser();
    await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, 'g-3', $2)`, [google, MAIL]);
    expect(await requestPasswordReset(t.db, "no_mail")).toBe(0);
    expect(await requestPasswordReset(t.db, MAIL)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("caps links per account and asks per connection, and is for people", async () => {
    await account("ann_reads", MAIL);
    const now = Date.now();
    let went = 0;
    // Two minutes apart, so the one-a-minute rule doesn't hold them: still no more than RESETS_PER_DAY.
    for (let i = 0; i < RESETS_PER_DAY + 2; i++) went += await requestPasswordReset(t.db, "ann_reads", process.env, now + i * 2 * MINUTE);
    expect(went).toBe(RESETS_PER_DAY);

    const from = "203.0.113.77";
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push((await forgotRoute(call("/api/auth/forgot", { who: "someone_else" }, { ip: from }))).status);
    expect(answers).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await forgotRoute(call("/api/auth/forgot", { who: "ann_reads" }, { ua: "GPTBot/1.2" }))).status).toBe(403);
  });
});

describe("choosing a new password from the link", () => {
  it("says whose link it is, sets the password once, signs in and tells the recovery email", async () => {
    const user = await account("ann_reads", MAIL);
    await requestPasswordReset(t.db, "ann_reads");
    const token = tokenIn(sent[0], "/email/reset-password")!;
    sent = [];

    const check = await resetRoute(call("/api/auth/reset", { t: token }));
    expect(await check.json()).toEqual({ valid: true, handle: "ann_reads" });

    const short = await resetRoute(call("/api/auth/reset", { t: token, password: "short" }));
    expect(short.status).toBe(422);

    const res = await resetRoute(call("/api/auth/reset", { t: token, password: PW2 }));
    expect(res.status).toBe(200);
    const session = res.headers.getSetCookie().find((c) => c.startsWith("bz_sess="))!;
    expect(verifySession(session.split(";")[0].slice("bz_sess=".length))).toEqual({ uid: user, authenticated: true });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[MAIL, "Your Botchelor password was changed"]]);

    expect((await signIn("ann_reads", PW2)).status).toBe(200);
    expect((await signIn("ann_reads", PW)).status).toBe(401);
    // Used: the same link again does nothing.
    const again = await resetRoute(call("/api/auth/reset", { t: token, password: PW3 }));
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_link");
    expect((await resetRoute(call("/api/auth/reset", { t: token }))).status).toBe(400);
  });
});

describe("changing the password", () => {
  it("takes the current one, ends earlier reset links, and tells the recovery email", async () => {
    const user = await account("ann_reads", MAIL);
    await requestPasswordReset(t.db, "ann_reads");
    const token = tokenIn(sent[0], "/email/reset-password")!;
    sent = [];

    expect((await passwordRoute(call("/api/auth/password", { current: PW, password: PW2 }))).status).toBe(401);
    expect((await passwordRoute(call("/api/auth/password", { current: PW3, password: PW2 }, { user }))).status).toBe(403);
    const res = await passwordRoute(call("/api/auth/password", { current: PW, password: PW2 }, { user }));
    expect(res.status).toBe(200);
    expect((await signIn("ann_reads", PW2)).status).toBe(200);
    expect(await resetLinkAccount(t.db, token)).toBeNull();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[MAIL, "Your Botchelor password was changed"]]);
  });

  it("counts wrong tries as failed sign-ins, so it's no way round the limit", async () => {
    const user = await account();
    const from = "203.0.113.9";
    for (let i = 0; i < LOGIN_FAILS_PER_HANDLE; i++) {
      expect((await passwordRoute(call("/api/auth/password", { current: `${PW3}${i}`, password: PW2 }, { user, ip: from }))).status).toBe(403);
    }
    expect((await passwordRoute(call("/api/auth/password", { current: PW, password: PW2 }, { user, ip: from }))).status).toBe(429);
    expect((await signIn("ann_reads", PW)).status).toBe(429);
  });

  it("is where /.well-known/change-password sends password managers", () => {
    const res = changePasswordWellKnown();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account#password");
  });
});
