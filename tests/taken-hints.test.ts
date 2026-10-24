import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The builder reads the viewer from next/headers: hand it this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import CreatePage from "@/app/create/page";
import { registerAccount } from "@/lib/auth";
import { ctaMine } from "@/lib/date-cta";
import { nextDate } from "@/lib/date-proposals";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { settleCommitment, takenWith } from "@/lib/partners";
import { takenNote } from "@/lib/partners-shared";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { secondDateState } from "@/lib/second-date";
import { api, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// David, 2026-10-24: one of yours that's with someone and wants one partner (lib/partners.ts takenWith) is shown as
// taken wherever a date is offered, instead of offering dates the booking refuses ("I said go on a blind date, but they
// chose someone who couldn't").

const U = "eeee5555-0000-4000-8000-000000000005";
const DEX = HOUSE_CHARACTERS.find((c) => c.name.startsWith("Dex"))!;
const JUNIPER = HOUSE_CHARACTERS.find((c) => c.name.startsWith("Juniper"))!;

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
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  await registerAccount(t.db, U, "takenhints", ["a", "good", "password"].join("-"));
  setSeasonCastForTests([DEX.id, JUNIPER.id]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

/** Lexi, one of U's, wanting one partner and dating Dex (a house character): taken. */
async function lexiWithDex() {
  const cookie = signedInCookie(U);
  const [name, value] = cookie.split("=");
  jar.cookies.set(name, value);
  const lexi = (await (await api.createCharacter(validCharacter({ name: "Lexi Marsh" }), cookie)).json()) as { id: string };
  expect((await api.editCharacter(lexi.id, { partner_style: "one" }, cookie)).status).toBe(200);
  const [lo, hi] = [lexi.id, DEX.id].sort();
  await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, 'dating')`, [lo, hi]);
  await settleCommitment(t.db, lo, hi);
  expect((await takenWith(t.db, [lexi.id])).get(lexi.id)?.[0]?.name).toBe(DEX.name);
  return { lexi, cookie };
}

describe("one of yours that's taken", () => {
  it("the builder's date step says so, offers the date with their partner, and shows the rest (blind date too) closed", async () => {
    const { lexi } = await lexiWithDex();
    const html = renderToStaticMarkup(await CreatePage({ searchParams: Promise.resolve({ character: lexi.id }) }));
    expect(html).toContain("💍 With Dex");
    expect(html).toContain(takenNote("Lexi", DEX.name).replace(/'/g, "&#x27;").replace(/“/g, "“"));
    expect(html).toContain(`Send Lexi on a date with Dex`);
    expect(html).toContain(`href="/characters/${lexi.id}#partners-${lexi.id}"`);
    // The blind date and Juniper's date are closed; Dex's row is marked as the partner and stays open.
    expect(html).toMatch(/disabled=""[^>]*>Send Lexi Marsh on a blind date/);
    expect(html).toMatch(/aria-label="Send on a date with Juniper" disabled=""/);
    expect(html).not.toMatch(/aria-label="Send on a date with Dex" disabled=""/);
    expect(html).toContain("💞 Lexi&#x27;s partner");
  });

  it("isn't marked when they're free: the builder's date step as before", async () => {
    const cookie = signedInCookie(U);
    const [name, value] = cookie.split("=");
    jar.cookies.set(name, value);
    const free = (await (await api.createCharacter(validCharacter({ name: "Mira Holt" }), cookie)).json()) as { id: string };
    const html = renderToStaticMarkup(await CreatePage({ searchParams: Promise.resolve({ character: free.id }) }));
    expect(html).not.toContain("💍");
    expect(html).not.toMatch(/disabled=""[^>]*>Send Mira Holt on a blind date/);
  });

  it("a character page's 'send one of yours' marks them, except for a date with their own partner", async () => {
    const { lexi } = await lexiWithDex();
    expect(await ctaMine(t.db, U, { id: JUNIPER.id, house: true })).toEqual([{ id: lexi.id, name: "Lexi Marsh", mode: "book", taken: DEX.name }]);
    expect(await ctaMine(t.db, U, { id: DEX.id, house: true })).toEqual([{ id: lexi.id, name: "Lexi Marsh", mode: "book", taken: null }]);
  });

  it("a couple page's next date and a date's second-date offer say so, with where to change it", async () => {
    const { lexi } = await lexiWithDex();
    const next = await nextDate(t.db, U, lexi.id, JUNIPER.id, null, []);
    expect(next?.option).toMatchObject({ kind: "unavailable", taken: { id: lexi.id, partner: { id: DEX.id, name: DEX.name } } });
    expect(next?.option.kind === "unavailable" && next.option.message).toBe(takenNote("Lexi", DEX.name));
    // With their partner it's open as ever.
    expect((await nextDate(t.db, U, lexi.id, DEX.id, null, []))?.option.kind).not.toBe("unavailable");
    // A first date with Juniper that both want to follow up: the second date is closed while Lexi only dates Dex.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility, sides)
       values ('ep-lexi-juniper', $1, $2, $3, 'the pier', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'public', $4::jsonb)`,
      [U, lexi.id, JUNIPER.id, JSON.stringify([{ wants_another: true }, { wants_another: true }])],
    );
    const state = await secondDateState(t.db, "ep-lexi-juniper", U);
    expect(state).toMatchObject({ mutual: true, can_plan: false, reason: "taken", taken_with: DEX.name, my_character_name: "Lexi Marsh" });
  });
});
