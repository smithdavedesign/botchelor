// People's feedback (lib/user-feedback.ts, /api/feedback, app/FeedbackModal.tsx, the People tab on /admin/feedback):
// what a person can send and what's stored with it, the honeypot and the rate limits, the content flag and our own
// traffic, the viewer's context and the one-time beta prompt, the owner's list, filters, triage and CSV, and privacy.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The dock reads the page it's on from next/navigation: hand it this one.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => nav.pathname,
}));

import FeedbackDock, { FeedbackLink, FLOATING_FEEDBACK_BUTTON } from "@/app/FeedbackDock";
import FeedbackModal from "@/app/FeedbackModal";
import { GET as adminAgentFeedback } from "@/app/api/admin/feedback/route";
import { GET as adminPeople, PATCH as adminPeoplePatch } from "@/app/api/admin/feedback/people/route";
import { POST as postPromptSeen } from "@/app/api/feedback/prompt/route";
import { GET as getViewer, POST as postFeedback } from "@/app/api/feedback/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { feedbackBoard } from "@/lib/feedback";
import { csvCell, feedbackCsv, USER_FEEDBACK_LIMITS, type UserFeedbackRow } from "@/lib/user-feedback";
import { betaPromptDue, cleanPage, cleanViewport, npsGroup, npsScore, promptPathBlocked, type BetaPromptState } from "@/lib/user-feedback-shared";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PW = ["people", "feedback", "pass"].join("-");
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from admins");
  await t.db.query("delete from accounts");
  await t.db.query("delete from email_prefs");
  vi.spyOn(console, "log").mockImplementation(() => {});
  nav.pathname = "/";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** POST /api/feedback as a browser would send it. */
const send = (body: unknown, opts: { cookie?: string; ip?: string; ua?: string; contentType?: string } = {}) =>
  postFeedback(
    new Request(`${BASE_URL}/api/feedback`, {
      method: "POST",
      headers: {
        "content-type": opts.contentType ?? "application/json",
        "user-agent": opts.ua ?? BROWSER,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const viewer = (cookie?: string, ua = BROWSER) => getViewer(new Request(`${BASE_URL}/api/feedback`, { headers: { "user-agent": ua, ...(cookie ? { cookie } : {}) } }));
const rows = async () => (await t.db.query<Any>("select * from user_feedback")).rows;
/** The stored note with these words (PGlite can stamp two quick inserts with the same time, so never rely on order). */
const byMessage = async (message: string | null) => (await rows()).find((r) => r.message === message);

/** The owner's API, with the admin password unless told otherwise. */
const people = (qs = "", headers: Record<string, string> = { "x-frontier-key": PW }) => adminPeople(new Request(`${BASE_URL}/api/admin/feedback/people${qs ? `?${qs}` : ""}`, { headers }));
const triage = (body: unknown, headers: Record<string, string> = { "x-frontier-key": PW }) =>
  adminPeoplePatch(new Request(`${BASE_URL}/api/admin/feedback/people`, { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A stored note, written straight into the table (for the owner's view: dates, statuses and our own traffic). */
async function note(o: Partial<Record<keyof UserFeedbackRow, unknown>> & { created_at: string }): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `insert into user_feedback (id, created_at, user_id, account, rating, category, message, email, page, viewport, version, user_agent, flagged, flag_reason, ours, status, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id,
      o.created_at,
      o.user_id ?? randomUUID(),
      o.account ?? false,
      o.rating ?? null,
      o.category ?? "other",
      o.message ?? null,
      o.email ?? null,
      o.page ?? "/",
      o.viewport ?? "390x844",
      o.version ?? null,
      o.user_agent ?? BROWSER,
      o.flagged ?? false,
      o.flag_reason ?? null,
      o.ours ?? false,
      o.status ?? "new",
      o.note ?? null,
    ],
  );
  return id;
}

/** A date booked by `owner` (their character × a fresh one), with the given state. */
async function dateBy(owner: string, o: { status?: string; visibility?: string; aired?: boolean } = {}): Promise<string> {
  const [a, b, id] = [randomUUID(), randomUUID(), randomUUID()];
  for (const c of [a, b]) {
    await t.db.query(
      `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ($1, $2, 'Cass Vega', 33, 'A florist.', '["bold","gentle","precise"]'::jsonb, 'Quiet.', 'Fireworks.')`,
      [c, c === a ? owner : randomUUID()],
    );
  }
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, visibility, revealed_at)
     values ($1, $2, $3, $4, 'A lighthouse bar.', '[]'::jsonb, '[]'::jsonb, 'Twist.', 'Finale.', 'friends', $5, $6, $7)`,
    [id, owner, a, b, o.status ?? "ready", o.visibility ?? "public", o.aired ? new Date().toISOString() : null],
  );
  return id;
}

describe("sending a note (POST /api/feedback)", () => {
  it("stores every field: the words, the page, the screen, the session, the browser and the commit, and echoes none of it", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    const cookie = newUserCookie();
    const res = await send(
      { rating: 9, category: "idea", message: "  Loved the swipes. A picnic venue, please!  ", email: " Mira@Example.COM ", page: "/characters/abc?token=secret#top", viewport: "390x844" },
      { cookie },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true, id: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/picnic|mira/i);
    const [row] = await rows();
    expect(row).toMatchObject({
      id: body.id,
      user_id: userIdOf(cookie),
      account: false,
      rating: 9,
      category: "idea",
      message: "Loved the swipes. A picnic venue, please!",
      email: "mira@example.com",
      page: "/characters/abc",
      viewport: "390x844",
      version: "0123456789ab",
      user_agent: BROWSER,
      flagged: false,
      flag_reason: null,
      ours: false,
      status: "new",
      note: null,
    });
    expect(row.created_at).toBeTruthy();
  });

  it("marks a note sent while signed in as an account's, and gives a first-time visitor a session with theirs", async () => {
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    const member = randomUUID();
    await t.db.query(`insert into accounts (user_id, handle, handle_display, password_hash) values ($1, 'wren', 'Wren', 'x')`, [member]);
    expect((await send({ message: "Signed in and sending." }, { cookie: signedInCookie(member) })).status).toBe(201);

    const first = await send({ rating: 7 });
    expect(first.status).toBe(201);
    expect(first.headers.get("set-cookie")).toMatch(/bz_sess=/);
    expect(await byMessage("Signed in and sending.")).toMatchObject({ user_id: member, account: true });
    const theirs = await byMessage(null);
    expect(theirs).toMatchObject({ account: false, rating: 7, category: "other" });
    expect(theirs.user_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("validates: a whole rating from 0 to 10, a known category, at most 2000 characters, a real email or none, JSON only", async () => {
    const cookie = newUserCookie();
    for (const bad of [{ rating: 11 }, { rating: -1 }, { rating: 6.5 }, { rating: "9" }, { message: "Hi", category: "spam" }, { message: "x".repeat(2001) }, { message: "Hi", email: "not-an-email" }]) {
      const res = await send(bad, { cookie });
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect((await res.json()).error).toBe("invalid_feedback");
    }
    expect((await send("rating=9", { cookie, contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    // A zero is a real answer, and a blank email means no reply wanted.
    expect((await send({ rating: 0, email: "   " }, { cookie })).status).toBe(201);
    expect((await send({ message: "x".repeat(2000), email: "" }, { cookie })).status).toBe(201);
    expect(await byMessage(null)).toMatchObject({ rating: 0, email: null });
    expect(await byMessage("x".repeat(2000))).toMatchObject({ rating: null, email: null });
    expect(await t.count("user_feedback")).toBe(2);
  });

  it("refuses an empty note: no words and no rating", async () => {
    const cookie = newUserCookie();
    for (const empty of [{}, { message: "    " }, { category: "bug" }, { rating: null, message: "" }]) {
      const res = await send(empty, { cookie });
      expect(res.status, JSON.stringify(empty)).toBe(422);
      expect(await res.json()).toMatchObject({ error: "empty_feedback", message: expect.stringMatching(/pick a number/) });
    }
    expect(await t.count("user_feedback")).toBe(0);
  });

  it("thanks a filled honeypot like a person, and stores nothing", async () => {
    const res = await send({ rating: 10, message: "Great site, visit my shop", website: "https://spam.example" }, { cookie: newUserCookie() });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(await t.count("user_feedback")).toBe(0);
  });

  it(`rate limits per session and per connection: ${USER_FEEDBACK_LIMITS.perHour} an hour`, async () => {
    const cookie = newUserCookie();
    for (let i = 0; i < USER_FEEDBACK_LIMITS.perHour; i++) expect((await send({ message: `Note ${i}` }, { cookie })).status).toBe(201);
    const over = await send({ message: "One more" }, { cookie });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "too_many_notes" });

    // Fresh cookies from one address don't get round it; another address is fine.
    const ip = "203.0.113.21";
    for (let i = 0; i < USER_FEEDBACK_LIMITS.perHour; i++) expect((await send({ message: `From the café ${i}` }, { cookie: newUserCookie(), ip })).status).toBe(201);
    expect((await send({ message: "Yet another cookie" }, { cookie: newUserCookie(), ip })).status).toBe(429);
    expect((await send({ message: "Someone else" }, { cookie: newUserCookie(), ip: "198.51.100.8" })).status).toBe(201);
    expect(await t.count("user_feedback")).toBe(USER_FEEDBACK_LIMITS.perHour * 2 + 1);
  });

  it("keeps words that fail the content filter, flagged with the reason, and never sends them back", async () => {
    const cookie = newUserCookie();
    const rude = await send({ message: "Make the dates more sexy, honestly." }, { cookie });
    expect(rude.status).toBe(201);
    expect(JSON.stringify(await rude.json())).not.toMatch(/sexy/);
    await send({ rating: 3, message: "I wanted to date Taylor Swift." }, { cookie });
    await send({ rating: 8, message: "The rooftop venue is lovely." }, { cookie });
    expect(await byMessage("Make the dates more sexy, honestly.")).toMatchObject({ flagged: true, flag_reason: "sexual" });
    expect(await byMessage("I wanted to date Taylor Swift.")).toMatchObject({ flagged: true, flag_reason: "real_person" });
    expect(await byMessage("The rooftop venue is lovely.")).toMatchObject({ flagged: false, flag_reason: null });
  });

  it("marks our own checks as ours from the user agent (lib/our-traffic.ts)", async () => {
    await send({ message: "Live check, please ignore." }, { cookie: newUserCookie(), ua: "botchelor-live-check/1.0 (Claude)" });
    await send({ message: "A real person on a phone." }, { cookie: newUserCookie() });
    expect((await byMessage("Live check, please ignore."))?.ours).toBe(true);
    expect((await byMessage("A real person on a phone."))?.ours).toBe(false);
  });

  it("never touches what agents send: agent_feedback, the agents' board and the agents' admin list stay empty", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    await send({ rating: 9, message: "From a person, not an agent." }, { cookie: newUserCookie() });
    expect(await t.count("user_feedback")).toBe(1);
    expect((await t.db.query<{ n: number }>("select count(*)::int as n from agent_feedback")).rows[0].n).toBe(0);
    expect(await feedbackBoard(t.db, null)).toEqual([]);
    const agents = await (await adminAgentFeedback(new Request(`${BASE_URL}/api/admin/feedback`, { headers: { "x-frontier-key": PW } }))).json();
    expect(agents.summary.count).toBe(0);
  });
});

describe("the viewer's context (GET /api/feedback)", () => {
  it("offers a reply address to a signed-in session only: the account's, else a confirmed notification address", async () => {
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    const google = randomUUID();
    await t.db.query(`insert into accounts (user_id, email, google_sub) values ($1, 'mira@example.com', 'sub-1')`, [google]);
    expect((await (await viewer(signedInCookie(google))).json()).email).toBe("mira@example.com");
    // The same id as a bare cookie names the account but isn't signed in to it.
    expect((await (await viewer(`bz_uid=${google}`)).json()).email).toBeNull();

    const password = randomUUID();
    await t.db.query(`insert into accounts (user_id, handle, handle_display, password_hash) values ($1, 'otto', 'Otto', 'x')`, [password]);
    await t.db.query(`insert into email_prefs (user_id, email, status) values ($1, 'otto@example.com', 'pending')`, [password]);
    expect((await (await viewer(signedInCookie(password))).json()).email).toBeNull();
    await t.db.query(`update email_prefs set status = 'on' where user_id = $1`, [password]);
    expect((await (await viewer(signedInCookie(password))).json()).email).toBe("otto@example.com");

    expect(await (await viewer()).json()).toEqual({ email: null, prompt: { used_it: false, seen_on_account: false, agent: false } });
  });

  it("knows when a person has used the show: a date of theirs aired, or finished as a private one", async () => {
    const cookie = newUserCookie();
    const me = userIdOf(cookie);
    const facts = async () => (await (await viewer(cookie)).json()).prompt;
    expect(await facts()).toEqual({ used_it: false, seen_on_account: false, agent: false });
    await dateBy(me, { status: "generating", visibility: "private" });
    await dateBy(me, { status: "ready", visibility: "public", aired: false });
    // Someone else's aired date with this person's... nothing: it has to be theirs.
    await dateBy(randomUUID(), { aired: true });
    expect((await facts()).used_it).toBe(false);
    const aired = await dateBy(me, { aired: true });
    expect((await facts()).used_it).toBe(true);
    await t.db.query("delete from episodes where id = $1", [aired]);
    await dateBy(me, { status: "ready", visibility: "private" });
    expect((await facts()).used_it).toBe(true);
  });

  it("calls crawlers and MCP identities agents, and remembers on the account that the prompt was shown", async () => {
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    const agentCookie = newUserCookie();
    await dateBy(userIdOf(agentCookie), { aired: true });
    await t.db.query(`insert into mcp_sessions (id, agent_id) values ($1, $2)`, [randomUUID(), userIdOf(agentCookie)]);
    expect((await (await viewer(agentCookie)).json()).prompt).toMatchObject({ used_it: true, agent: true });
    const crawler = newUserCookie();
    expect((await (await viewer(crawler, "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).json()).prompt.agent).toBe(true);

    const member = randomUUID();
    await t.db.query(`insert into accounts (user_id, handle, handle_display, password_hash) values ($1, 'cass', 'Cass', 'x')`, [member]);
    await dateBy(member, { aired: true });
    const signedIn = signedInCookie(member);
    const before = (await (await viewer(signedIn)).json()).prompt;
    expect(before).toEqual({ used_it: true, seen_on_account: false, agent: false });
    expect(betaPromptDue({ usedIt: before.used_it, seenOnAccount: before.seen_on_account, agent: before.agent, seenHere: false, blocked: false })).toBe(true);

    const seen = (cookie: string, contentType = "application/json") =>
      postPromptSeen(new Request(`${BASE_URL}/api/feedback/prompt`, { method: "POST", headers: { "content-type": contentType, cookie }, body: "{}" }));
    expect((await seen(signedIn, "text/plain")).status).toBe(415);
    expect((await seen(signedIn)).status).toBe(200);
    const after = (await (await viewer(signedIn)).json()).prompt;
    expect(after.seen_on_account).toBe(true);
    expect(betaPromptDue({ usedIt: after.used_it, seenOnAccount: after.seen_on_account, agent: after.agent, seenHere: false, blocked: false })).toBe(false);
    const first = (await t.db.query<{ at: Date }>("select beta_prompt_at as at from accounts where user_id = $1", [member])).rows[0].at;
    await seen(signedIn);
    expect((await t.db.query<{ at: Date }>("select beta_prompt_at as at from accounts where user_id = $1", [member])).rows[0].at).toEqual(first);
    // An anonymous visitor's browser remembers it alone: nothing to store, nothing breaks.
    expect((await seen(newUserCookie())).status).toBe(200);
  });
});

describe("the beta prompt's show-once rule (pure)", () => {
  it("is due only for a person who has used the show, hasn't been asked here or on their account, and isn't somewhere it would cover", () => {
    const keys: (keyof BetaPromptState)[] = ["usedIt", "seenHere", "seenOnAccount", "agent", "blocked"];
    let due = 0;
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const state = Object.fromEntries(keys.map((k, i) => [k, Boolean(mask & (1 << i))])) as BetaPromptState;
      const expected = state.usedIt && !state.seenHere && !state.seenOnAccount && !state.agent && !state.blocked;
      expect(betaPromptDue(state), JSON.stringify(state)).toBe(expected);
      if (expected) due++;
    }
    expect(due).toBe(1);
  });

  it("never interrupts the gate, an unsubscribe link, the admin pages or After Dark", () => {
    for (const p of ["/gate", "/admin", "/admin/feedback", "/after-dark", "/after-dark/a/b", "/email/unsubscribe"]) expect(promptPathBlocked(p), p).toBe(true);
    for (const p of ["/", "/characters", "/matches", "/episodes/abc", "/administrator", "/emails"]) expect(promptPathBlocked(p), p).toBe(false);
  });

  it("scores NPS from the 0-10 answers: promoters 9-10, detractors 0-6", () => {
    expect(npsScore({ promoters: 2, detractors: 1, rated: 4 })).toBe(25);
    expect(npsScore({ promoters: 3, detractors: 0, rated: 3 })).toBe(100);
    expect(npsScore({ promoters: 0, detractors: 5, rated: 5 })).toBe(-100);
    expect(npsScore({ promoters: 0, detractors: 0, rated: 0 })).toBeNull();
    expect([0, 6, 7, 8, 9, 10].map(npsGroup)).toEqual(["detractor", "detractor", "passive", "passive", "promoter", "promoter"]);
  });

  it("keeps only a path from the page, and only a WxH from the viewport", () => {
    expect(cleanPage("/watch/abc?x=1#y")).toBe("/watch/abc");
    expect(cleanPage("https://evil.example/")).toBeNull();
    expect(cleanPage("//evil.example/")).toBeNull();
    expect(cleanPage(42)).toBeNull();
    expect(cleanViewport("1440x900")).toBe("1440x900");
    expect(cleanViewport("big")).toBeNull();
  });
});

describe("the owner's People tab (/api/admin/feedback/people)", () => {
  /** Two weeks of notes: three today, two three days ago, one 40 days ago, and one of our own checks today. */
  async function seed() {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const today = `${day(0)}T00:00:00Z`;
    const ids = {
      ten: await note({ created_at: today, rating: 10, category: "idea", message: "More venues!" }),
      nine: await note({ created_at: today, rating: 9, category: "love", message: "Hooked on the swipes." }),
      six: await note({ created_at: today, rating: 6, category: "bug", message: "The phone froze.", status: "seen" }),
      seven: await note({ created_at: `${day(-3)}T12:00:00Z`, rating: 7, category: "bug", message: "Send button hid behind the keyboard." }),
      words: await note({ created_at: `${day(-3)}T13:00:00Z`, category: "confusing", message: "What is a token?" }),
      old: await note({ created_at: `${day(-40)}T12:00:00Z`, rating: 2, category: "other", message: "Too slow." }),
      ours: await note({ created_at: today, rating: 0, category: "bug", message: "Live check.", ours: true }),
    };
    return ids;
  }

  it("needs the admin password or a signed-in admin account: 403 for anyone else", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    expect((await people("", {})).status).toBe(403);
    expect((await people("", { "x-frontier-key": "wrong-guess" })).status).toBe(403);
    expect((await people("count=1", { cookie: newUserCookie() })).status).toBe(403);
    expect((await triage({ id: "x", status: "seen" }, {})).status).toBe(403);
    const member = randomUUID();
    expect((await people("", { cookie: signedInCookie(member) })).status).toBe(403);
    await claimAdmin(t.db, member);
    expect((await people("", { cookie: signedInCookie(member) })).status).toBe(200);
    // A bare cookie naming the admin's id isn't the admin signed in.
    expect((await people("", { cookie: `bz_uid=${member}` })).status).toBe(403);
    expect((await people()).status).toBe(200);
  });

  it("sums up the period (count, average, NPS and its groups, by category) with a per-day trend and the notes newest first", async () => {
    const ids = await seed();
    const week = await (await people("days=7")).json();
    expect(week.summary).toEqual({
      count: 5,
      rated: 4,
      average: 8,
      nps: 25,
      promoters: 2,
      passives: 1,
      detractors: 1,
      new: 4,
      flagged: 0,
      accounts: 0,
      by_category: { bug: 2, idea: 1, love: 1, confusing: 1, other: 0 },
    });
    expect(week.trend).toHaveLength(7);
    expect(week.trend[6]).toEqual({ day: day(0), count: 3, average: 8.3 });
    expect(week.trend[3]).toEqual({ day: day(-3), count: 2, average: 7 });
    expect(week.trend.filter((d: Any) => d.count === 0)).toHaveLength(5);
    expect(week.items.map((r: Any) => r.id).slice(-2)).toEqual([ids.words, ids.seven]);
    expect(week.items[0]).toMatchObject({ category: expect.any(String), page: "/", viewport: "390x844", account: false, user_agent: BROWSER });
    expect(week.new_count).toBe(5); // all time, our own check and the seen one left out

    const all = await (await people("days=all")).json();
    expect(all.summary.count).toBe(6);
    expect(all.trend).toHaveLength(41);
    expect((await (await people("days=all&ours=1")).json()).summary.count).toBe(7);
    // No period at all means the last 30 days.
    expect((await (await people()).json()).summary.count).toBe(5);
  });

  it("filters by category, rating range, status, dates and our own traffic", async () => {
    const ids = await seed();
    const idsFor = async (qs: string) => ((await (await people(qs)).json()).items as Any[]).map((r) => r.id).sort();
    expect(await idsFor("days=all&category=bug")).toEqual([ids.six, ids.seven].sort());
    expect(await idsFor("days=all&category=bug&ours=1")).toEqual([ids.six, ids.seven, ids.ours].sort());
    expect(await idsFor("days=all&min=9")).toEqual([ids.ten, ids.nine].sort());
    expect(await idsFor("days=all&min=0&max=6")).toEqual([ids.six, ids.old].sort());
    // A range typed backwards means the same range.
    expect(await idsFor("days=7&min=9&max=6")).toEqual([ids.nine, ids.six, ids.seven].sort());
    expect(await idsFor("days=all&status=seen")).toEqual([ids.six]);
    expect(await idsFor(`from=${day(-3)}&to=${day(-3)}`)).toEqual([ids.seven, ids.words].sort());
    expect(await idsFor(`from=${day(-50)}&to=${day(-30)}`)).toEqual([ids.old]);
    // Empty boxes in the form mean "any".
    expect(await idsFor("days=7&category=&status=&min=")).toHaveLength(5);
    for (const bad of ["category=spam", "status=archived", "min=11", "from=2026-13-40", "days=0"]) expect((await people(bad)).status, bad).toBe(422);
  });

  it("moves a note new → seen → done, keeps the owner's note, marks many at once, and says how many are new", async () => {
    const ids = await seed();
    expect((await (await people("count=1")).json()).new_count).toBe(5);
    expect(await (await triage({ id: ids.ten, status: "seen" })).json()).toEqual({ id: ids.ten, status: "seen", note: null });
    expect(await (await triage({ id: ids.ten, note: "  Venues are in #620.  " })).json()).toEqual({ id: ids.ten, status: "seen", note: "Venues are in #620." });
    expect(await (await triage({ id: ids.ten, status: "done" })).json()).toEqual({ id: ids.ten, status: "done", note: "Venues are in #620." });
    expect((await (await triage({ id: ids.ten, note: "" })).json()).note).toBeNull();
    await triage({ id: ids.ten, note: "Back again." });
    expect((await (await triage({ id: ids.ten, note: null })).json()).note).toBeNull();
    expect((await (await people("count=1")).json()).new_count).toBe(4);

    expect(await (await triage({ ids: [ids.nine, ids.seven, ids.six], status: "seen" })).json()).toEqual({ updated: 2 });
    expect((await (await people("count=1")).json()).new_count).toBe(2);

    expect((await triage({ id: "no-such-note", status: "seen" })).status).toBe(404);
    for (const bad of [{ id: ids.nine }, { id: ids.nine, status: "archived" }, { ids: [], status: "seen" }, { id: ids.nine, note: "x".repeat(2001) }]) {
      expect((await triage(bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it("exports the filtered notes as a CSV that a spreadsheet can't run", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    await note({ created_at: `${day(0)}T00:00:00Z`, rating: 4, category: "bug", message: '=HYPERLINK("https://evil.example","click")', email: "a@example.com" });
    await note({ created_at: `${day(0)}T00:00:01Z`, rating: 8, category: "love", message: 'Two lines,\nand "quotes".' });
    await note({ created_at: `${day(0)}T00:00:02Z`, rating: 1, category: "bug", message: "Live check.", ours: true });
    const res = await people("days=7&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="botchelor-feedback-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe("created_at,category,rating,message,email,page,viewport,version,account,user_id,flagged,flag_reason,ours,status,note,user_agent");
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""click"")"`);
    expect(csv).toContain('"Two lines,\nand ""quotes""."');
    expect(csv).not.toContain("Live check.");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  });

  it("writes each CSV cell the RFC 4180 way, with formulas defused", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(7)).toBe("7");
    expect(csvCell("plain words")).toBe("plain words");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@here")).toBe("'@here");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(feedbackCsv([]).trimEnd().split("\r\n")).toHaveLength(1);
  });
});

describe("privacy: a person's notes", () => {
  it("are in their account export and go when they delete their account", async () => {
    const cookie = newUserCookie();
    const me = userIdOf(cookie);
    await send({ rating: 8, category: "idea", message: "Let me pick the venue.", email: "me@example.com", page: "/create" }, { cookie });
    await send({ message: "Someone else's note." }, { cookie: newUserCookie() });
    const exported = await exportAccount(t.db, me);
    expect(exported.feedback).toHaveLength(1);
    expect(exported.feedback[0]).toMatchObject({ rating: 8, category: "idea", message: "Let me pick the venue.", email: "me@example.com", page: "/create" });
    expect(exported.feedback[0]).not.toHaveProperty("note");
    await deleteAccount(t.db, me);
    expect(await t.count("user_feedback", `user_id = '${me}'`)).toBe(0);
    expect(await t.count("user_feedback")).toBe(1);
  });
});

describe("the modal, the button and the footer link (markup)", () => {
  it("labels every field, says what's stored, and hides the honeypot from people and screen readers", () => {
    const html = renderToStaticMarkup(createElement(FeedbackModal, { open: false, onClose: () => {}, page: "/" }));
    expect(html).toMatch(/<dialog[^>]*class="feedback-dialog"[^>]*aria-labelledby="([^"]+)-title"/);
    expect(html).toContain("How likely are you to recommend Botchelor to a friend?");
    expect(html.match(/type="radio" name="[^"]+-rating"/g)).toHaveLength(11);
    for (const label of ["Bug", "Idea", "Love it", "Confusing", "Other"]) expect(html).toContain(`/>${label}</label>`);
    // The message and the email each have a label pointing at them.
    const messageId = /<textarea id="([^"]+)"/.exec(html)?.[1];
    const emailId = /<input id="([^"]+)" type="email"/.exec(html)?.[1];
    expect(html).toContain(`for="${messageId}"`);
    expect(html).toContain(`for="${emailId}"`);
    expect(html).toMatch(/<textarea[^>]*maxLength="2000"[^>]*aria-describedby="[^"]+-count"/);
    expect(html).toContain("0 / 2000 characters");
    expect(html).toMatch(/type="email" autoComplete="email"/);
    const honeypot = /<div class="feedback-hp" aria-hidden="true">(.*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(honeypot).toMatch(/<input [^>]*name="website"/);
    expect(honeypot).toMatch(/<input [^>]*tabindex="-1"/);
    expect(html).toMatch(/We keep what you send, the page you&#x27;re on, your screen size, the app version and your browser/);
    expect(html).toContain('href="/privacy"');
  });

  it(`shows the floating button (${FLOATING_FEEDBACK_BUTTON ? "on" : "off"} for now) and the modal on a page, and nothing on the 18+ gate`, () => {
    expect(typeof FLOATING_FEEDBACK_BUTTON).toBe("boolean");
    const page = renderToStaticMarkup(createElement(FeedbackDock));
    expect(page).toContain('class="feedback-dialog"');
    if (FLOATING_FEEDBACK_BUTTON) expect(page).toMatch(/<button[^>]*class="feedback-fab"[^>]*aria-haspopup="dialog"[^>]*>.*Feedback<\/button>/);
    nav.pathname = "/gate";
    expect(renderToStaticMarkup(createElement(FeedbackDock))).toBe("");
  });

  it("puts \"Give us feedback\" in the footer under Help and legal, beside Report a problem, and mounts the dock once in the layout", () => {
    expect(renderToStaticMarkup(createElement(FeedbackLink))).toBe('<button type="button" class="link-button footer-link" aria-haspopup="dialog">Give us feedback</button>');
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    // The footer's links are three groups (2026-10-31 UX audit); feedback is with the other ways to reach us.
    expect(layout).toMatch(/<FooterGroup title="Help and legal">\s*<li><Link href="\/report">Report a problem<\/Link><\/li>\s*<li>\s*<FeedbackLink \/>\s*<\/li>/);
    expect(layout.match(/<FeedbackDock \/>/g)).toHaveLength(1);
  });

  it("hides the button and the prompt (and the install hint, app/InstallHint.tsx), in one CSS rule, wherever they'd cover the show's own controls", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const rule = /:is\(\s*html\.theater-lock,[\s\S]*?\)\s*:is\(\.feedback-fab, \.beta-toast, \.install-hint\) \{\s*display: none;\s*\}/.exec(css)?.[0] ?? "";
    for (const where of [
      "html.theater-lock",
      "html.feedback-open",
      ".age-gate",
      ".theater",
      ".swipe-fullscreen",
      ".swipe-match-overlay",
      ".messages-fullscreen",
      ".phone-stage.is-full",
      ".after-dark-form",
      ".ad-reel-theater",
      ".consent-banner",
      ".constellation-panel",
      '.nav-links[data-open="true"]',
      ".nav-backdrop",
    ]) {
      expect(rule, where).toContain(where);
    }
  });
});
