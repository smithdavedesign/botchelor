import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The chapter reader (lib/adult/rollout.ts reader; the design kit's NightReader, admins only until it's opened): a
// pair's chapters, grouped by night, the picked one at reading size, at ?view=reader on the night page.
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
import AfterDarkScenePage from "@/app/after-dark/[a]/[b]/page";
import Reader from "@/app/after-dark/[a]/[b]/Reader";
import { POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import type { AdultNight } from "@/lib/adult/scenes";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

const night = (id: string, chapter: number | null, at: string, lines: AdultNight["lines"], place: string | null = null): AdultNight => ({
  id,
  lines,
  place,
  stage: 0,
  date_setting: null,
  date_venue: null,
  set_place: null,
  chapter,
  created_at: at,
});
const say = (who: "a" | "b", text: string) => ({ who, text });
const names = { a: "Ada Vale", b: "Bo Reyes" };
const base = "/after-dark/x/y";
const read = (props: Partial<Parameters<typeof Reader>[0]>) => renderToStaticMarkup(createElement(Reader, { names, base, now: null, saved: [], pick: null, ...props }));

describe("the reader", () => {
  // Two nights: an old one-chapter night, then a night of two chapters that's still running (the scene is on chapter 3).
  const saved = [
    night("n2c2", 2, "2026-11-02T10:00:00Z", [say("b", "Stay.")], "the roof"),
    night("n2c1", 1, "2026-11-02T09:00:00Z", [say("a", "Here again?"), say("b", "*laughs* Always.")], "the bar"),
    night("n1", 1, "2026-11-01T09:00:00Z", [say("a", "Hello.")]),
  ];

  it("lists every chapter under its night, newest night first, and opens on the newest chapter", () => {
    const html = read({ saved, now: { chapter: 3, lines: [say("a", "*kisses her* Now.")], place: "the hotel" } });
    expect(html.indexOf("Night 2 · tonight")).toBeGreaterThan(-1);
    expect(html.indexOf("Night 2 · tonight")).toBeLessThan(html.indexOf("Night 1"));
    expect(html).toContain(`href="${base}?view=reader&amp;chapter=n2c1"`);
    expect(html).toContain(`href="${base}?view=reader&amp;chapter=now"`);
    // Tonight's chapter so far is the one shown, its actions as stage directions, a speaker's first name.
    expect(html).toContain('aria-label="Chapter 3, night 2"');
    expect(html).toContain('<strong>Ada</strong> <em class="ad-reader-action">kisses her</em> Now.');
    expect(html).toContain("written in the theater, as it plays");
  });

  it("opens the chapter picked, and a pick that isn't theirs falls back to the newest", () => {
    const html = read({ saved, pick: "n2c1" });
    expect(html).toContain('aria-label="Chapter 1, night 2"');
    expect(html).toContain("Night 2 · Chapter 1 · the bar");
    expect(html).toContain("<strong>Bo</strong> <em class=\"ad-reader-action\">laughs</em> Always.");
    expect(html).toMatch(/aria-current="page"[^>]*>|href="[^"]*n2c1" aria-current="page"/);
    expect(read({ saved, pick: "someone-else" })).toContain('aria-label="Chapter 2, night 2"');
  });

  it("says so when there's nothing written yet, and keeps the way back to the theater", () => {
    const html = read({ now: { chapter: 1, lines: [], place: null } });
    expect(html).toContain("Nothing written yet");
    expect(html).toContain("No chapter to read yet.");
    expect(html).toContain(`href="${base}"`);
    expect(html).toContain(`href="${base}?tab=gallery"`);
  });
});

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
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([H0, H1]);
  setAdultModelForTests({ complete: async () => JSON.stringify({ lines: [say("a", "*smiles* You came."), say("b", "I said I would.")] }) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
});

const [H0, H1] = HOUSE_CHARACTERS.slice(0, 2).map((c) => c.id);
const [A, B] = H0 < H1 ? [H0, H1] : [H1, H0];

function as(id: string) {
  const c = signedInCookie(id);
  jar.cookies.clear();
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return c.split(";")[0];
}
async function play(id: string) {
  const cookie = as(id);
  const res = await POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: A, b: B }) }));
  expect(res.status).toBe(200);
}
const page = async (sp: Record<string, string>) => renderToStaticMarkup(await AfterDarkScenePage({ params: Promise.resolve({ a: A, b: B }), searchParams: Promise.resolve(sp) }));

describe("the reader on the night page", () => {
  it("an admin has 📖 Read it, and ?view=reader opens it on tonight's chapter and a saved one", async () => {
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    await play(admin);
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, chapter, created_at) values ($1, $2, $3, $4, $5, 1, now() - interval '1 day')`, [
      "saved-1",
      admin,
      A,
      B,
      JSON.stringify([say("b", "A night before.")]),
    ]);
    const theater = await page({});
    expect(theater).toContain("data-read-it");
    expect(theater).not.toContain("data-reader");
    const reader = await page({ view: "reader" });
    expect(reader).toContain("data-reader");
    expect(reader).toContain("You came.");
    expect(reader).not.toContain("data-read-it");
    expect(await page({ view: "reader", chapter: "saved-1" })).toContain("A night before.");
  });

  it("someone else with After Dark gets the theater at ?view=reader until the reader is opened to everyone", async () => {
    const sub = randomUUID();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    as(sub);
    expect(await page({})).toContain("Their night");
    expect(await page({})).not.toContain("data-read-it");
    expect(await page({ view: "reader" })).not.toContain("data-reader");
    await saveAdultSettings(t.db, { rollout: { reader: "everyone" } });
    expect(await page({})).toContain("data-read-it");
    expect(await page({ view: "reader" })).toContain("data-reader");
  });
});
