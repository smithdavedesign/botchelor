// Sessions end (lib/session-versions.ts, lib/auth.ts readSession; the 2026-11-22 audit): a password change, "Sign out
// everywhere" and deleting the account end the sessions already handed out; a signed-in session runs out after 60 days
// unused and one in use is signed again; an anonymous session never runs out; an account's id without its sign-in reads
// none of its lists.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as carry } from "@/app/api/auth/carry/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as passwordRoute } from "@/app/api/auth/password/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { POST as resetRoute } from "@/app/api/auth/reset/route";
import { GET as myCharacters } from "@/app/api/me/characters/route";
import { GET as myEpisodes } from "@/app/api/me/episodes/route";
import { DELETE as deleteMe, GET as meRoute } from "@/app/api/me/route";
import { signResetToken } from "@/lib/account-recovery";
import {
  newCarryNonce,
  readSession,
  registerAccount,
  SESSION_MAX_AGE_SECONDS,
  SESSION_RENEW_AFTER_SECONDS,
  signCarry,
  signSession,
  verifyCarry,
  verifySession,
} from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { bumpSessionVersion, forgetSessionVersionsForTests, freshSessionVersion, knownSessionVersion, refreshSessionVersions } from "@/lib/session-versions";
import { api, BASE_URL, startTestDb, validCharacter } from "./helpers";

// Built from parts so no literal secret or password sits in the repo (GitGuardian scans every commit).
const SECRET = ["versions", "test", "secret", "abcdefghij0123456789"].join("-");
const PW = ["lantern", "keeper", "42"].join("-");
const PW2 = ["another", "good", "one"].join("-");
const DAY = 24 * 60 * 60 * 1000;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from accounts");
  vi.stubEnv("SESSION_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

const sess = (uid: string, authenticated = true, now = Date.now()) => `bz_sess=${signSession({ uid, authenticated }, process.env, now)}`;
const token = (cookie: string) => cookie.slice("bz_sess=".length);
const cookieOf = (res: Response, name = "bz_sess") => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0] ?? null;
/** Whether a reply clears this browser's session cookie (signing out sets an empty one last). */
const clears = (res: Response) => res.headers.getSetCookie().some((c) => c.startsWith("bz_sess=;"));
const post = (path: string, body: unknown, cookie?: string) =>
  new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path: string, cookie: string) => new Request(BASE_URL + path, { headers: { cookie } });

let handles = 0;
/** A handle-and-password account, signed in on two devices. */
async function signedInTwice() {
  const id = crypto.randomUUID();
  const handle = `ender_${++handles}_${id.slice(0, 6)}`;
  await registerAccount(t.db, id, handle, PW);
  return { id, handle, phone: sess(id), laptop: sess(id) };
}

describe("a session token", () => {
  it("runs out 60 days after it was signed when it's signed in, and never when it's anonymous", () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const recent = token(sess(id, true, now - (SESSION_MAX_AGE_SECONDS - 60) * 1000));
    const stale = token(sess(id, true, now - (SESSION_MAX_AGE_SECONDS + 60) * 1000));
    expect(verifySession(recent)).toEqual({ uid: id, authenticated: true });
    expect(verifySession(stale)).toBeNull();
    // What an anonymous visitor made has no other way back to them.
    expect(verifySession(token(sess(id, false, now - 400 * DAY)))).toEqual({ uid: id, authenticated: false });
  });

  it("is refused once its account's version moves past the one it was signed with, anonymous or not", async () => {
    const id = crypto.randomUUID();
    const other = crypto.randomUUID();
    const before = token(sess(id));
    const anonymous = token(sess(id, false));
    const someoneElse = token(sess(other));
    expect(await bumpSessionVersion(t.db, id)).toBe(1);
    expect(verifySession(before)).toBeNull();
    expect(verifySession(anonymous)).toBeNull();
    expect(verifySession(someoneElse)).toEqual({ uid: other, authenticated: true });
    // Signed after the move: the new version, and good.
    const after = token(sess(id));
    expect(readSession(after)).toMatchObject({ uid: id, authenticated: true, version: 1 });
    expect(await bumpSessionVersion(t.db, id)).toBe(2);
    expect(verifySession(after)).toBeNull();
  });

  it("learns another process's moves from the database at most once a minute, and only what changed after the first load", async () => {
    const id = crypto.randomUUID();
    const later = crypto.randomUUID();
    const old = token(sess(id));
    await t.db.query(`insert into session_versions (user_id, version) values ($1, 3)`, [id]);
    expect(verifySession(old)).not.toBeNull(); // this process hasn't loaded it yet
    const now = Date.now();
    await refreshSessionVersions(t.db, now);
    expect(knownSessionVersion(id)).toBe(3);
    expect(verifySession(old)).toBeNull();
    await t.db.query(`insert into session_versions (user_id, version) values ($1, 1)`, [later]);
    await refreshSessionVersions(t.db, now + 30_000);
    expect(knownSessionVersion(later)).toBe(0); // within the minute: no query
    await refreshSessionVersions(t.db, now + 61_000);
    expect(knownSessionVersion(later)).toBe(1);
    // A version only ever goes up here, whatever a load says.
    await t.db.query(`update session_versions set version = 1, changed_at = now() where user_id = $1`, [id]);
    await refreshSessionVersions(t.db, now + 122_000);
    expect(knownSessionVersion(id)).toBe(3);
  });
});

describe("ending sessions", () => {
  it("Sign out everywhere ends every device's session; an ordinary sign-out ends only its own", async () => {
    const { id, phone, laptop } = await signedInTwice();
    const out = await logoutRoute(post("/api/auth/logout", {}, phone));
    expect(out.status).toBe(200);
    expect(clears(out)).toBe(true);
    expect(verifySession(token(laptop))).toEqual({ uid: id, authenticated: true }); // the laptop stays signed in

    const everywhere = await logoutRoute(post("/api/auth/logout", { everywhere: true }, laptop));
    expect(await everywhere.json()).toEqual({ authenticated: false, everywhere: true });
    expect(verifySession(token(laptop))).toBeNull();
    expect(verifySession(token(phone))).toBeNull();
    const me = await (await meRoute(get("/api/me", laptop))).json();
    expect(me).toMatchObject({ authenticated: false, account: null });
  });

  it("only a signed-in session can sign an account out everywhere, and a bodiless sign-out still works", async () => {
    const { id, laptop } = await signedInTwice();
    const res = await logoutRoute(post("/api/auth/logout", { everywhere: true }, sess(id, false)));
    expect(await res.json()).toEqual({ authenticated: false });
    expect(verifySession(token(laptop))).not.toBeNull();
    expect((await logoutRoute(new Request(BASE_URL + "/api/auth/logout", { method: "POST" }))).status).toBe(200);
  });

  it("a password change signs every other device out and keeps this one signed in", async () => {
    const { id, phone, laptop } = await signedInTwice();
    const res = await passwordRoute(post("/api/auth/password", { current: PW, password: PW2 }, phone));
    expect(res.status).toBe(200);
    expect(verifySession(token(laptop))).toBeNull();
    expect(verifySession(token(phone))).toBeNull();
    const fresh = cookieOf(res)!;
    expect(verifySession(token(fresh))).toEqual({ uid: id, authenticated: true });
    expect((await (await meRoute(get("/api/me", fresh))).json()).authenticated).toBe(true);
  });

  it("a password reset from the emailed link does too, and signs that browser in", async () => {
    const { id, phone } = await signedInTwice();
    const account = (await t.db.query<{ password_hash: string }>(`select password_hash from accounts where user_id = $1`, [id])).rows[0];
    const link = signResetToken(id, account.password_hash);
    const res = await resetRoute(post("/api/auth/reset", { t: link, password: PW2 }));
    expect(res.status).toBe(200);
    expect(verifySession(token(phone))).toBeNull();
    expect(verifySession(token(cookieOf(res)!))).toEqual({ uid: id, authenticated: true });
  });

  it("deleting the account ends its sessions everywhere and clears this browser's cookie", async () => {
    const { id, phone, laptop } = await signedInTwice();
    const res = await deleteMe(new Request(BASE_URL + "/api/me", { method: "DELETE", headers: { "content-type": "application/json", cookie: phone }, body: JSON.stringify({ confirm: true }) }));
    expect(res.status).toBe(200);
    expect(clears(res)).toBe(true);
    expect(verifySession(token(laptop))).toBeNull();
    expect(await (await meRoute(get("/api/me", laptop))).json()).toMatchObject({ authenticated: false, account: null });
    expect(knownSessionVersion(id)).toBe(1);
  });
});

describe("signing in after a change made elsewhere", () => {
  it("signs with the account's version as the database has it, so the session isn't refused a minute later", async () => {
    const { id, handle } = await signedInTwice();
    // Another process moved it (a password change there); this one hasn't heard.
    await t.db.query(`insert into session_versions (user_id, version) values ($1, 2)`, [id]);
    const res = await loginRoute(post("/api/auth/login", { handle, password: PW }));
    expect(res.status).toBe(200);
    const signedIn = token(cookieOf(res)!);
    expect(readSession(signedIn)?.version).toBe(2);
    await refreshSessionVersions(t.db, Date.now() + 61_000);
    expect(verifySession(signedIn)).toEqual({ uid: id, authenticated: true });
  });

  it("a new account reads its id's version too", async () => {
    const id = crypto.randomUUID();
    await t.db.query(`insert into session_versions (user_id, version) values ($1, 4)`, [id]);
    expect(await freshSessionVersion(t.db, id)).toBe(4);
    forgetSessionVersionsForTests();
    const res = await registerRoute(post("/api/auth/register", { handle: `fresh_${id.slice(0, 6)}`, password: PW, attest: true }, `bz_uid=${id}`));
    expect(res.status).toBe(201);
    expect(readSession(token(cookieOf(res)!))?.version).toBe(4);
  });
});

describe("a session in use is signed again (lib/http.ts handle)", () => {
  const ok = handle(async () => json({ ok: true }));
  const cached = handle(async () => new Response("{}", { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } }));

  it("once a day old, an API reply carries it newly signed, same account and same version", async () => {
    const id = crypto.randomUUID();
    await bumpSessionVersion(t.db, id);
    const old = sess(id, true, Date.now() - SESSION_RENEW_AFTER_SECONDS * 1000 - 60_000);
    const res = await ok(get("/api/anything", old));
    const renewed = readSession(token(cookieOf(res)!))!;
    expect(renewed).toMatchObject({ uid: id, authenticated: true, version: 1 });
    expect(Date.now() / 1000 - renewed.issuedAt).toBeLessThan(5);
  });

  it("leaves a fresh session, an anonymous one and a reply a cache could keep alone", async () => {
    const id = crypto.randomUUID();
    const dayOld = Date.now() - SESSION_RENEW_AFTER_SECONDS * 1000 - 60_000;
    expect(cookieOf(await ok(get("/api/anything", sess(id))))).toBeNull();
    expect(cookieOf(await ok(get("/api/anything", sess(id, false, dayOld))))).toBeNull();
    expect(cookieOf(await cached(get("/api/anything", sess(id, true, dayOld))))).toBeNull();
  });

  it("never brings back a session its account has ended", async () => {
    const id = crypto.randomUUID();
    const old = sess(id, true, Date.now() - 2 * DAY);
    await bumpSessionVersion(t.db, id);
    expect(cookieOf(await ok(get("/api/anything", old)))).toBeNull();
  });
});

describe("an account's id without its sign-in", () => {
  it("reads none of the account page's lists", async () => {
    const { id, phone } = await signedInTwice();
    expect((await api.createCharacter(validCharacter(), phone)).ok).toBe(true);
    expect((await (await myCharacters(get("/api/me/characters", phone))).json()).characters).toHaveLength(1);
    const unsigned = sess(id, false);
    expect((await (await myCharacters(get("/api/me/characters", unsigned))).json()).characters).toEqual([]);
    expect(await (await myEpisodes(get("/api/me/episodes", unsigned))).json()).toMatchObject({ episodes: [], total: 0 });
  });

  it("isn't reported signed in by /api/me when its account is gone", async () => {
    const res = await meRoute(get("/api/me", sess(crypto.randomUUID())));
    expect(await res.json()).toMatchObject({ authenticated: false, account: null });
  });
});

describe("moving hosts keeps the session's version (app/api/auth/carry)", () => {
  const OLD = "https://botchelor.vercel.app/api/auth/carry";
  const NEW = "https://botchelor.com/api/auth/carry";

  it("the token carries it, and the receiving host signs that one, or nothing once the account has moved past it", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    const id = crypto.randomUUID();
    await bumpSessionVersion(t.db, id);
    await bumpSessionVersion(t.db, id);
    const nonce = newCarryNonce();
    const minted = await carry(new Request(`${OLD}?n=${nonce}&to=%2Fshop`, { headers: { cookie: sess(id) } }));
    const carried = new URL(minted.headers.get("location")!).searchParams.get("t");
    expect(verifyCarry(carried)).toMatchObject({ uid: id, authenticated: true, version: 2 });

    const landed = await carry(new Request(`${NEW}?t=${encodeURIComponent(carried!)}&to=%2Fshop`, { headers: { cookie: `bz_carry=${nonce}` } }));
    expect(readSession(token(cookieOf(landed)!))).toMatchObject({ uid: id, version: 2 });

    const stale = signCarry({ uid: id, authenticated: true, adult: false, nonce, version: 1 })!;
    const refused = await carry(new Request(`${NEW}?t=${encodeURIComponent(stale)}&to=%2Fshop`, { headers: { cookie: `bz_carry=${nonce}` } }));
    expect(cookieOf(refused)).toBeNull();
  });
});
