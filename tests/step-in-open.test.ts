import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the viewer from next/headers: hand them this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
const nav = vi.hoisted(() => ({ notFound: 0 }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  notFound: () => {
    nav.notFound++;
    throw new Error("NEXT_NOT_FOUND");
  },
}));
import { renderToStaticMarkup } from "react-dom/server";
import { GET as cardRoute } from "@/app/api/og/step-in/route";
import { POST as startRoute } from "@/app/api/step-in/route";
import { GET as viewRoute, POST as actRoute } from "@/app/api/step-in/[id]/route";
import StepInDatePage from "@/app/step-in/[id]/page";
import StepInPage, { generateMetadata } from "@/app/step-in/page";
import { adultCookie } from "@/lib/age";
import { signSession } from "@/lib/auth";
import { listTab, searchDirectory, tabCounts } from "@/lib/directory";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { visitorKey } from "@/lib/limits";
import { listCast } from "@/lib/mechanics";
import { setModelForTests } from "@/lib/model";
import { nameCheck } from "@/lib/name-check";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { PUBLIC_PATHS } from "@/lib/site";
import {
  guestStepIns,
  guestStepInsLeft,
  STEP_IN_DATE_TRIES,
  STEP_IN_GUEST_ABOUT_CHECKS,
  STEP_IN_GUEST_DAILY_MAX,
  STEP_IN_GUEST_DATES,
  STEP_IN_IP_LINE_LIMITS,
  STEP_IN_IP_START_LIMITS,
  stepInGuestDailyMax,
  stepInGuestsOpen,
  stepInOpen,
} from "@/lib/step-in";
import { stepInAccess } from "@/lib/step-in-access";
import { readStepInShare, stepInShareImage, stepInSharePath } from "@/lib/step-in-share";
import { STEP_IN_SHARE_WORDS, stepInShareText } from "@/lib/step-in-shared";
import { api, BASE_URL, episodeJson, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// Step into the date, open to everyone (2026-11-15; lib/step-in.ts "what stops a flood", docs/step-into-the-date.md):
// the default, the guest path, each cap, and the switches that close it again.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const FIRST = CAST.name.split(" ")[0];
/** How many of the cast's lines and crisis checks the model was asked for. */
let turns = 0;
let checks = 0;
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  nav.notFound = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setSeasonCastForTests([CAST.id, HOUSE_CHARACTERS[1].id]);
  scriptOutcome({ ending: "friends" });
  turns = 0;
  checks = 0;
  setModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) {
        checks++;
        return `{"risk": false}`;
      }
      if (system.startsWith("You have just finished a date")) return JSON.stringify({ see_again: "maybe", won_over: "partly", reason: "Nice enough.", why: "It never quite caught." });
      if (system.startsWith("You are the showrunner")) return episodeJson();
      if (system.startsWith("You are one fictional adult")) {
        turns++;
        return JSON.stringify({ dialogue: `Line ${turns}: the table wobbles and I respect that, number ${turns * 7}.`, action: "", emotion: "warm", interest_signal: 0.6, feeling: "curious", thought: `thought ${turns}` });
      }
      return "{}";
    },
  });
});
afterEach(() => {
  setSeasonCastForTests(null);
  setModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const ADULT = "bz_adult=1";
/** A visitor without an account, on a signed session (as the site issues them); past the 18+ gate unless `gated: false`. */
function guest(opts: { gated?: boolean } = {}) {
  const id = crypto.randomUUID();
  const sess = `bz_sess=${signSession({ uid: id, authenticated: false })}`;
  return { id, cookie: opts.gated === false ? sess : `${sess}; ${ADULT}` };
}
const member = () => {
  const id = crypto.randomUUID();
  return { id, cookie: `${signedInCookie(id)}; ${ADULT}` };
};
const req = (path: string, body: unknown, cookie?: string, ip?: string, method = "POST") =>
  new Request(BASE_URL + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(ip ? { "x-forwarded-for": ip } : {}) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const persona = { name: "Sam", pronouns: "they/them", age: 31, about: "Bakes too much bread and laughs at their own jokes." };
async function start(cookie: string | undefined, opts: { ip?: string; body?: Record<string, unknown> } = {}) {
  const res = await startRoute(req("/api/step-in", { with: CAST.id, persona, ...opts.body }, cookie, opts.ip));
  return { status: res.status, body: (await res.json()) as Any, cookies: res.headers.getSetCookie() };
}
async function act(cookie: string, id: string, body: Record<string, unknown>, ip?: string) {
  const res = await actRoute(req(`/api/step-in/${id}`, body, cookie, ip), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
/** Says one line (after the cast's opening, if it's theirs), so the date counts as used when it's left. */
async function sayOne(cookie: string, id: string, ip?: string) {
  await act(cookie, id, { action: "advance" }, ip);
  return act(cookie, id, { action: "line", dialogue: "I collect old maps of cities that never existed." }, ip);
}
async function playThrough(cookie: string, id: string) {
  let r = await act(cookie, id, { action: "advance" });
  for (let i = 0; r.body.view?.state === "your_line" && i < 30; i++) {
    r = await act(cookie, id, { action: "line", dialogue: `My line ${i}: I collect old maps of cities that never existed, volume ${i * 3}.` });
  }
  return r;
}
const hits = async (bucket: string) => (await t.db.query<{ n: number }>(`select count(*)::int as n from rate_hits where bucket = $1`, [bucket])).rows[0].n;
const fill = async (bucket: string, key: string, n: number, minutesAgo = 1) => {
  for (let i = 0; i < n; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ($1, $2, now() - ($3 || ' minutes')::interval)`, [bucket, key, String(minutesAgo)]);
};
const keyOf = (ip: string) => visitorKey(new Headers({ "x-forwarded-for": ip }))!;

describe("the switches", () => {
  it("is open by default; STEP_IN_OPEN=0 closes it, STEP_IN_GUESTS=0 or a zero ceiling closes it to guests", () => {
    expect(stepInOpen({})).toBe(true);
    expect(stepInOpen({ STEP_IN_OPEN: "1" })).toBe(true);
    expect(stepInOpen({ STEP_IN_OPEN: "0" })).toBe(false);
    expect(stepInGuestsOpen({})).toBe(true);
    expect(stepInGuestsOpen({ STEP_IN_GUESTS: "0" })).toBe(false);
    expect(stepInGuestsOpen({ STEP_IN_OPEN: "0" })).toBe(false);
    expect(stepInGuestsOpen({ STEP_IN_GUEST_DAILY_MAX: "0" })).toBe(false);
    expect(stepInGuestDailyMax({})).toBe(STEP_IN_GUEST_DAILY_MAX);
    expect(STEP_IN_GUEST_DAILY_MAX).toBe(300);
    expect(stepInGuestDailyMax({ STEP_IN_GUEST_DAILY_MAX: "40" })).toBe(40);
    expect(stepInGuestDailyMax({ STEP_IN_GUEST_DAILY_MAX: "lots" })).toBe(STEP_IN_GUEST_DAILY_MAX);
    // The numbers the brief set.
    expect(STEP_IN_GUEST_DATES).toBe(3);
    expect(STEP_IN_IP_START_LIMITS).toEqual({ perHour: 4, perDay: 10 });
    expect(STEP_IN_IP_LINE_LIMITS.perHour).toBe(30);
  });

  it("says who each identity is: a member, a guest on a signed identity, asked to sign in, or nobody", async () => {
    const m = { userId: crypto.randomUUID(), authenticated: true };
    const g = { userId: crypto.randomUUID(), authenticated: false };
    expect(await stepInAccess(t.db, m, true, {})).toEqual({ kind: "member", userId: m.userId });
    expect(await stepInAccess(t.db, g, true, {})).toEqual({ kind: "guest", userId: g.userId });
    // No identity yet: their first start signs one.
    expect(await stepInAccess(t.db, null, true, {})).toEqual({ kind: "guest", userId: null });
    // A bare, unsigned id (anyone could type it in), or an app that can't sign: not a guest.
    expect(await stepInAccess(t.db, g, false, {})).toEqual({ kind: "sign_in" });
    expect(await stepInAccess(t.db, g, true, { STEP_IN_GUESTS: "0" })).toEqual({ kind: "sign_in" });
    expect(await stepInAccess(t.db, m, true, { STEP_IN_GUESTS: "0" })).toEqual({ kind: "member", userId: m.userId });
    // Closed: admins only, and it reads as not found to everyone else.
    expect(await stepInAccess(t.db, m, true, { STEP_IN_OPEN: "0" })).toBeNull();
    expect(await stepInAccess(t.db, g, true, { STEP_IN_OPEN: "0" })).toBeNull();
    await t.db.query("insert into admins (user_id) values ($1)", [m.userId]);
    expect(await stepInAccess(t.db, m, true, { STEP_IN_OPEN: "0" })).toEqual({ kind: "member", userId: m.userId });
  });

  it("STEP_IN_OPEN=0: not found for members and guests alike, an admin still plays", async () => {
    vi.stubEnv("STEP_IN_OPEN", "0");
    expect((await start(member().cookie)).status).toBe(404);
    expect((await start(guest().cookie)).status).toBe(404);
    expect((await start(ADULT)).status).toBe(404);
    const admin = member();
    await t.db.query("insert into admins (user_id) values ($1)", [admin.id]);
    expect((await start(admin.cookie)).status).toBe(201);
  });

  it("STEP_IN_GUESTS=0: a visitor is asked to sign in (and told where), a member is unaffected", async () => {
    vi.stubEnv("STEP_IN_GUESTS", "0");
    const refused = await start(guest().cookie);
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ error: "sign_in", message: "Sign in to step into a date." });
    expect(refused.body.next[0].href).toBe("/account?next=%2Fstep-in");
    expect((await start(member().cookie)).status).toBe(201);
  });
});

describe("a guest steps in", () => {
  it("on their signed visitor id, free, as themselves: the same private date, the cast on the show's side", async () => {
    const g = guest();
    const { status, body } = await start(g.cookie);
    expect(status).toBe(201);
    const row = (await t.db.query<Any>(`select creator_id, status, visibility, setup from episodes where id = $1`, [body.episode_id])).rows[0];
    expect(row).toMatchObject({ creator_id: g.id, status: "generating", visibility: "private" });
    expect(row.setup.step_in).toMatchObject({ mode: "you", charge: "guest" });
    expect(await guestStepIns(t.db, g.id)).toBe(1);
    expect(await guestStepInsLeft(t.db, g.id)).toBe(STEP_IN_GUEST_DATES - 1);
    expect(await guestStepInsLeft(t.db, null)).toBe(STEP_IN_GUEST_DATES);
    // Nobody else's cookie opens it: another guest, and a bare id typed in by hand.
    const view = async (cookie: string) => (await viewRoute(req(`/api/step-in/${body.episode_id}`, null, cookie, undefined, "GET"), ctx(body.episode_id))).status;
    expect(await view(g.cookie)).toBe(200);
    expect(await view(guest().cookie)).toBe(404);
    expect(await view(`bz_uid=${g.id}; ${ADULT}`)).toBe(401);
  });

  it("a first-time visitor with no identity gets a signed one with the date, and plays on it", async () => {
    const first = await start(ADULT);
    expect(first.status).toBe(201);
    const sess = first.cookies.find((c) => c.startsWith("bz_sess="))?.split(";")[0];
    expect(sess).toBeTruthy();
    const said = await sayOne(`${sess}; ${ADULT}`, first.body.episode_id);
    expect(said.status).toBe(200);
    expect(said.body.view.lines.some((l: Any) => l.side === "a")).toBe(true);
  });

  it("a bare, unsigned id is no guest: sign in", async () => {
    expect((await start(`bz_uid=${crypto.randomUUID()}; ${ADULT}`)).status).toBe(401);
  });

  it("answers the 18+ question on the start screen: the box, not the gate, and the answer is remembered", async () => {
    const g = guest({ gated: false });
    // No cookie and no box: refused, naming the box.
    const refused = await start(g.cookie);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: "age_gate", field: "attest" });
    expect((await start(g.cookie, { body: { attest: false } })).status).toBe(403);
    expect(await guestStepIns(t.db, g.id)).toBe(0);
    // The box ticked: the date starts, and the gate's own cookie is set, so the date's page opens.
    const ok = await start(g.cookie, { body: { attest: true } });
    expect(ok.status).toBe(201);
    expect(ok.cookies).toContain(adultCookie(false));
    // The date itself still wants the cookie (the box was only on the start screen).
    expect((await act(g.cookie, ok.body.episode_id, { action: "advance" })).status).toBe(403);
    expect((await act(`${g.cookie}; ${ADULT}`, ok.body.episode_id, { action: "advance" })).status).toBe(200);
    // Someone the gate already asked isn't sent the cookie again; a member answers the same way.
    expect((await start(guest().cookie)).cookies.some((c) => c.startsWith("bz_adult="))).toBe(false);
    const m = member();
    expect((await start(signedInCookie(m.id))).status).toBe(403);
    expect((await start(signedInCookie(m.id), { body: { attest: true } })).cookies).toContain(adultCookie(false));
  });

  it("keeps every safeguard: the AI disclosure, the PG redirect and the crisis pause, exactly as for a member", async () => {
    const g = guest();
    const id = (await start(g.cookie)).body.episode_id;
    const opened = await act(g.cookie, id, { action: "advance" });
    expect(opened.body.view.disclosure).toMatchObject({ text: `${FIRST} is an AI character on a show.`, every: 6 });
    const before = turns;
    const explicit = await act(g.cookie, id, { action: "line", dialogue: "Let's skip dinner and have sex right here on the table." });
    expect(explicit.body.refused).toMatch(/The show is PG/);
    expect(turns).toBe(before);
    const crisis = await act(g.cookie, id, { action: "line", dialogue: "Honestly I want to kill myself." });
    expect(crisis.body.crisis_resources.lines.length).toBeGreaterThan(0);
    expect(crisis.body.view.paused).toBe(true);
    expect(turns).toBe(before);
    expect((await t.db.query<Any>(`select surface, n from crisis_referrals`)).rows).toEqual([{ surface: "step_in_line", n: 1 }]);
    // What a guest writes about themselves is checked before any date starts, too.
    const other = guest();
    const about = await start(other.cookie, { body: { persona: { ...persona, about: "Honestly I want to kill myself most days." } } });
    expect(about.body).toMatchObject({ error: "paused" });
    expect(await guestStepIns(t.db, other.id)).toBe(0);
  });

  it("gets three dates in all, across days; one left before a word is given back; then an account or a character", async () => {
    const g = guest();
    // Left before a word: given back.
    const one = await start(g.cookie);
    expect((await act(g.cookie, one.body.episode_id, { action: "leave" })).body).toMatchObject({ left: true, refunded: true });
    expect(await guestStepIns(t.db, g.id)).toBe(0);
    // One of theirs was on another day: it still counts ("in all", not a day).
    await t.db.query(`insert into step_in_usage (user_id, day, dates) values ($1, '2026-11-01', 1)`, [g.id]);
    for (let i = 0; i < STEP_IN_GUEST_DATES - 1; i++) {
      const s = await start(g.cookie);
      expect(s.status, `date ${i + 2}`).toBe(201);
      await sayOne(g.cookie, s.body.episode_id);
      expect((await act(g.cookie, s.body.episode_id, { action: "leave" })).body.refunded).toBe(false);
    }
    expect(await guestStepInsLeft(t.db, g.id)).toBe(0);
    const over = await start(g.cookie);
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("guest_used_up");
    // One plain sentence, and the two ways on: an account, or a character of their own (whose first date is with them).
    expect(over.body.message).toBe("That's the 3 dates you can step into without an account. Make a free account for one a day, or make a character and send them on dates.");
    expect(over.body.next).toEqual([
      { href: `/account?next=${encodeURIComponent(`/step-in?with=${CAST.id}`)}`, label: "Make a free account", track: "step-in-signup" },
      { href: `/create?meet=${CAST.id}`, label: `Make a character to date ${FIRST}`, track: "step-in-make" },
    ]);
    // A refusal isn't a date: nothing more is counted, here or in the show's day.
    expect(await guestStepIns(t.db, g.id)).toBe(STEP_IN_GUEST_DATES);
    expect(await hits("step_in_guest_day")).toBe(STEP_IN_GUEST_DATES);
    // Signed up (the account adopts this id): today's rules, the day's free one first.
    const signedUp = await start(`${signedInCookie(g.id)}; ${ADULT}`);
    expect(signedUp.status).toBe(201);
    expect((await t.db.query<Any>(`select setup->'step_in'->>'charge' as c from episodes where id = $1`, [signedUp.body.episode_id])).rows[0].c).toBe("daily_free");
  });

  it("can come as a character they made without an account", async () => {
    const g = guest();
    const mine = (await (await api.createCharacter(validCharacter({ name: "Ira Fenn" }), g.cookie)).json()) as Any;
    const s = await start(g.cookie, { body: { persona: undefined, character_id: mine.id } });
    expect(s.status).toBe(201);
    expect((await t.db.query<Any>(`select character_a, setup->'step_in' as s from episodes where id = $1`, [s.body.episode_id])).rows[0]).toMatchObject({ character_a: mine.id, s: { mode: "own", charge: "guest" } });
  });
});

describe("a \"you\" is a seat at the table, not a character (lib/step-in-shared.ts notPersonaSql)", () => {
  it("is never listed or counted on /characters, never takes a name, and isn't a character someone made", async () => {
    const g = guest();
    expect((await start(g.cookie)).status).toBe(201);
    const persona = (await t.db.query<Any>(`select id, name, owner_id, visibility from characters where owner_id = $1`, [`you:${g.id}`])).rows[0];
    expect(persona).toMatchObject({ name: "Sam", visibility: "private" });
    // With step-in open to everyone there's one of these for every visitor who plays.
    expect(await tabCounts(t.db)).toEqual({ people: 0, originals: 0, agents: 0, private: 0 });
    expect((await listTab(t.db, "people")).entries).toEqual([]);
    expect((await searchDirectory(t.db, "Sam")).entries).toEqual([]);
    expect((await listCast(t.db, 200)).some((c) => c.id === persona.id)).toBe(false);
    // A visitor called Sam doesn't stop anyone naming a character Sam.
    expect((await nameCheck(t.db, "Sam")).twin).toBeNull();
    const made = await api.createCharacter({ ...validCharacter({ name: "Sam" }), keep_name: false }, guest().cookie);
    expect(made.status).toBe(201);
    expect(await tabCounts(t.db)).toMatchObject({ people: 1 });
  });
});

describe("what stops a flood (all counted in Postgres)", () => {
  it("one address starts 4 guest dates an hour whatever cookies it sends; another address, and a member, aren't held", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < STEP_IN_IP_START_LIMITS.perHour; i++) expect((await start(guest().cookie, { ip })).status, `start ${i + 1}`).toBe(201);
    expect(await hits("step_in_start")).toBe(STEP_IN_IP_START_LIMITS.perHour);
    const fresh = guest();
    const refused = await start(fresh.cookie, { ip });
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe("busy_here");
    expect(refused.body.message).toBe("A lot of dates have started from your connection lately, so step-in is resting for it. Try again in an hour, or make a free account and use your own free date.");
    expect(refused.body.next[0]).toMatchObject({ label: "Make a free account" });
    // Refused before anything was taken or any model was asked: none of theirs used, nothing added to the show's day.
    expect(await guestStepIns(t.db, fresh.id)).toBe(0);
    expect(await hits("step_in_start")).toBe(STEP_IN_IP_START_LIMITS.perHour);
    expect(await hits("step_in_guest_day")).toBe(STEP_IN_IP_START_LIMITS.perHour);
    expect(checks).toBe(0);
    // The address is never stored: the key is an HMAC of it.
    expect((await t.db.query<Any>(`select distinct key from rate_hits where bucket = 'step_in_start'`)).rows).toEqual([{ key: keyOf(ip) }]);
    expect(keyOf(ip)).not.toContain("203");
    expect((await start(guest().cookie, { ip: "198.51.100.9" })).status).toBe(201);
    expect((await start(member().cookie, { ip })).status).toBe(201);
  });

  it("and 10 a day", async () => {
    const ip = "203.0.113.8";
    await fill("step_in_start", keyOf(ip), STEP_IN_IP_START_LIMITS.perDay, 120);
    expect((await start(guest().cookie, { ip })).body.error).toBe("busy_here");
    // Yesterday's don't count.
    await t.db.query(`update rate_hits set at = now() - interval '25 hours' where bucket = 'step_in_start'`);
    expect((await start(guest().cookie, { ip })).status).toBe(201);
  });

  it("the whole show takes STEP_IN_GUEST_DAILY_MAX guest dates a day: past it a guest is told, their date isn't used, members carry on", async () => {
    vi.stubEnv("STEP_IN_GUEST_DAILY_MAX", "2");
    expect((await start(guest().cookie)).status).toBe(201);
    expect((await start(guest().cookie)).status).toBe(201);
    const late = guest();
    const full = await start(late.cookie);
    expect(full.status).toBe(429);
    expect(full.body.error).toBe("guests_full");
    expect(full.body.message).toBe("Today's dates for visitors without an account are all taken. Make a free account for your own free date, or come back tomorrow.");
    expect(full.body.next[0].href).toContain("/account?next=");
    expect(await guestStepIns(t.db, late.id)).toBe(0);
    expect((await t.db.query(`select 1 from episodes where creator_id = $1`, [late.id])).rows).toHaveLength(0);
    expect((await start(member().cookie)).status).toBe(201);
    // Tomorrow there's room again.
    await t.db.query(`update rate_hits set at = now() - interval '25 hours' where bucket = 'step_in_guest_day'`);
    expect((await start(late.cookie)).status).toBe(201);
  });

  it("one address says 30 lines an hour: past it the line comes back unsent and unanswered, and the date is kept", async () => {
    const ip = "203.0.113.9";
    const g = guest();
    const id = (await start(g.cookie, { ip })).body.episode_id;
    await act(g.cookie, id, { action: "advance" }, ip);
    await fill("step_in_line", keyOf(ip), STEP_IN_IP_LINE_LIMITS.perHour);
    const before = turns;
    const capped = await act(g.cookie, id, { action: "line", dialogue: "I collect old maps of cities that never existed." }, ip);
    expect(capped.status).toBe(200);
    expect(capped.body.refused).toBe("That's a lot of lines from your connection this hour. Your date is saved: come back to it in a little while.");
    expect(capped.body.view.lines.some((l: Any) => l.side === "a")).toBe(false);
    expect(turns).toBe(before);
    expect((await t.db.query<Any>(`select status from episodes where id = $1`, [id])).rows[0].status).toBe("generating");
    // A member from that address is held too (nobody types thirty lines an hour); an admin isn't; another address isn't.
    const m = member();
    const mid = (await start(m.cookie, { ip })).body.episode_id;
    await act(m.cookie, mid, { action: "advance" }, ip);
    expect((await act(m.cookie, mid, { action: "line", dialogue: "I collect old maps of cities that never existed." }, ip)).body.refused).toMatch(/a lot of lines/);
    const elsewhere = await act(g.cookie, id, { action: "line", dialogue: "I collect old maps of cities that never existed." }, "198.51.100.9");
    expect(elsewhere.body.refused).toBeUndefined();
    expect(elsewhere.body.view.lines.some((l: Any) => l.side === "a")).toBe(true);
    const admin = member();
    await t.db.query("insert into admins (user_id) values ($1)", [admin.id]);
    const aid = (await start(admin.cookie, { ip })).body.episode_id;
    await act(admin.cookie, aid, { action: "advance" }, ip);
    expect((await act(admin.cookie, aid, { action: "line", dialogue: "I collect old maps of cities that never existed." }, ip)).body.refused).toBeUndefined();
  });

  it("past a cap the self-harm check still comes first, with no model call: the list, and a maybe counts as a hit", async () => {
    const ip = "203.0.113.10";
    const g = guest();
    const id = (await start(g.cookie, { ip })).body.episode_id;
    await act(g.cookie, id, { action: "advance" }, ip);
    await fill("step_in_line", keyOf(ip), STEP_IN_IP_LINE_LIMITS.perHour);
    const maybe = await act(g.cookie, id, { action: "line", dialogue: "It all feels hopeless lately, to be honest." }, ip);
    expect(maybe.body.crisis_resources.lines.length).toBeGreaterThan(0);
    expect(maybe.body.view.paused).toBe(true);
    expect(checks).toBe(0);
    expect((await t.db.query<Any>(`select surface, n from crisis_referrals`)).rows).toEqual([{ surface: "step_in_line", n: 1 }]);
  });

  it("one date takes 40 tries, whoever plays it: a line said, or the show asked for its side", async () => {
    const m = member();
    const id = (await start(m.cookie)).body.episode_id;
    await act(m.cookie, id, { action: "advance" });
    // Each ask from the page and each line is one try, counted on the date itself (a line's own reply isn't counted twice).
    expect(await hits("step_in_date")).toBe(1);
    await act(m.cookie, id, { action: "line", dialogue: "I collect old maps of cities that never existed." });
    expect(await hits("step_in_date")).toBe(2);
    await fill("step_in_date", id, STEP_IN_DATE_TRIES);
    const before = turns;
    const capped = await act(m.cookie, id, { action: "line", dialogue: "And I keep bees on the roof, badly." });
    expect(capped.body.refused).toBe("This date has had too many tries at a line. Leave it and start a fresh one.");
    const asked = await act(m.cookie, id, { action: "advance" });
    expect(asked.body.refused).toBe("This date has had too many tries at a line. Leave it and start a fresh one.");
    expect(turns).toBe(before);
    // Leaving still works, and another date is its own count.
    expect((await act(m.cookie, id, { action: "leave" })).body.left).toBe(true);
  });

  it("a guest's \"about me\" maybe goes to the model only while the show-wide count allows; past it, it counts as a hit", async () => {
    const maybe = { persona: { ...persona, about: "A hopeless romantic who bakes too much bread." } };
    // Checked by the model (a figure of speech passes) and the date starts.
    expect((await start(guest().cookie, { body: maybe })).status).toBe(201);
    expect(checks).toBe(1);
    expect(await hits("step_in_about_check")).toBe(1);
    await fill("step_in_about_check", "all", STEP_IN_GUEST_ABOUT_CHECKS.perHour);
    const g = guest();
    const held = await start(g.cookie, { body: maybe });
    expect(held.body).toMatchObject({ error: "paused" });
    expect(held.body.crisis_resources.lines.length).toBeGreaterThan(0);
    expect(checks).toBe(1);
    expect(await guestStepIns(t.db, g.id)).toBe(0);
    // An ordinary line about themselves never touches the count; a member's maybe is always checked.
    expect((await start(g.cookie)).status).toBe(201);
    expect((await start(member().cookie, { body: maybe })).status).toBe(201);
    expect(checks).toBe(2);
  });

  it("a member keeps today's rules: the address doesn't cap their starts, and nothing of theirs is in the guests' day", async () => {
    const ip = "203.0.113.11";
    await fill("step_in_start", keyOf(ip), STEP_IN_IP_START_LIMITS.perDay);
    const m = member();
    const s = await start(m.cookie, { ip });
    expect(s.status).toBe(201);
    expect((await t.db.query<Any>(`select setup->'step_in'->>'charge' as c from episodes where id = $1`, [s.body.episode_id])).rows[0].c).toBe("daily_free");
    expect(await hits("step_in_guest_day")).toBe(0);
  });
});

describe("the pages", () => {
  const as = (cookie: string | null) => {
    jar.cookies.clear();
    for (const part of (cookie ?? "").split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) jar.cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  };
  const page = async (cookie: string | null, sp: Record<string, string> = {}) => {
    as(cookie);
    return renderToStaticMarkup(await StepInPage({ searchParams: Promise.resolve(sp) }));
  };

  it("/step-in is a page a stranger lands on: the cast picker with faces, in the sitemap, indexable", async () => {
    const html = await page(null);
    expect(html).toContain("Who are you asking out?");
    expect(html).toContain("no account needed");
    expect(html).toContain(`<a class="stepin-cast-pick card" data-track="step-in" data-track-from="step-in-page" href="/step-in?with=${CAST.id}">`);
    expect(html.match(/class="stepin-cast-pick card"/g)).toHaveLength(2);
    expect(html).toContain(`<strong>${FIRST}</strong>`);
    expect(PUBLIC_PATHS).toContain("/step-in");
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("/step-in");
    // One cast member's start screen is the same page: not indexed apart.
    expect((await generateMetadata({ searchParams: Promise.resolve({ with: CAST.id }) })).robots).toEqual({ index: false, follow: true });
  });

  it("the start screen asks a visitor the gate hasn't asked for their 18+ answer inline, and says what it costs", async () => {
    const fresh = await page(null, { with: CAST.id });
    expect(fresh).toContain(`A date with ${FIRST}`);
    expect(fresh).toContain(`${FIRST} is an AI character on a show.`);
    expect(fresh).toContain('<label class="check stepin-attest"><input type="checkbox" required=""/>');
    expect(fresh).toContain("I&#x27;m 18 or over. Botchelor is an 18+ show.");
    expect(fresh).toContain("Free to try, no account needed: 3 dates on the show.");
    expect(fresh).toContain(`Step in with ${FIRST}`);
    // Past the gate already: no box.
    const g = guest();
    expect(await page(g.cookie, { with: CAST.id })).not.toContain("stepin-attest");
    // A member's first of the day is free.
    expect(await page(member().cookie, { with: CAST.id })).toContain("Your first step-in today is free.");
  });

  it("a guest who's had their three reads why, and the two ways on, instead of a dead button", async () => {
    const g = guest();
    await t.db.query(`insert into step_in_usage (user_id, day, dates) values ($1, '2026-11-01', $2)`, [g.id, STEP_IN_GUEST_DATES]);
    const html = await page(g.cookie, { with: CAST.id });
    expect(html).toContain("That&#x27;s the 3 dates you can step into without an account. Make a free account for one a day, or make a character and send them on dates.");
    expect(html).toContain(`<a class="button" data-track="step-in-signup" href="/account?next=${encodeURIComponent(`/step-in?with=${CAST.id}`)}">Make a free account</a>`);
    expect(html).toContain(`<a class="button secondary" data-track="step-in-make" href="/create?meet=${CAST.id}">Make a character to date ${FIRST}</a>`);
    expect(html).not.toContain('data-track="step-in-start"');
  });

  it("guests off: the same screen invites them to sign in; closed: not found", async () => {
    vi.stubEnv("STEP_IN_GUESTS", "0");
    const html = await page(null, { with: CAST.id });
    expect(html).toContain(`Sign in to step in with ${FIRST}`);
    expect(html).toContain(`href="/account?next=${encodeURIComponent(`/step-in?with=${CAST.id}`)}"`);
    expect(html).not.toContain("stepin-form");
    vi.stubEnv("STEP_IN_OPEN", "0");
    await expect(page(null)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page(member().cookie)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a guest's date opens for them and for nobody else", async () => {
    const g = guest();
    const id = (await start(g.cookie)).body.episode_id;
    const open = async (cookie: string | null) => {
      as(cookie);
      return renderToStaticMarkup(await StepInDatePage({ params: Promise.resolve({ id }) }));
    };
    expect(await open(g.cookie)).toContain(`${FIRST} is AI`);
    await expect(open(guest().cookie)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(open(null)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the verdict, shared (lib/step-in-share.ts)", () => {
  it("a finished date carries a signed link that says only the cast member and the ending", async () => {
    const g = guest();
    const id = (await start(g.cookie)).body.episode_id;
    const done = await playThrough(g.cookie, id);
    expect(done.body.view.state).toBe("done");
    expect(done.body.view.ending.family).toBe("friends");
    const path = done.body.view.ending.share_path as string;
    const q = Object.fromEntries(new URL(path, BASE_URL).searchParams.entries());
    expect(new URL(path, BASE_URL).pathname).toBe("/step-in");
    expect(Object.keys(q).sort()).toEqual(["got", "k", "n", "ref", "t", "with"]);
    expect(q).toMatchObject({ with: CAST.id, n: FIRST, got: "friends", ref: "stepin" });
    // Never the date's id, the person or a word they said.
    expect(path).not.toContain(id);
    expect(path).not.toContain(g.id);
    expect(path).not.toContain("Sam");
    expect(readStepInShare(q)).toMatchObject({ with: CAST.id, name: FIRST, got: "friends" });
    // The page greets the reader with it, in the show's own words, and the card is the link's own picture.
    jar.cookies.clear();
    const html = renderToStaticMarkup(await StepInPage({ searchParams: Promise.resolve(q) }));
    expect(html).toContain(`Someone stepped into a date with ${FIRST} and it ended: <strong>Friends.</strong> Your turn.`);
    const meta = await generateMetadata({ searchParams: Promise.resolve(q) });
    expect(String(meta.title)).toBe(`${FIRST} and I: friends. · Botchelor`);
    const image = (meta.openGraph!.images as { url: string }[])[0].url;
    expect(image).toBe(stepInShareImage(readStepInShare(q)!));
    expect(image.startsWith("/api/og/step-in?")).toBe(true);
    const card = await cardRoute(new Request(BASE_URL + image));
    expect(card.status).toBe(200);
    expect(card.headers.get("content-type")).toBe("image/png");
  });

  it("can't be edited into another verdict, another cast member or another name, and nothing is signed without a secret", () => {
    const path = stepInSharePath({ episodeId: "ep-1", castId: CAST.id, castName: CAST.name, ending: "disaster" })!;
    const q = Object.fromEntries(new URL(path, BASE_URL).searchParams.entries());
    expect(readStepInShare(q)).toMatchObject({ got: "disaster" });
    expect(readStepInShare({ ...q, got: "second_date" })).toBeNull();
    expect(readStepInShare({ ...q, with: HOUSE_CHARACTERS[1].id })).toBeNull();
    expect(readStepInShare({ ...q, n: "Anyone" })).toBeNull();
    expect(readStepInShare({ ...q, got: "a rude word" })).toBeNull();
    expect(readStepInShare({ ...q, k: "x".repeat(22) })).toBeNull();
    expect(readStepInShare({ ...q, t: undefined })).toBeNull();
    // Another date's link is a different link (each real verdict signs once).
    expect(stepInSharePath({ episodeId: "ep-2", castId: CAST.id, castName: CAST.name, ending: "disaster" })).not.toBe(path);
    expect(stepInSharePath({ episodeId: "ep-1", castId: CAST.id, castName: CAST.name, ending: "disaster" }, {})).toBeNull();
    expect(readStepInShare(q, {})).toBeNull();
    expect(readStepInShare(q, { SESSION_SECRET: "another-secret-entirely-0123456789" })).toBeNull();
  });

  it("says one of three fixed sentences, and an unsigned link gets the plain invitation card", async () => {
    expect(STEP_IN_SHARE_WORDS.second_date.card("Juniper")).toBe("I got a second date with Juniper");
    expect(STEP_IN_SHARE_WORDS.friends.said).toBe("Friends.");
    expect(STEP_IN_SHARE_WORDS.disaster.said).toBe("A disaster.");
    expect(stepInShareText("Juniper", "second_date", "https://botchelor.com/step-in?x")).toBe("I got a second date with Juniper on Botchelor. Your turn:\nhttps://botchelor.com/step-in?x");
    const plain = await cardRoute(new Request(`${BASE_URL}/api/og/step-in?with=${CAST.id}&got=second_date&n=Anyone&t=aaaaaaaaaaaa&k=${"x".repeat(22)}`));
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toBe("image/png");
    // A forged link reads as the plain start screen: no verdict on the page.
    jar.cookies.clear();
    const html = renderToStaticMarkup(await StepInPage({ searchParams: Promise.resolve({ with: CAST.id, got: "second_date", n: FIRST, t: "aaaaaaaaaaaa", k: "x".repeat(22) }) }));
    expect(html).not.toContain("Someone stepped into a date");
  });
});
