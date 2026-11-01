import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #1173 (David, 2026-11-01: "yes do 1-3"): After Dark's own tokens page says what a token buys, what the pass includes and
// that the show's shop sells tokens as dates; After Dark's header pill goes there.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => "/after-dark",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Nav from "@/app/Nav";
import AfterDarkTokensPage from "@/app/after-dark/tokens/page";
import { claimAdmin } from "@/lib/admins";
import { newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Signed in as this user (After Dark is for accounts only). */
function as(userId: string) {
  jar.cookies.clear();
  const c = signedInCookie(userId);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
}
const page = async () => renderToStaticMarkup(await AfterDarkTokensPage());

describe("#1173: After Dark's tokens page", () => {
  it("a subscriber reads their balance, what's included and left this month, every extra's price, and where tokens come from", async () => {
    const me = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [me]);
    as(me);
    const html = await page();
    expect(html).toMatch(/You have <strong data-token-balance="true">0<\/strong> tokens/);
    expect(html).toMatch(/Your subscription covers the nights themselves/);
    expect(html).toMatch(/Scene steps this month: 300 of 300 left/);
    expect(html).toMatch(/A chapter of a night[^<]*<\/td><td><strong>included/);
    expect(html).toMatch(/The video of the night<\/td><td><strong>7 tokens/);
    expect(html).toMatch(/Taking them somewhere else mid-night<\/td><td><strong>1 token</);
    expect(html).toMatch(/sold on the show&#x27;s shop as packs of <strong>dates<\/strong>: one date bought there is one token here/);
  });

  it("an admin pays nothing", async () => {
    const me = userIdOf(newUserCookie());
    await claimAdmin(t.db, me);
    as(me);
    const html = await page();
    expect(html).toMatch(/As an admin, nothing costs you tokens/);
    expect(html).toMatch(/The video of the night<\/td><td><strong>free/);
  });

  it("is not found for anyone After Dark isn't open to", async () => {
    as(userIdOf(newUserCookie()));
    await expect(page()).rejects.toThrow();
  });

  it("After Dark's header pill links to it; the show's goes to the shop", () => {
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 3, meter: "tokens" }))).toMatch(/class="token-pill"[^>]*href="\/after-dark\/tokens"/);
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 3 }))).toMatch(/class="token-pill"[^>]*href="\/shop"/);
  });
});
