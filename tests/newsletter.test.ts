// The Sunday letter (lib/newsletter.ts, lib/newsletter-issue.ts, docs/newsletter.md): a weekly email anyone can sign up
// for, confirmed by email, with a one-click way out in every email; built once a week after Sunday's reveal and sent in
// capped batches, each address once. Off without email, no letter without a postal address, never on After Dark's host.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The root layout reads the viewer from next/headers (an anonymous visitor here), and its nav the page it's on.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "@/app/layout";
import { GET as adminRoute } from "@/app/api/admin/newsletter/route";
import { POST as confirmRoute } from "@/app/api/newsletter/confirm/route";
import { POST as optoutRoute } from "@/app/api/newsletter/optout/route";
import { POST as signUpRoute } from "@/app/api/newsletter/route";
import ConfirmPage from "@/app/newsletter/confirm/page";
import UnsubscribePage from "@/app/newsletter/unsubscribe/page";
import { SECRET_POOL } from "@/lib/cast-secrets";
import { setEmailSenderForTests, signEmailToken, verifyEmailToken, type EmailMessage } from "@/lib/email";
import { HOUSE_CHARACTERS } from "@/lib/house";
import {
  addSignUp,
  catchUpConfirmations,
  confirmSubscription,
  leaveNewsletter,
  letterEmail,
  logNewsletterSend,
  newsletterBudget,
  newsletterDailyCap,
  newsletterState,
  postalAddress,
  pruneNewsletter,
  sendConfirmation,
  signNewsletterToken,
  SIGNUP_LIMITS,
  verifyNewsletterToken,
} from "@/lib/newsletter";
import { ensureIssue, isoWeekId, letterWeek, runNewsletter } from "@/lib/newsletter-issue";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { ensureRevealVote, runDueReveal, voteReveal } from "@/lib/weekly-reveal";
import { middleware } from "@/middleware";
import { BASE_URL, episodeJson, scriptedModel, startTestDb } from "./helpers";

// Built from parts so no literal secret sits in the repo (GitGuardian scans every commit).
const SECRET = ["newsletter", "test", "secret", "abcdefghij0123456789"].join("-");
const KEY = ["re", "test", "key"].join("_");
const ADMIN_PW = ["admin", "test", "password"].join("-");
const SITE = "https://botchelor.com";
const AD = "https://ad.botchelor.com";
const POSTAL = "PO Box 1234, Portland, OR 97201";
const ON = { RESEND_API_KEY: KEY, SESSION_SECRET: SECRET, SITE_URL: SITE, NEWSLETTER_POSTAL_ADDRESS: POSTAL };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LETTER = /^The Sunday letter/;

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
  await t.db.query("delete from email_sends");
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
});
afterEach(() => {
  setEmailSenderForTests(null);
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let ip = 0;
/** A sign-up from a browser, from its own address unless one is given. */
const signUp = (body: unknown, opts: { ip?: string; ua?: string } = {}) =>
  signUpRoute(
    new Request(`${BASE_URL}/api/newsletter`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": opts.ip ?? `203.0.113.${(++ip % 250) + 1}`, "user-agent": opts.ua ?? "Mozilla/5.0 (Macintosh)" },
      body: JSON.stringify(body),
    }),
  );
/** The token in a link an email's text carries to `path`. */
const tokenIn = (msg: EmailMessage, path: string): string | null => {
  const m = msg.text.match(new RegExp(`${SITE.replace(/[.]/g, "\\.")}${path}\\?t=(\\S+)`));
  return m ? decodeURIComponent(m[1]) : null;
};
type Row = { status: string; confirms_sent: number; unsubscribed_at: unknown; pending_since: unknown; confirmed_at: unknown };
const row = async (email: string): Promise<Row | undefined> => (await t.db.query<Row>(`select * from newsletter_subscribers where email = $1`, [email])).rows[0];
const confirmed = async (...emails: string[]) => {
  for (const e of emails) await t.db.query(`insert into newsletter_subscribers (email, status, confirmed_at, attested_adult_at) values ($1, 'confirmed', $2, $2)`, [e, "2026-11-01T00:00:00Z"]);
};
const letters = () => sent.filter((m) => LETTER.test(m.subject));

let seq = 0;
async function character(name: string): Promise<string> {
  const id = `nl-${++seq}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, created_via)
     values ($1, $2, false, $3, 30, 'Keeps bees.', '["dry"]'::jsonb, 'x', 'x', 'public', 'web')`,
    [id, `owner-${id}`, name],
  );
  return id;
}
async function date(id: string, a: string, b: string, opts: { aired: string; ending?: string; title?: string | null; visibility?: string }): Promise<void> {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility, setup, title)
     values ($1, 'someone', $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, 'ready', $7, '{}'::jsonb, $8)`,
    [id, a, b, `A rooftop at dusk for ${id}, where the <string> lights keep failing.`, opts.ending ?? "friends", opts.aired, opts.visibility ?? "public", opts.title ?? null],
  );
}
/** The week's dates: two that aired publicly, one private that never shows, and a board with one named caller. */
async function week() {
  const [a, b, c, d] = await Promise.all(["Mara Vance", "Jules Okafor", "Odile Brand", "Hal Pruitt"].map((n) => character(n)));
  await date("e-w1", a, b, { aired: "2026-11-13T10:00:00Z", ending: "friends", title: "The String Lights Hold" });
  await date("e-w2", c, d, { aired: "2026-11-14T10:00:00Z", ending: "disaster" });
  await date("e-private", a, d, { aired: "2026-11-14T12:00:00Z", visibility: "private" });
  await t.db.query(`insert into profiles (user_id, name) values ('u-ana', 'Ana <b>')`);
  await t.db.query(
    `insert into predictions (episode_id, user_id, pick) values ('e-w1', 'u-ana', 'friends'), ('e-w2', 'u-ana', 'disaster'), ('e-w1', 'u-anon', 'friends'), ('e-w2', 'u-anon', 'friends'),
       ('e-private', 'p1', 'friends'), ('e-private', 'p2', 'friends'), ('e-private', 'p3', 'friends')`,
  );
}

const CAST = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
const SEASON = "2026-11-01";
const SAT_OPEN = new Date("2026-11-14T19:20:00Z");
const SUN_MORNING = new Date("2026-11-15T10:20:00Z");
const SUN_AIR = new Date("2026-11-15T19:20:00Z");

async function storeSecrets() {
  setSeasonCastForTests(CAST);
  for (const [i, id] of CAST.entries()) {
    for (let idx = 0; idx < 3; idx++) {
      await t.db.query(`insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, $2, $3, $4, 'pool')`, [id, SEASON, idx, SECRET_POOL[i * 3 + idx]]);
    }
  }
}
/** Saturday's vote, three votes, and Sunday's reveal with its date. */
async function reveal() {
  await storeSecrets();
  const vote = (await ensureRevealVote(t.db, SAT_OPEN))!;
  const [a, , c] = vote.choices.map((x) => x.id);
  await voteReveal(t.db, "u1", c, SAT_OPEN);
  await voteReveal(t.db, "u2", c, SAT_OPEN);
  await voteReveal(t.db, "u3", a, SAT_OPEN);
  scriptedModel([episodeJson()]);
  const run = await runDueReveal(t.db, SUN_AIR);
  if (!run.ran) throw new Error(`not run: ${run.reason}`);
  return { winner: vote.choices.find((x) => x.id === c)!, secret: SECRET_POOL[CAST.indexOf(c) * 3], room: run.room_path };
}

describe("its settings", () => {
  it("is on with email and a postal address, waits for the address, and is off without email or on After Dark's host", () => {
    expect(newsletterState(ON)).toBe("on");
    expect(newsletterState({ ...ON, NEWSLETTER_POSTAL_ADDRESS: "CHANGE_ME" })).toBe("waiting_for_address");
    expect(newsletterState({ ...ON, NEWSLETTER_POSTAL_ADDRESS: "  " })).toBe("waiting_for_address");
    expect(newsletterState({ ...ON, RESEND_API_KEY: "" })).toBe("off");
    expect(newsletterState({ ...ON, RESEND_API_KEY: "CHANGE_ME" })).toBe("off");
    expect(newsletterState({ ...ON, SESSION_SECRET: "" })).toBe("off");
    expect(newsletterState({ ...ON, AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" })).toBe("off");
    expect(postalAddress({ NEWSLETTER_POSTAL_ADDRESS: " PO Box 1234\n  Portland, OR 97201 " })).toBe("PO Box 1234 Portland, OR 97201");
    expect([newsletterDailyCap({}), newsletterDailyCap({ NEWSLETTER_DAILY_CAP: "CHANGE_ME" }), newsletterDailyCap({ NEWSLETTER_DAILY_CAP: "lots" })]).toEqual([40, 40, 40]);
    expect(newsletterDailyCap({ NEWSLETTER_DAILY_CAP: "12" })).toBe(12);
  });

  it("keys a letter by the ISO week of its Sunday, and is due only in the two days after the reveal airs", () => {
    expect(isoWeekId("2026-11-15")).toBe("2026-W46");
    expect(isoWeekId("2027-01-03")).toBe("2026-W53");
    expect(isoWeekId("2027-01-10")).toBe("2027-W01");
    expect(letterWeek(SUN_MORNING)).toBeNull();
    expect(letterWeek(SUN_AIR)).toBe("2026-11-15");
    expect(letterWeek(new Date("2026-11-17T19:19:00Z"))).toBe("2026-11-15");
    expect(letterWeek(new Date("2026-11-17T19:21:00Z"))).toBeNull();
  });
});

describe("signing up", () => {
  it("answers the same for a new, pending, confirmed or unsubscribed address, and only a new spell gets a confirmation", async () => {
    const answers: string[] = [];
    const answer = async (email: string) => {
      const res = await signUp({ email, attest: true });
      expect(res.headers.get("set-cookie")).toBeNull();
      answers.push(`${res.status} ${await res.text()}`);
    };
    await answer("  Mira@Example.COM ");
    expect(await row("mira@example.com")).toMatchObject({ status: "pending", confirms_sent: 1 });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["mira@example.com", "Confirm the Sunday letter from Botchelor"]]);
    // Pending: no second email the same day.
    await answer("mira@example.com");
    expect(sent).toHaveLength(1);
    // Confirmed: nothing sent, nothing changed.
    expect(await confirmSubscription(t.db, tokenIn(sent[0], "/newsletter/confirm"))).toBe(true);
    await answer("mira@example.com");
    expect(sent).toHaveLength(1);
    expect((await row("mira@example.com"))?.status).toBe("confirmed");
    // Left: a new pending spell, whose confirmation waits for tomorrow (one a day to an address, whatever it did).
    expect(await leaveNewsletter(t.db, tokenIn(sent[0], "/newsletter/unsubscribe"))).toBe(true);
    await answer("mira@example.com");
    expect(await row("mira@example.com")).toMatchObject({ status: "pending", confirms_sent: 0 });
    expect(new Set(answers)).toEqual(new Set(['201 {"ok":true}']));
  });

  it("checks the address and the 18+ box as the waitlist does, and is for people, not bots", async () => {
    for (const body of [{ email: "not-an-email", attest: true }, { email: "a@example.com" }, { email: "a@example.com", attest: false }, { email: `${"a".repeat(250)}@example.com`, attest: true }]) {
      expect((await signUp(body)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await signUp({ email: "a@example.com", attest: true }, { ua: "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)" })).status).toBe(403);
    expect(await t.count("newsletter_subscribers")).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("takes a few sign-ups an hour from one connection", async () => {
    for (let i = 0; i < SIGNUP_LIMITS.perHour; i++) expect((await signUp({ email: `p${i}@example.com`, attest: true }, { ip: "198.51.100.7" })).status).toBe(201);
    expect((await signUp({ email: "p9@example.com", attest: true }, { ip: "198.51.100.7" })).status).toBe(429);
    expect((await signUp({ email: "p9@example.com", attest: true }, { ip: "198.51.100.8" })).status).toBe(201);
  });

  it("is off without email and on After Dark's host: no sign-ups, no footer form, no job", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await signUp({ email: "a@example.com", attest: true })).status).toBe(503);
    const footer = async () => {
      const html = renderToStaticMarkup(await RootLayout({ children: null }));
      return html.slice(html.indexOf('<footer class="site-footer"'));
    };
    expect(await footer()).not.toContain("footer-newsletter");
    vi.stubEnv("RESEND_API_KEY", KEY);
    expect(await footer()).toMatch(/<section class="footer-newsletter" aria-label="The Sunday letter">.*<input id="newsletter-footer-email" type="email"/);
    vi.stubEnv("AFTER_DARK_ORIGIN", AD);
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    expect(await footer()).not.toContain("footer-newsletter");
    expect((await signUp({ email: "a@example.com", attest: true })).status).toBe(503);
    expect(await runNewsletter(t.db, SUN_AIR, { env: { ...ON, AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" } })).toBe("off");
    expect(await t.count("newsletter_subscribers")).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("leaves the footer form off the letter's own pages, which already ask or have just been answered", async () => {
    vi.stubEnv("RESEND_API_KEY", KEY);
    const footer = async (path: string) => {
      nav.pathname = path;
      const html = renderToStaticMarkup(await RootLayout({ children: null }));
      return html.slice(html.indexOf('<footer class="site-footer"'));
    };
    try {
      expect(await footer("/pricing")).toContain("footer-newsletter");
      for (const path of ["/newsletter", "/newsletter/confirm", "/newsletter/unsubscribe"]) {
        expect(await footer(path), path).not.toContain("footer-newsletter");
      }
    } finally {
      nav.pathname = "/";
    }
  });
});

describe("its links", () => {
  it("are signed for one purpose, apart from the show's own email links, and a confirmation's lapses after 7 days", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const confirm = signNewsletterToken({ e: "a@example.com", p: "confirm", x: now + 7 * DAY }, ON)!;
    const unsub = signNewsletterToken({ e: "a@example.com", p: "unsub" }, ON)!;
    expect([verifyNewsletterToken(confirm, "confirm", ON, now), verifyNewsletterToken(unsub, "unsub", ON, now)]).toEqual(["a@example.com", "a@example.com"]);
    expect([verifyNewsletterToken(confirm, "unsub", ON, now), verifyNewsletterToken(unsub, "confirm", ON, now)]).toEqual([null, null]);
    expect(verifyNewsletterToken(confirm, "confirm", ON, now + 7 * DAY + 1)).toBeNull();
    expect(verifyNewsletterToken(unsub, "unsub", ON, now + 400 * DAY)).toBe("a@example.com");
    expect(verifyNewsletterToken(signNewsletterToken({ e: "a@example.com", p: "confirm" }, ON), "confirm", ON, now)).toBeNull();
    // The show's notification emails sign their own (lib/email.ts): neither works in the other's place.
    expect(verifyNewsletterToken(signEmailToken({ u: "u1", e: "a@example.com", p: "unsub" }, ON), "unsub", ON, now)).toBeNull();
    expect(verifyEmailToken(unsub, "unsub", ON, now)).toBeNull();
    // Another secret, another address under the same signature, an extra part, or no secret at all: nothing.
    expect(verifyNewsletterToken(unsub, "unsub", { SESSION_SECRET: `${SECRET}x` }, now)).toBeNull();
    const [payload, sig] = unsub.split(".");
    expect(verifyNewsletterToken(`${Buffer.from(JSON.stringify({ e: "b@example.com", p: "unsub" })).toString("base64url")}.${sig}`, "unsub", ON, now)).toBeNull();
    expect(verifyNewsletterToken(`${payload}.${sig}.x`, "unsub", ON, now)).toBeNull();
    expect(signNewsletterToken({ e: "a@example.com", p: "unsub" }, {})).toBeNull();
  });

  it("confirm with the page's button, not on opening, past the 18+ gate; the sign-up page itself stays behind it", async () => {
    await signUp({ email: "ira@example.com", attest: true });
    const token = tokenIn(sent[0], "/newsletter/confirm")!;
    expect(sent[0].text).toContain("The link works for 7 days.");
    // Opening the link shows a button and changes nothing (mail scanners open links).
    const page = renderToStaticMarkup(await ConfirmNewsletterPage(token));
    expect(page).toContain(`<form action="/api/newsletter/confirm?t=${encodeURIComponent(token)}" method="post">`);
    expect((await row("ira@example.com"))?.status).toBe("pending");
    const post = (t: string, accept?: string) => confirmRoute(new Request(`${BASE_URL}/api/newsletter/confirm?t=${encodeURIComponent(t)}`, { method: "POST", headers: accept ? { accept } : {} }));
    const res = await post(token, "text/html");
    expect([res.status, res.headers.get("location")]).toEqual([303, "/newsletter/confirm?done=1"]);
    expect((await row("ira@example.com"))?.status).toBe("confirmed");
    const again = await post(token);
    expect([again.status, await again.json()]).toEqual([200, { confirmed: true }]);
    expect((await post("forged", "text/html")).headers.get("location")).toBe("/newsletter/confirm?invalid=1");

    const browser = { "user-agent": "Mozilla/5.0 (Macintosh)" };
    expect(middleware(new NextRequest(`${BASE_URL}/newsletter/confirm?t=x`, { headers: browser })).headers.get("location")).toBeNull();
    expect(middleware(new NextRequest(`${BASE_URL}/newsletter/unsubscribe?t=x`, { headers: browser })).headers.get("location")).toBeNull();
    expect(middleware(new NextRequest(`${BASE_URL}/newsletter`, { headers: browser })).headers.get("location")).toMatch(/\/gate/);
  });

  it("an old confirmation link can't bring back an address that left, nor one past its week", async () => {
    const now = new Date();
    await addSignUp(t.db, "old@example.com", now);
    expect(await sendConfirmation(t.db, "old@example.com", now, ON)).toBe("sent");
    const token = tokenIn(sent[0], "/newsletter/confirm");
    expect(await confirmSubscription(t.db, token, new Date(now.getTime() + 8 * DAY), ON)).toBe(false);
    expect(await leaveNewsletter(t.db, tokenIn(sent[0], "/newsletter/unsubscribe"), now, ON)).toBe(true);
    expect(await confirmSubscription(t.db, token, now, ON)).toBe(false);
    expect((await row("old@example.com"))?.status).toBe("unsubscribed");
  });
});

/** The confirmation page as a browser opening the link gets it. */
const ConfirmNewsletterPage = (token: string) => ConfirmPage({ searchParams: Promise.resolve({ t: token }) });

describe("confirmations", () => {
  it("go to an address once a day at most and three times a spell, and a spell nobody confirms is forgotten after 30 days", async () => {
    const day0 = new Date("2026-11-10T12:00:00Z");
    const at = (hours: number) => new Date(day0.getTime() + hours * HOUR);
    await addSignUp(t.db, "kit@example.com", day0);
    expect(await sendConfirmation(t.db, "kit@example.com", day0, ON)).toBe("sent");
    expect(await sendConfirmation(t.db, "kit@example.com", at(23), ON)).toBe("not_due");
    expect(await sendConfirmation(t.db, "kit@example.com", at(25), ON)).toBe("sent");
    expect(await sendConfirmation(t.db, "kit@example.com", at(50), ON)).toBe("sent");
    expect(await sendConfirmation(t.db, "kit@example.com", at(75), ON)).toBe("not_due");
    expect(sent).toHaveLength(3);
    // The hourly job never sends a reminder: it only catches up an address that never got one.
    expect(await catchUpConfirmations(t.db, at(100), ON)).toBe(0);
    // Signing up again doesn't restart the 30 days.
    await addSignUp(t.db, "kit@example.com", at(20 * 24));
    expect(await pruneNewsletter(t.db, at(29 * 24))).toBe(0);
    expect(await pruneNewsletter(t.db, at(31 * 24))).toBe(1);
    expect(await row("kit@example.com")).toBeUndefined();
  });

  it("an address that had left goes back to unsubscribed when its new sign-up isn't confirmed", async () => {
    const day0 = new Date("2026-11-10T12:00:00Z");
    await confirmed("lou@example.com");
    expect(await leaveNewsletter(t.db, signNewsletterToken({ e: "lou@example.com", p: "unsub" }, ON), day0, ON)).toBe(true);
    await addSignUp(t.db, "lou@example.com", new Date(day0.getTime() + DAY));
    expect((await row("lou@example.com"))?.status).toBe("pending");
    expect(await pruneNewsletter(t.db, new Date(day0.getTime() + 32 * DAY))).toBe(1);
    expect(await row("lou@example.com")).toMatchObject({ status: "unsubscribed", pending_since: null });
    expect((await row("lou@example.com"))?.unsubscribed_at).toBeTruthy();
  });

  it("one the day's cap held back goes from the hourly job once there's room", async () => {
    const env = { ...ON, NEWSLETTER_DAILY_CAP: "2" };
    const now = new Date();
    await logNewsletterSend(t.db, "newsletter_confirm");
    await logNewsletterSend(t.db, "newsletter_confirm");
    await addSignUp(t.db, "late@example.com", now);
    expect(await sendConfirmation(t.db, "late@example.com", now, env)).toBe("capped");
    expect(await catchUpConfirmations(t.db, now, env)).toBe(0);
    await t.db.query(`update email_sends set created_at = now() - interval '25 hours'`);
    expect(await catchUpConfirmations(t.db, now, env)).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["late@example.com"]);
  });
});

describe("leaving", () => {
  it("takes one click from a mail app (RFC 8058) or the page's button, and holds until a new sign-up is confirmed", async () => {
    await signUp({ email: "ana@example.com", attest: true });
    const [confirmation] = sent;
    expect(await confirmSubscription(t.db, tokenIn(confirmation, "/newsletter/confirm"))).toBe(true);
    expect(confirmation.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const oneClick = confirmation.headers["List-Unsubscribe"].slice(1, -1);
    expect(oneClick).toMatch(/^https:\/\/botchelor\.com\/api\/newsletter\/optout\?t=[^&\s]+$/);
    const res = await optoutRoute(new Request(oneClick, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
    expect([res.status, await res.json()]).toEqual([200, { unsubscribed: true }]);
    expect(await row("ana@example.com")).toMatchObject({ status: "unsubscribed" });
    expect((await row("ana@example.com"))?.unsubscribed_at).toBeTruthy();

    // The page: a button that posts the same token, then back to the page.
    const token = tokenIn(confirmation, "/newsletter/unsubscribe")!;
    const page = renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve({ t: token }) }));
    expect(page).toContain(`<form action="/api/newsletter/optout?t=${encodeURIComponent(token)}" method="post">`);
    const fromPage = await optoutRoute(new Request(oneClick, { method: "POST", headers: { accept: "text/html" } }));
    expect([fromPage.status, fromPage.headers.get("location")]).toEqual([303, "/newsletter/unsubscribe?done=1"]);
    expect((await optoutRoute(new Request(`${BASE_URL}/api/newsletter/optout?t=forged`, { method: "POST" }))).status).toBe(400);

    // Signing up again starts a pending spell: no letter goes to it until that's confirmed.
    await signUp({ email: "ana@example.com", attest: true });
    expect((await row("ana@example.com"))?.status).toBe("pending");
  });

  it("an unsubscribe link from an address the list already forgot still records that it left", async () => {
    expect(await leaveNewsletter(t.db, signNewsletterToken({ e: "gone@example.com", p: "unsub" }, ON), new Date(), ON)).toBe(true);
    expect(await row("gone@example.com")).toMatchObject({ status: "unsubscribed" });
  });
});

describe("the weekly letter", () => {
  it("is built once Sunday's reveal has aired and settled: the reveal, the best dates, the board and what's next, to confirmed addresses only", async () => {
    const { winner, secret, room } = await reveal();
    await week();
    await confirmed("one@example.com", "two@example.com");
    await addSignUp(t.db, "pending@example.com", SAT_OPEN);
    await t.db.query(`insert into newsletter_subscribers (email, status, unsubscribed_at) values ('gone@example.com', 'unsubscribed', $1)`, [SAT_OPEN.toISOString()]);

    expect(await ensureIssue(t.db, SUN_MORNING, ON)).toBeNull();
    const pass = await runNewsletter(t.db, SUN_AIR, { env: ON, pauseMs: 0 });
    // The pending address got its confirmation (it never had one), and no letter.
    expect(pass).toEqual({ issue: "2026-W46", sent: 2, failed: 0, left: 0, confirmations: 1, pruned: 0, pending: 1, confirmed: 2 });
    expect(letters().map((m) => m.to).sort()).toEqual(["one@example.com", "two@example.com"]);

    const [letter] = letters();
    const tag = "utm_source=newsletter&utm_medium=email&utm_campaign=2026-W46";
    expect(letter.subject).toBe(`The Sunday letter: ${winner.name}'s secret is out`);
    expect(letter.text).toMatch(/^The Sunday letter · 15 November 2026\n\nSunday's reveal: /);
    expect(letter.text).toContain(`“${secret}”\n2 of 3 votes.`);
    expect(letter.text).toContain(`${SITE}${room}?${tag}`);
    expect(letter.text).toContain(`The week's best dates`);
    expect(letter.text).toContain(`Mara Vance × Jules Okafor\n“The String Lights Hold”\nA rooftop at dusk for e-w1`);
    expect(letter.text).toContain(`${SITE}/episodes/e-w1?${tag}`);
    expect(letter.text).not.toContain("e-private");
    expect(letter.text).toMatch(/Best callers this week\n1\. Ana <b>: 2 of 2\n2\. A viewer: 1 of 2\n/);
    expect(letter.text).toContain(`Next: the vote on whose secret comes out opens Saturday 21 November at 19:00 UTC.\n${SITE}/watch?${tag}#sunday-reveal`);
    // HTML-escaped as HTML: what the show wrote and what people named themselves stay words.
    expect(letter.html).toContain("Ana &lt;b&gt;: 2 of 2");
    expect(letter.html).toContain("the &lt;string&gt; lights");
    expect(letter.html).not.toMatch(/<b>|<string>/);
    // The small print: why it came, this address's own way out (never tagged), the postal address, the one-click headers.
    expect(letter.text).toContain(`Unsubscribe: ${SITE}/newsletter/unsubscribe?t=`);
    expect(letter.text).toMatch(new RegExp(`Botchelor · ${POSTAL}$`));
    expect(letter.html).toContain(`Botchelor · ${POSTAL}`);
    expect(letter.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/botchelor\.com\/api\/newsletter\/optout\?t=[^>]+>$/);
    const [a, b] = letters();
    expect(verifyNewsletterToken(tokenIn(a, "/newsletter/unsubscribe"), "unsub", ON)).toBe(a.to);
    expect(verifyNewsletterToken(tokenIn(b, "/newsletter/unsubscribe"), "unsub", ON)).toBe(b.to);

    // Once: the next pass builds nothing new and sends nothing again.
    sent = [];
    expect(await runNewsletter(t.db, new Date("2026-11-15T20:20:00Z"), { env: ON, pauseMs: 0 })).toMatchObject({ issue: "2026-W46", sent: 0, left: 0 });
    expect(letters()).toHaveLength(0);
    expect(await t.count("newsletter_issues")).toBe(1);
    expect(await t.count("newsletter_sends", "sent_at is not null")).toBe(2);
  });

  it("waits while the reveal's date is still being made, stops waiting when Sunday is over, and goes without a reveal when there was no vote", async () => {
    await week();
    await confirmed("one@example.com");
    // No vote this week: the letter goes with the dates alone.
    expect(await runNewsletter(t.db, SUN_AIR, { env: ON, pauseMs: 0 })).toMatchObject({ issue: "2026-W46", sent: 1 });
    expect(letters()[0].subject).toBe("The Sunday letter: the week's best dates");
    expect(letters()[0].text).not.toContain("Sunday's reveal");

    // The next week: revealed, but its date failed once and has a try left.
    await t.db.query("delete from newsletter_issues");
    await storeSecrets();
    const vote = (await ensureRevealVote(t.db, SAT_OPEN))!;
    await t.db.query(
      `update weekly_reveals set revealed_at = $2, winner = $3, secret_idx = 0, votes = 0, total = 0, producers_pick = true, date_tries = 1 where week_id = $1`,
      ["2026-11-15", SUN_AIR.toISOString(), vote.choices[0].id],
    );
    expect(await ensureIssue(t.db, new Date("2026-11-15T20:20:00Z"), ON)).toBeNull();
    const monday = await ensureIssue(t.db, new Date("2026-11-16T00:20:00Z"), ON);
    expect(monday?.subject).toBe(`The Sunday letter: ${vote.choices[0].name}'s secret is out`);
    expect(monday?.text).toContain("Nobody voted, so the producers picked. See their secrets.");
    expect(monday?.text).toContain(`/characters/${vote.choices[0].id}?utm_source=newsletter&utm_medium=email&utm_campaign=2026-W46#secrets`);
  });

  it("never builds old news, and a letter stops going out after six days", async () => {
    await week();
    await confirmed("one@example.com");
    expect(await ensureIssue(t.db, new Date("2026-11-17T19:21:00Z"), ON)).toBeNull();
    expect(await ensureIssue(t.db, SUN_AIR, { ...ON, NEWSLETTER_DAILY_CAP: "0" })).not.toBeNull();
    // Built, but the cap sent nothing; a new subscriber a week on gets nothing from it either.
    await confirmed("late@example.com");
    expect(await runNewsletter(t.db, new Date(SUN_AIR.getTime() + 6 * DAY + HOUR), { env: ON, pauseMs: 0 })).toMatchObject({ issue: null, sent: 0 });
    expect(letters()).toHaveLength(0);
  });

  it("keeps to NEWSLETTER_DAILY_CAP with a quarter of it kept for confirmations, and to what's left of the show's EMAIL_DAILY_CAP", async () => {
    await week();
    await confirmed("a1@example.com", "a2@example.com", "a3@example.com", "a4@example.com", "a5@example.com");
    const env = { ...ON, NEWSLETTER_DAILY_CAP: "4" };
    expect(await runNewsletter(t.db, SUN_AIR, { env, pauseMs: 0 })).toMatchObject({ issue: "2026-W46", sent: 3, left: 2 });
    // The fourth is a confirmation's.
    await addSignUp(t.db, "new@example.com", SUN_AIR);
    expect(await sendConfirmation(t.db, "new@example.com", SUN_AIR, env)).toBe("sent");
    expect(await newsletterBudget(t.db, env)).toEqual({ confirms: 0, letters: 0 });
    // A day on, the letter goes on where it stopped, and nobody gets it twice.
    await t.db.query(`update email_sends set created_at = now() - interval '25 hours'`);
    expect(await runNewsletter(t.db, new Date(SUN_AIR.getTime() + DAY), { env, pauseMs: 0 })).toMatchObject({ issue: "2026-W46", sent: 2, left: 0 });
    expect(letters().map((m) => m.to).sort()).toEqual(["a1@example.com", "a2@example.com", "a3@example.com", "a4@example.com", "a5@example.com"]);

    // The show's own emails count: with 9 of its 10 a day gone, the letter may send one.
    await t.db.query("delete from email_sends");
    for (let i = 0; i < 9; i++) await t.db.query(`insert into email_sends (id, user_id, kind) values ($1, 'u1', 'digest')`, [`d${i}`]);
    expect(await newsletterBudget(t.db, { ...ON, EMAIL_DAILY_CAP: "10" })).toEqual({ confirms: 1, letters: 1 });
  });

  it("goes to each address once even when two passes run at once, and a refused send waits for the next pass", async () => {
    await week();
    await confirmed("b1@example.com", "b2@example.com", "b3@example.com");
    await Promise.all([runNewsletter(t.db, SUN_AIR, { env: ON, pauseMs: 0 }), runNewsletter(t.db, SUN_AIR, { env: ON, pauseMs: 0 })]);
    expect(letters().map((m) => m.to).sort()).toEqual(["b1@example.com", "b2@example.com", "b3@example.com"]);
    expect(await t.count("newsletter_issues")).toBe(1);

    // Another week's letter, with the provider refusing the first send.
    await t.db.query("delete from newsletter_issues");
    await t.db.query("delete from newsletter_sends");
    sent = [];
    let refuse = true;
    setEmailSenderForTests(async (msg) => {
      if (refuse) {
        refuse = false;
        throw new Error("resend: rate_limit_exceeded");
      }
      sent.push(msg);
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runNewsletter(t.db, SUN_AIR, { env: ON, pauseMs: 0 })).toMatchObject({ sent: 0, failed: 1, left: 3 });
    expect(quiet).toHaveBeenCalledWith("[newsletter] letter failed:", "resend: rate_limit_exceeded");
    expect(await runNewsletter(t.db, new Date(SUN_AIR.getTime() + HOUR), { env: ON, pauseMs: 0 })).toMatchObject({ sent: 3, failed: 0, left: 0 });
    expect(letters().map((m) => m.to).sort()).toEqual(["b1@example.com", "b2@example.com", "b3@example.com"]);
    expect(await t.count("newsletter_sends", "tries = 2")).toBe(1);
  });

  it("sends no letter without a postal address, while sign-ups and confirmations go on", async () => {
    const env = { ...ON, NEWSLETTER_POSTAL_ADDRESS: "CHANGE_ME" };
    await week();
    await confirmed("one@example.com");
    await addSignUp(t.db, "waiting@example.com", SUN_AIR);
    expect(await runNewsletter(t.db, SUN_AIR, { env, pauseMs: 0 })).toBe("waiting for NEWSLETTER_POSTAL_ADDRESS");
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["waiting@example.com", "Confirm the Sunday letter from Botchelor"]]);
    expect(sent[0].text).not.toContain("Botchelor · ");
    expect(await t.count("newsletter_issues")).toBe(0);
    expect(letterEmail({ subject: "s", html: "h", text: "t" }, "one@example.com", { apiKey: KEY, from: "Botchelor <x@botchelor.com>" }, env)).toBeNull();
    // The confirmation page doesn't promise this Sunday's letter while it waits.
    const done = async () => renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve({ done: "1" }) }));
    expect(await done()).toContain("The next letter comes on Sunday evening");
    vi.stubEnv("NEWSLETTER_POSTAL_ADDRESS", "CHANGE_ME");
    expect(await done()).toContain("The letter starts soon");
  });
});

describe("watching it", () => {
  it("the admin sees counts, never an address", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", ADMIN_PW);
    expect((await adminRoute(new Request(`${BASE_URL}/api/admin/newsletter`))).status).toBe(403);
    await confirmed("one@example.com");
    await addSignUp(t.db, "pending@example.com", new Date());
    const res = await adminRoute(new Request(`${BASE_URL}/api/admin/newsletter?preview=1`, { headers: { "x-frontier-key": ADMIN_PW } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ state: "on", daily_cap: 40, subscribers: { pending: 1, confirmed: 1, unsubscribed: 0 }, budget: { confirms: 40, letters: 30 } });
    expect(body).toHaveProperty("preview");
    expect(JSON.stringify(body)).not.toMatch(/example\.com/);
  });

  it("runs from the hourly lobby job after the reveal and the Discord posts, best-effort, and says what it did", () => {
    const route = readFileSync(new URL("../app/api/jobs/lobby/route.ts", import.meta.url), "utf8");
    const call = route.indexOf("runNewsletter(db).catch(");
    expect(call).toBeGreaterThan(-1);
    for (const before of ["airDueDates(db)", "runDueReveal(db)", "postDueDiscord(db)"]) expect(route.indexOf(before)).toBeLessThan(call);
    expect(route).toMatch(/discord, newsletter,/);
  });
});
