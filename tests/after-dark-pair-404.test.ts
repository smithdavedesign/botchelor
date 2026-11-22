import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A pair's page (app/after-dark/[a]/[b]) has a loading screen, and once that has gone out the answer is a 200: a pair URL
// nobody may open answered 200 with a not-found page in it (the 2026-11-22 audit: signed out, not a member, made-up
// ids). Its layout now asks first (app/NotFoundBeforeLoading.tsx), by the page's own rule; a no is a real 404, and what
// it lets through the page opens as before.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => jar.headers,
}));
import { createElement, type ReactElement, type ReactNode } from "react";
import AfterDarkPairLayout from "@/app/after-dark/[a]/[b]/layout";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { setAdultSwitch } from "@/lib/adult/characters";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
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
  jar.headers = new Headers();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const [H0, H1] = HOUSE_CHARACTERS.slice(0, 2).map((c) => c.id);
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
const THE_PAGE = createElement("p", null, "the night");

/** Signed in as this user (a session cookie), or signed out. */
function as(userId: string | null) {
  jar.cookies.clear();
  if (!userId) return;
  const cookie = signedInCookie(userId);
  jar.cookies.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1));
}

type Early = ReactElement<{ known: () => Promise<boolean> }>;
/** The layout for this pair: its early check (whose answer is the 404, or nothing) beside the page it wraps. */
function layout(a: string, b: string) {
  const el = AfterDarkPairLayout({ children: THE_PAGE, params: Promise.resolve({ a, b }) }) as ReactElement<{ children: [Early, ReactNode] }>;
  const [early, page] = el.props.children;
  expect(early.type).toBe(NotFoundBeforeLoading);
  expect(page).toBe(THE_PAGE);
  return { there: () => early.props.known(), answer: () => NotFoundBeforeLoading(early.props) };
}
const scenes = async () => Number((await t.db.query<{ n: number }>(`select count(*)::int as n from adult_scenes`)).rows[0].n);

async function admin(): Promise<string> {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return id;
}

async function ownCharacter(ownerId: string, name = "Lexi"): Promise<string> {
  const id = `own-${crypto.randomUUID().slice(0, 8)}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns) values ($1, $2, false, $3, 26, 'Bakes.', '["warm"]'::jsonb, 'x', 'x', 'she/her')`,
    [id, ownerId, name],
  );
  return id;
}

describe("a pair's page, before its loading screen", () => {
  it("is a real 404 signed out, or for someone After Dark isn't open to", async () => {
    as(null);
    expect(await layout(H0, H1).there()).toBe(false);
    await expect(layout(H0, H1).answer()).rejects.toThrow(NOT_FOUND);
    as(userIdOf(newUserCookie()));
    expect(await layout(H0, H1).there()).toBe(false);
    await expect(layout(H0, H1).answer()).rejects.toThrow(NOT_FOUND);
  });

  it("is a real 404 for an id that isn't a character, one twice, or another person's character", async () => {
    const me = await admin();
    as(me);
    for (const [a, b] of [
      [H0, "house-nobody"],
      ["nobody-x", "nobody-y"],
      [H0, H0],
    ]) {
      expect(await layout(a, b).there()).toBe(false);
      await expect(layout(a, b).answer()).rejects.toThrow(NOT_FOUND);
    }
    const theirs = await ownCharacter(await admin(), "Mara");
    expect(await layout(H0, theirs).there()).toBe(false);
  });

  it("lets the page open a pair they can play, without opening the night itself", async () => {
    const me = await admin();
    as(me);
    expect(await layout(H1, H0).there()).toBe(true);
    expect(await layout(H1, H0).answer()).toBeNull();
    expect(await scenes()).toBe(0);
  });

  it("lets the page explain a pair they can't have now: one of their own switched out", async () => {
    const me = await admin();
    as(me);
    const mine = await ownCharacter(me);
    await setAdultSwitch(t.db, me, mine, true);
    expect(await layout(H0, mine).there()).toBe(true);
    await setAdultSwitch(t.db, me, mine, false);
    expect(await layout(H0, mine).there()).toBe(true);
  });

  it("skips Next's own requests (a prefetch, an in-app move): the page's own not-found answers there", async () => {
    as(null);
    jar.headers = new Headers({ rsc: "1" });
    expect(await layout("nobody-x", "nobody-y").answer()).toBeNull();
  });
});
