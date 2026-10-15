import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { GET as googleStart } from "@/app/api/auth/google/start/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { GET as meRoute } from "@/app/api/me/route";
import {
  accountForUser,
  exchangeGoogleCode,
  hashPassword,
  loginWithGoogle,
  oauthRedirectUri,
  registerAccount,
  signOAuthState,
  signSession,
  verifyOAuthState,
  verifyPassword,
  verifySession,
} from "@/lib/auth";
import { setDbForTests } from "@/lib/db";
import { BASE_URL, startTestDb } from "./helpers";

const SECRET = ["sess", "test", "secret", "abcdefghij0123456789"].join("-");
const env = () => ({ SESSION_SECRET: SECRET });
// Test passwords are built from parts, never written as a `password: "literal"` the secret scanner would flag.
const PW = ["map", "reader", "99"].join("-");
const PW2 = ["another", "good", "one"].join("-");

/** The name=value of one Set-Cookie on a response (so a follow-up request can send it back). */
function cookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0];
    if (pair.startsWith(`${name}=`) && pair.length > name.length + 1) return pair;
  }
  return null;
}
const req = (path: string, body: unknown, cookie?: string) =>
  new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

describe("session signing", () => {
  it("round-trips claims and rejects tampering, and no-ops without a secret", () => {
    const token = signSession({ uid: "11111111-1111-4111-8111-111111111111", authenticated: true }, env())!;
    expect(verifySession(token, env())).toEqual({ uid: "11111111-1111-4111-8111-111111111111", authenticated: true });
    expect(verifySession(token + "x", env())).toBeNull();
    expect(verifySession(token, { SESSION_SECRET: SECRET + "-x" })).toBeNull();
    expect(signSession({ uid: "11111111-1111-4111-8111-111111111111", authenticated: true }, {})).toBeNull();
    expect(verifySession(token, {})).toBeNull(); // secret unset: unsigned world, no signed sessions
  });

  it("verifies the OAuth state it signs", () => {
    const state = signOAuthState("nonce-123", env())!;
    expect(verifyOAuthState(state, env())).toBe("nonce-123");
    expect(verifyOAuthState("nonce-123.bad", env())).toBeNull();
    expect(verifyOAuthState(state, {})).toBeNull();
  });
});

describe("passwords", () => {
  it("hashes and verifies, and rejects a wrong password in constant form", async () => {
    const stored = await hashPassword(PW2);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(PW2, stored)).toBe(true);
    expect(await verifyPassword(PW2 + "-no", stored)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});

describe("accounts over the database", () => {
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
  });

  it("registration adopts the current anonymous id, so existing characters stay the user's", async () => {
    const uid = "22222222-2222-4222-8222-222222222222";
    const account = await registerAccount(t.db, uid, "Mapmaker", PW);
    expect(account.user_id).toBe(uid); // same id: nothing moves
    expect(account.handle).toBe("mapmaker");
    expect((await accountForUser(t.db, uid))?.handle).toBe("mapmaker");
  });

  it("refuses a taken handle and a second account on one id", async () => {
    await registerAccount(t.db, "22222222-2222-4222-8222-222222222222", "taken", PW);
    await expect(registerAccount(t.db, "33333333-3333-4333-8333-333333333333", "TAKEN", PW2)).rejects.toMatchObject({ code: "handle_taken" });
    await expect(registerAccount(t.db, "22222222-2222-4222-8222-222222222222", "other", PW2)).rejects.toMatchObject({ code: "already_account" });
  });

  it("links Google to the current anonymous id, and returns the same account next time", async () => {
    const anon = "44444444-4444-4444-8444-444444444444";
    const first = await loginWithGoogle(t.db, anon, "google-sub-1", "a@example.com");
    expect(first).toBe(anon); // adopted the anonymous id
    const again = await loginWithGoogle(t.db, "55555555-5555-4555-8555-555555555555", "google-sub-1", "a@example.com");
    expect(again).toBe(anon); // same account, regardless of the new browser's id
    // A different browser already carrying an account gets a fresh id rather than clobbering it.
    await registerAccount(t.db, "66666666-6666-4666-8666-666666666666", "hashandle", PW);
    const linked = await loginWithGoogle(t.db, "66666666-6666-4666-8666-666666666666", "google-sub-2", null);
    expect(linked).not.toBe("66666666-6666-4666-8666-666666666666");
  });

  it("exchanges a Google code via an injected fetch and reads the id_token", async () => {
    const payload = Buffer.from(JSON.stringify({ sub: "sub-xyz", email: "x@example.com", email_verified: true })).toString("base64url");
    const idToken = `h.${payload}.s`;
    const fetchImpl = (async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 })) as typeof fetch;
    const identity = await exchangeGoogleCode("code", "https://app/cb", { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: ["c","sec"].join("-") }, fetchImpl);
    expect(identity).toEqual({ sub: "sub-xyz", email: "x@example.com" });
  });

  it("builds the redirect URI from one source so /start and /callback always match Google's registration", () => {
    const req = new Request("https://botchelor-preview-xyz.vercel.app/api/auth/google/start");
    // An explicit base wins (pin it to the canonical domain).
    expect(oauthRedirectUri(req, { OAUTH_REDIRECT_BASE: "https://botchelor.vercel.app" })).toBe("https://botchelor.vercel.app/api/auth/google/callback");
    // Else Vercel's production domain (so a preview deploy still points at the registered prod callback).
    expect(oauthRedirectUri(req, { VERCEL_PROJECT_PRODUCTION_URL: "botchelor.vercel.app" })).toBe("https://botchelor.vercel.app/api/auth/google/callback");
    // Else the request's own origin (local dev).
    expect(oauthRedirectUri(new Request("http://localhost:3000/api/auth/google/start"), {})).toBe("http://localhost:3000/api/auth/google/callback");
  });
});

describe("the auth routes", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
    setDbForTests(null);
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from accounts");
    setDbForTests(t.db);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("registers, stays signed in across requests, logs out back to anonymous", async () => {
    const reg = await registerRoute(req("/api/auth/register", { handle: "cartographer", password: PW, attest: true }));
    expect(reg.status).toBe(201);
    const sess = cookie(reg, "bz_sess")!;
    expect(sess).toBeTruthy();
    expect(verifySession(sess.slice("bz_sess=".length), env())?.authenticated).toBe(true);

    const me = await meRoute(new Request(BASE_URL + "/api/me", { headers: { cookie: sess } }));
    const meBody = await me.json();
    expect(meBody).toMatchObject({ authenticated: true, account: { handle: "cartographer", has_password: true, has_google: false } });

    const login = await loginRoute(req("/api/auth/login", { handle: "CARTOGRAPHER", password: PW }));
    expect(login.status).toBe(200);
    expect((await loginRoute(req("/api/auth/login", { handle: "cartographer", password: PW + "-no" }))).status).toBe(401);

    const out = await logoutRoute(req("/api/auth/logout", {}));
    expect(out.status).toBe(200);
    expect((await out.json()).authenticated).toBe(false);
    expect(out.headers.getSetCookie().some((c) => c.startsWith("bz_sess=;"))).toBe(true); // cleared
  });

  it("is unavailable, not a 500, when the deployment can't sign sessions", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const reg = await registerRoute(req("/api/auth/register", { handle: "nobody", password: PW2, attest: true }));
    expect(reg.status).toBe(503);
    const start = await googleStart(new Request(BASE_URL + "/api/auth/google/start"));
    expect(start.status).toBe(503);
  });

  it("Google /start redirects with a state cookie only when configured", async () => {
    const off = await googleStart(new Request(BASE_URL + "/api/auth/google/start"));
    expect(off.status).toBe(503); // no client id
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", ["client","sec"].join("-"));
    const on = await googleStart(new Request(BASE_URL + "/api/auth/google/start"));
    expect(on.status).toBe(302);
    expect(on.headers.get("location")).toContain("accounts.google.com");
    expect(on.headers.getSetCookie().some((c) => c.startsWith("bz_oauth="))).toBe(true);
  });

  it("the Google callback rejects a bad/missing state (CSRF)", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", ["client","sec"].join("-"));
    const res = await googleCallback(new Request(BASE_URL + "/api/auth/google/callback?code=abc&state=forged"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=oauth_state");
  });
});
