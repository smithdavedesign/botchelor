// Their dates on a couple page as the design system draws them (all-screens board, 2026-11-11): one row a date with the
// place's photo, the date and when, where, and how it ended.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined), has: (name: string) => jar.cookies.has(name), getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { prerender } from "react-dom/static";
import { setDbForTests, type Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { venueBackdrop } from "@/lib/portraits";
import { upsertTie } from "@/lib/social/ties";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
let owner = "";
let character = "";
let episode = "";
const partner = HOUSE_CHARACTERS[0].id;

beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  owner = newUserCookie();
  character = (await (await api.createCharacter(validCharacter({ name: "Row Tester", open_to_dates: true }), owner)).json()).id;
  scriptOutcome({ ending: "second_date", sides: [side(), side()] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: character, partner_id: partner }, owner);
  expect(res.status).toBe(200);
  episode = (await res.json()).id;
  expect((await api.reveal(episode, owner)).status).toBeLessThan(300);
}, 60_000);
afterAll(async () => {
  await t.close();
});

function side() {
  return { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null };
}

describe("a couple's dates", () => {
  it("are rows with the place's photo, the date's link, where and how it ended", async () => {
    jar.cookies.clear();
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const { default: CouplePage } = await import("@/app/couples/[a]/[b]/page");
    // The page has async parts (they suspend): rendered to the end, as the server streams it.
    const { prelude } = await prerender(await CouplePage({ params: Promise.resolve({ a: character, b: partner }), searchParams: Promise.resolve({}) }));
    const html = await new Response(prelude).text();
    const list = html.slice(html.indexOf('<ol class="couple-dates"'), html.indexOf("</ol>", html.indexOf('<ol class="couple-dates"')));
    expect(list).toContain('<li class="couple-date">');
    expect(list).toContain('class="venue-photo couple-date-photo"');
    expect(list.replace(/<!-- -->/g, "")).toContain(`href="/episodes/${episode}">Date 1</a>`);
    expect(list).toMatch(/<p class="couple-date-venue">[^<]+<\/p>/);
    expect(list).toMatch(/<span class="badge couple-date-ending">[^<]+<\/span>/);
    const { rows } = await t.db.query<{ venue: string | null }>(`select setup->>'venue' as venue from episodes where id = $1`, [episode]);
    const photo = venueBackdrop(rows[0].venue);
    if (photo) expect(list).toContain(`src="${photo}"`);
    expect(html).not.toContain("couple-timeline");
    // Under the stage, one line on what made it so (lib/relationship-stages.ts).
    expect(html).toContain('<p class="ending">✨ Sparks</p><p class="muted small couple-stage-line">Their last date ended with both wanting another.</p>');
  });

  it("are followed by everything else between them, and nothing when their dates are all there is", async () => {
    jar.cookies.clear();
    const { default: CouplePage } = await import("@/app/couples/[a]/[b]/page");
    const page = async () => {
      const { prelude } = await prerender(await CouplePage({ params: Promise.resolve({ a: character, b: partner }), searchParams: Promise.resolve({}) }));
      return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
    };
    // Their dates are above, so the tie that says they dated isn't said again.
    expect(await page()).not.toContain("Everything between them");
    const w = await upsertTie(t.db, { from: character, to: partner, kind: "coworker", source: "owner", evidence: { ref: `episode:${episode}` } });
    expect(w.ok).toBe(true);
    const html = await page();
    expect(html).toContain("Everything between them");
    expect(html).toContain("coworkers");
    expect(html).toContain(`href="/episodes/${episode}">the date</a>`);
    expect(html).not.toContain("dated on the show");
  });

  it("leave out a part whose read fails, and the title goes without their names, rather than the page failing (#1948)", async () => {
    jar.cookies.clear();
    const { default: CouplePage, generateMetadata } = await import("@/app/couples/[a]/[b]/page");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = () => Promise.reject(new Error("timeout exceeded when trying to connect"));
    try {
      // The pool too busy for everything between them: the rest of the page draws, and that section says it didn't load.
      setDbForTests({ query: (sql: string, params?: unknown[]) => (/social_ties/.test(sql) ? busy() : t.db.query(sql, params)), exec: (sql: string) => t.db.exec(sql) } as Db);
      const { prelude } = await prerender(await CouplePage({ params: Promise.resolve({ a: character, b: partner }), searchParams: Promise.resolve({}) }));
      const html = (await new Response(prelude).text()).replace(/<!-- -->/g, "");
      expect(html).toContain('<ol class="couple-dates"');
      expect(html).toContain("Everything between them");
      expect(html).toContain("This didn&#x27;t load just now. Reload the page to try again.");
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("[couple page] everything between them didn't load: timeout exceeded"));

      // Too busy for the title's names: the page is titled without them, never an error.
      setDbForTests({ query: busy, exec: async () => {} } as Db);
      const [lo, hi] = pairKey(character, partner);
      expect(await generateMetadata({ params: Promise.resolve({ a: character, b: partner }) })).toEqual({
        title: "Their blind dates and how it's going · Botchelor",
        alternates: { canonical: `/couples/${lo}/${hi}` },
      });
    } finally {
      setDbForTests(t.db);
      logged.mockRestore();
    }
  });
});

describe("a couple page's head", () => {
  it("keeps the page out of search with a private character or a deleted account's on it (2026-11-21), or one date so far", async () => {
    const { generateMetadata } = await import("@/app/couples/[a]/[b]/page");
    const robots = async () => (await generateMetadata({ params: Promise.resolve({ a: character, b: partner }) })).robots;
    // One date: the page mostly repeats it, so it's out of search as it's out of the sitemap (lib/seo.ts coupleIndexable).
    expect(await robots()).toEqual({ index: false, follow: true });
    const [lo, hi] = pairKey(character, partner);
    await t.db.query(`update relationships set public_dates = 2 where character_a = $1 and character_b = $2`, [lo, hi]);
    expect(await robots()).toBeUndefined();
    try {
      await t.db.query(`update characters set visibility = 'private' where id = $1`, [character]);
      expect(await robots()).toEqual({ index: false, follow: true });
      await t.db.query(`update characters set visibility = 'public', owner_id = 'deleted' where id = $1`, [character]);
      expect(await robots()).toEqual({ index: false, follow: true });
    } finally {
      await t.db.query(`update characters set visibility = 'public', owner_id = $2 where id = $1`, [character, userIdOf(owner)]);
      await t.db.query(`update relationships set public_dates = 1 where character_a = $1 and character_b = $2`, [lo, hi]);
    }
  });
});
