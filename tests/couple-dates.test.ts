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
import { HOUSE_CHARACTERS } from "@/lib/house";
import { venueBackdrop } from "@/lib/portraits";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

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
  });
});
