import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #1176 (the 2026-10-31 After Dark visitor: a character made on the show starts Out, and "her toggle was buried under
// 'Your settings · who's in (3)' … which is collapsed"): the show's finish screen links here with ?bring=, which puts that
// character's switch first; and the settings open while one of theirs is Out. Out stays the default (each one's consent).
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
import { renderToStaticMarkup } from "react-dom/server";
import AfterDarkHome from "@/app/after-dark/page";
import { claimAdmin } from "@/lib/admins";
import { setAdultSwitch } from "@/lib/adult/characters";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.unstubAllEnvs();
});

async function me() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  const ines = randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values ($1, $2, false, 'Ines Valdecasas-Rook', 31, 'Restores clocks.', '["dry"]'::jsonb, 'x', 'x')`,
    [ines, id],
  );
  return { id, ines };
}
const home = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await AfterDarkHome({ searchParams: Promise.resolve(sp) }));

describe("#1176: bringing a new character into After Dark", () => {
  it("?bring= puts their switch first, Out, saying it's theirs to switch", async () => {
    const { ines } = await me();
    const html = await home({ bring: ines });
    expect(html).toMatch(new RegExp(`data-bring="${ines}"[\\s\\S]*<h2>Bring Ines Valdecasas-Rook into After Dark</h2>`));
    expect(html).toContain("Characters start Out: nothing of theirs comes here until you switch them In.");
    expect(html.indexOf("data-bring=")).toBeLessThan(html.indexOf("<h2>Scenes</h2>"));
  });

  it("once in, it says so and where to go next", async () => {
    const { id, ines } = await me();
    await setAdultSwitch(t.db, id, ines, true);
    const html = await home({ bring: ines });
    expect(html).toContain(`<h2>Ines Valdecasas-Rook is in</h2>`);
    expect(html).toContain("Pick them a scene below");
  });

  it("someone else's character, or a house one, gets no card", async () => {
    await me();
    expect(await home({ bring: randomUUID() })).not.toContain("data-bring=");
    expect(await home({ bring: HOUSE_CHARACTERS[0].id })).not.toContain("data-bring=");
  });

  it("the settings open while one of theirs is Out, and stay folded once all are in", async () => {
    const { id, ines } = await me();
    expect(await home()).toMatch(/<details class="card ad-hub-settings" open="">/);
    await setAdultSwitch(t.db, id, ines, true);
    expect(await home()).toMatch(/<details class="card ad-hub-settings">/);
  });
});
