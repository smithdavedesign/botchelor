import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { GET as googleStart } from "@/app/api/auth/google/start/route";
import { signSession } from "@/lib/auth";
import { ON_SALE } from "@/lib/catalog";
import { api, openPayments, startTestDb } from "./helpers";

// Buying needs an account (app/api/checkout): bought tokens hang off the buyer's id, and an anonymous id is one
// browser's cookie. Built from parts so no literal secret sits in the repo (GitGuardian scans every commit).
const SECRET = ["buy", "test", "secret", "abcdefghij0123456789"].join("-");
const PACK = ON_SALE[0];
const sessCookie = (uid: string, authenticated: boolean) => `bz_sess=${signSession({ uid, authenticated }, { SESSION_SECRET: SECRET })}`;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.unstubAllEnvs();
  openPayments(vi.stubEnv);
  vi.stubEnv("SESSION_SECRET", SECRET);
});

describe("checkout needs an account", () => {
  it("turns an anonymous buyer away with a way to sign in, and records no order", async () => {
    const res = await api.checkout({ sku: PACK.sku, attest: true }, sessCookie(crypto.randomUUID(), false));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("account_required");
    expect(body.signin).toBe("/account?next=%2Fshop");
    expect((await t.db.query(`select count(*)::int as n from orders`)).rows[0].n).toBe(0);
    // A first-time visitor with no cookie at all is anonymous too.
    expect((await api.checkout({ sku: PACK.sku, attest: true })).status).toBe(401);
  });

  it("lets a signed-in player buy", async () => {
    const res = await api.checkout({ sku: PACK.sku, attest: true }, sessCookie(crypto.randomUUID(), true));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("client_reference_id=");
  });

  it("keeps anonymous buying where the deployment has no accounts at all (no SESSION_SECRET)", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect((await api.checkout({ sku: PACK.sku, attest: true })).status).toBe(200);
  });
});

describe("Google sign-in returns to where it was asked to (the shop)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", ["client", "sec"].join("-"));
  });

  it("/start keeps ?next in a short-lived cookie, and through the host hop", async () => {
    const start = await googleStart(new Request("http://localhost:3000/api/auth/google/start?next=%2Fshop"));
    expect(start.headers.getSetCookie().find((c) => c.startsWith("bz_next="))).toMatch(/^bz_next=%2Fshop; Path=\/api\/auth\/google; HttpOnly/);
    vi.stubEnv("OAUTH_REDIRECT_BASE", "https://botchelor.com");
    const hop = await googleStart(new Request("https://botchelor.vercel.app/api/auth/google/start?next=%2Fshop"));
    expect(hop.headers.get("location")).toBe("https://botchelor.com/api/auth/google/start?hop=1&next=%2Fshop");
  });

  it("/start without ?next clears any old destination, and an outside one is refused", async () => {
    const plain = await googleStart(new Request("http://localhost:3000/api/auth/google/start"));
    expect(plain.headers.getSetCookie().find((c) => c.startsWith("bz_next="))).toMatch(/^bz_next=; .*Max-Age=0/);
    const evil = await googleStart(new Request("http://localhost:3000/api/auth/google/start?next=%2F%2Fevil.example"));
    expect(evil.headers.getSetCookie().find((c) => c.startsWith("bz_next="))).toMatch(/^bz_next=%2F;/); // safeFrom → "/"
  });

  it("a failed callback still remembers the destination, so trying again lands on the shop", async () => {
    const res = await googleCallback(new Request("http://localhost:3000/api/auth/google/callback?code=abc&state=forged", { headers: { cookie: "bz_next=%2Fshop" } }));
    expect(res.headers.get("location")).toBe("/account?error=oauth_state&next=%2Fshop");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("bz_next=;"))).toBe(true); // cleared
    const outside = await googleCallback(new Request("http://localhost:3000/api/auth/google/callback?code=abc&state=forged", { headers: { cookie: "bz_next=%2F%2Fevil.example" } }));
    expect(outside.headers.get("location")).toBe("/account?error=oauth_state");
  });
});
