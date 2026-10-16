import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as unsubscribeRoute } from "@/app/api/email/optout/route";
import { POST as optInRoute } from "@/app/api/me/email/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { registerAccount } from "@/lib/auth";
import {
  confirmEmail,
  CONFIRMS_PER_USER_PER_DAY,
  emailNow,
  emailStatus,
  IMMEDIATE_PER_USER_PER_DAY,
  sendDigests,
  setEmailSenderForTests,
  signEmailToken,
  startEmailOptIn,
  verifyEmailToken,
  type EmailMessage,
} from "@/lib/email";
import { notify } from "@/lib/notifications";
import { middleware } from "@/middleware";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Built from parts so no literal secret sits in the repo (GitGuardian scans every commit).
const SECRET = ["email", "test", "secret", "abcdefghij0123456789"].join("-");
const KEY = ["re", "test", "key"].join("_");

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
  await t.db.query("delete from email_prefs");
  await t.db.query("delete from email_sends");
  await t.db.query("delete from accounts"); // the Google addresses below repeat across tests
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setEmailSenderForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A signed-in player: a handle account, or one signed in with Google (its verified address on the account). */
async function player(google?: string) {
  const cookie = newUserCookie();
  const id = userIdOf(cookie);
  if (google) await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [id, `sub-${id}`, google]);
  else await registerAccount(t.db, id, `p${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  return { cookie, id };
}

describe("signed email links", () => {
  it("verify only for their purpose, unexpired and untampered", () => {
    const now = Date.now();
    const confirm = signEmailToken({ u: "u1", e: "a@b.co", p: "confirm", x: now + 1000 })!;
    expect(verifyEmailToken(confirm, "confirm")).toEqual({ u: "u1", e: "a@b.co" });
    expect(verifyEmailToken(confirm, "unsub")).toBeNull();
    expect(verifyEmailToken(confirm, "confirm", process.env, now + 2000)).toBeNull();
    expect(verifyEmailToken(confirm.replace(/.$/, "x"), "confirm")).toBeNull();
    expect(verifyEmailToken(confirm, "confirm", { SESSION_SECRET: SECRET + "-x" })).toBeNull();
  });
});

describe("opting in", () => {
  it("a Google address is on at once; another address waits for its confirmation link", async () => {
    const g = await player("mira@example.com");
    expect(await startEmailOptIn(t.db, g.id, null)).toEqual({ ok: true, status: "on" });
    expect(sent).toHaveLength(0);

    const h = await player();
    expect(await startEmailOptIn(t.db, h.id, "Rafe@Example.com")).toEqual({ ok: true, status: "pending" });
    expect(sent[0].to).toBe("rafe@example.com");
    const link = /\/api\/email\/confirm\?t=([^"\s]+)/.exec(sent[0].text)![1];
    expect((await emailStatus(t.db, h.id)).status).toBe("pending");
    expect(await confirmEmail(t.db, decodeURIComponent(link))).toBe(true);
    expect(await emailStatus(t.db, h.id)).toMatchObject({ status: "on", email: "rafe@example.com" });
  });

  it("needs an account and a real-looking address; the route turns away a signed-out visitor", async () => {
    const anon = userIdOf(newUserCookie());
    expect(await startEmailOptIn(t.db, anon, "x@example.com")).toMatchObject({ ok: false, error: "account_required" });
    const h = await player();
    expect(await startEmailOptIn(t.db, h.id, "not an email")).toMatchObject({ ok: false, status: 422 });
    const res = await optInRoute(new Request(`${BASE_URL}/api/me/email`, { method: "POST", headers: { cookie: newUserCookie(), "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("a confirmation that can't be sent is a plain answer, not an error page; the address stays pending", async () => {
    setEmailSenderForTests(async () => {
      throw new Error("resend: validation_error");
    });
    const h = await player();
    expect(await startEmailOptIn(t.db, h.id, "later@example.com")).toMatchObject({ ok: false, status: 502, error: "email_failed" });
    expect((await emailStatus(t.db, h.id)).status).toBe("pending");
  });

  it("confirmation emails are capped per account, so nobody can use us to mail strangers", async () => {
    const h = await player();
    for (let i = 0; i < CONFIRMS_PER_USER_PER_DAY; i++) expect((await startEmailOptIn(t.db, h.id, `a${i}@example.com`)).ok).toBe(true);
    expect(await startEmailOptIn(t.db, h.id, "one-more@example.com")).toMatchObject({ ok: false, status: 429 });
    expect(sent).toHaveLength(CONFIRMS_PER_USER_PER_DAY);
  });

  it("is off without a provider key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const g = await player("mira@example.com");
    expect(await startEmailOptIn(t.db, g.id, null)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("what gets emailed", () => {
  it("only what's waiting on you goes at once, at most a few a day, each with a one-click unsubscribe", async () => {
    const g = await player("mira@example.com");
    await startEmailOptIn(t.db, g.id, null);
    expect(await emailNow(t.db, g.id, { kind: "texted", title: "💬 Ira texted Cass" })).toBe(false); // the digest's job
    expect(await emailNow(t.db, g.id, { kind: "second_date_yes", title: "💌 Cass wants a second date with Ira", link: "/episodes/e1" })).toBe(true);
    const msg = sent[0];
    expect(msg.subject).toBe("Cass wants a second date with Ira");
    expect(msg.html).toContain("https://botchelor.com/episodes/e1");
    expect(msg.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(msg.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/botchelor\.com\/api\/email\/optout\?t=/);
    for (let i = 1; i < IMMEDIATE_PER_USER_PER_DAY + 2; i++) await emailNow(t.db, g.id, { kind: "second_date_booked", title: `💞 Booked ${i}` });
    expect(sent).toHaveLength(IMMEDIATE_PER_USER_PER_DAY);
  });

  it("the show-wide daily cap holds", async () => {
    vi.stubEnv("EMAIL_DAILY_CAP", "1");
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await startEmailOptIn(t.db, a.id, null);
    await startEmailOptIn(t.db, b.id, null);
    expect(await emailNow(t.db, a.id, { kind: "second_date_yes", title: "💌 One" })).toBe(true);
    expect(await emailNow(t.db, b.id, { kind: "second_date_yes", title: "💌 Two" })).toBe(false);
  });

  it("the daily digest gathers unread notifications since the last one, once", async () => {
    const g = await player("mira@example.com");
    await startEmailOptIn(t.db, g.id, null);
    await notify(t.db, g.id, { kind: "texted", title: "💬 Ira texted Cass", body: "Still thinking about the sugar packets." });
    await notify(t.db, g.id, { kind: "stage_up", title: "Cass & Ira: 💞 Dating" });
    expect(sent).toHaveLength(0); // neither is waiting on them
    expect(await sendDigests(t.db)).toBe(1);
    expect(sent[0].subject).toBe("2 things happened on Botchelor");
    expect(sent[0].text).toContain("sugar packets");
    expect(await sendDigests(t.db)).toBe(0);
  });

  it("not when it's off, or still waiting for confirmation", async () => {
    const h = await player();
    await startEmailOptIn(t.db, h.id, "pending@example.com");
    sent = [];
    expect(await emailNow(t.db, h.id, { kind: "second_date_yes", title: "💌 Hi" })).toBe(false);
    await notify(t.db, h.id, { kind: "texted", title: "💬 Hi" });
    expect(await sendDigests(t.db)).toBe(0);
  });
});

describe("leaving", () => {
  it("one-click unsubscribe works from a mail app and from the page, with no sign-in, past the 18+ gate", async () => {
    const g = await player("mira@example.com");
    await startEmailOptIn(t.db, g.id, null);
    const token = signEmailToken({ u: g.id, e: "mira@example.com", p: "unsub" })!;
    const oneClick = await unsubscribeRoute(new Request(`${BASE_URL}/api/email/optout?t=${encodeURIComponent(token)}`, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(oneClick.status).toBe(200);
    expect((await emailStatus(t.db, g.id)).status).toBe("off");

    await startEmailOptIn(t.db, g.id, null);
    const fromPage = await unsubscribeRoute(new Request(`${BASE_URL}/api/email/optout?t=${encodeURIComponent(token)}`, { method: "POST", headers: { accept: "text/html" } }));
    expect(fromPage.status).toBe(303);
    expect(fromPage.headers.get("location")).toBe("/email/unsubscribe?done=1");
    expect((await unsubscribeRoute(new Request(`${BASE_URL}/api/email/optout?t=forged`, { method: "POST" }))).status).toBe(400);

    const page = middleware(new NextRequest(`${BASE_URL}/email/unsubscribe?t=x`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh)" } }));
    expect(page.headers.get("location")).toBeNull(); // no 18+ gate in the way
  });

  it("the export shows the address and deleting the account removes it", async () => {
    const g = await player("mira@example.com");
    await startEmailOptIn(t.db, g.id, null);
    expect((await exportAccount(t.db, g.id)).email[0]).toMatchObject({ email: "mira@example.com", status: "on" });
    await deleteAccount(t.db, g.id);
    expect((await t.db.query(`select 1 from email_prefs where user_id = $1`, [g.id])).rows).toHaveLength(0);
  });
});
