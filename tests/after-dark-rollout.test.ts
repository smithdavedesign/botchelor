import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// What of After Dark is built but not open yet (David, 2026-11-13: "keep it admin only but build it anyway and we can
// switch it from admin only later"): the switches, and the public door they hold back (lib/adult/door.ts).
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark",
}));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import AfterDarkHome from "@/app/after-dark/page";
import AfterDarkSubscribe from "@/app/after-dark/subscribe/page";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { claimAdmin } from "@/lib/admins";
import { afterDarkDoor, publicDoorOpen } from "@/lib/adult/door";
import { mergeRolloutConfig, rolloutConfigOf, rolloutOn } from "@/lib/adult/rollout";
import { getAdultSettings, saveAdultSettings } from "@/lib/adult/settings";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setPlaceForTests({ country: "NL", region: null });
});
afterEach(() => {
  setPlaceForTests(null);
  vi.unstubAllEnvs();
});

function signIn(id: string) {
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return c.split(";")[0];
}
const digest = async (p: Promise<unknown>) => {
  try {
    await p;
    return "rendered";
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  }
};
const html = async (el: ReactElement) => new Response((await prerender(el)).prelude).text();
const open = (piece: string) => saveAdultSettings(t.db, { rollout: { [piece]: "everyone" } });

describe("the switches", () => {
  it("start on admins only, take everyone, and refuse anything else", async () => {
    expect(rolloutConfigOf(null)).toEqual({ public_door: "admins", make_more: "admins", phone_sheet: "admins", reader: "admins" });
    expect(rolloutConfigOf({ reader: "nonsense" }).reader).toBe("admins");
    expect(mergeRolloutConfig(rolloutConfigOf(null), { reader: "everyone" }).reader).toBe("everyone");
    expect(() => mergeRolloutConfig(rolloutConfigOf(null), { reader: "some" })).toThrow();
    expect(() => mergeRolloutConfig(rolloutConfigOf(null), { gallery: "everyone" })).toThrow(/gallery/);
    expect(rolloutOn(rolloutConfigOf(null), "reader", true)).toBe(true);
    expect(rolloutOn(rolloutConfigOf(null), "reader", false)).toBe(false);
    expect(rolloutOn(rolloutConfigOf({ reader: "everyone" }), "reader", false)).toBe(true);
  });

  it("are saved by an admin on the settings page, one at a time", async () => {
    const admin = randomUUID();
    await claimAdmin(t.db, admin);
    const cookie = signIn(admin);
    const post = (body: object) => settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    expect((await post({ rollout: { make_more: "everyone" } })).status).toBe(200);
    expect((await getAdultSettings(t.db)).rollout).toMatchObject({ make_more: "everyone", reader: "admins" });
    const bad = await post({ rollout: { make_more: "half" } });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { message: string }).message).toMatch(/^Not open yet/);
    expect((await getAdultSettings(t.db)).rollout.make_more).toBe("everyone");
  });
});

describe("the public door", () => {
  it("on admins only: no door for a visitor or someone not in; admins get the arrival screen", async () => {
    expect(await afterDarkDoor(null, null, new Headers())).toEqual({ door: false, threshold: false });
    const someone = randomUUID();
    expect(await afterDarkDoor(t.db, { userId: someone, authenticated: true }, new Headers())).toEqual({ door: false, threshold: false });
    const admin = randomUUID();
    await claimAdmin(t.db, admin);
    expect(await afterDarkDoor(t.db, { userId: admin, authenticated: true }, new Headers())).toEqual({ door: true, threshold: true });
    expect(await publicDoorOpen()).toBe(false);
  });

  it("opened: every adult where it isn't blocked sees the door and the arrival screen; a blocked place still doesn't", async () => {
    await open("public_door");
    expect(await publicDoorOpen()).toBe(true);
    expect(await afterDarkDoor(null, null, new Headers())).toEqual({ door: true, threshold: true });
    expect(await afterDarkDoor(t.db, { userId: randomUUID(), authenticated: true }, new Headers())).toEqual({ door: true, threshold: true });
    setPlaceForTests({ country: null, region: null });
    expect((await afterDarkDoor(null, null, new Headers())).door).toBe(false);
  });

  it("After Dark's home: not found for someone not in, until the door opens; then the subscribe page", async () => {
    signIn(randomUUID());
    expect(await digest(AfterDarkHome({ searchParams: Promise.resolve({}) }))).toMatch(/404/);
    await open("public_door");
    expect(await digest(AfterDarkHome({ searchParams: Promise.resolve({}) }))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/after-dark\/subscribe;/);
  });

  it("an admin previews the landing as a visitor, or as someone signed in; without ?preview they're sent in", async () => {
    const admin = randomUUID();
    await claimAdmin(t.db, admin);
    signIn(admin);
    const page = (sp: Record<string, string>) => AfterDarkSubscribe({ searchParams: Promise.resolve(sp) });
    expect(await digest(page({}))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/after-dark;/);
    const visitor = await html(await page({ preview: "visitor" }));
    expect(visitor).toContain('data-preview="visitor"');
    expect(visitor).toContain("Sign in to start");
    const member = await html(await page({ preview: "signed-in" }));
    expect(member).toContain('data-preview="signed-in"');
    expect(member).not.toContain("Sign in to start");
    // Someone else can't preview: they just see the page as themselves.
    signIn(randomUUID());
    expect(await html(await page({ preview: "visitor" }))).not.toContain("data-preview");
  });
});
