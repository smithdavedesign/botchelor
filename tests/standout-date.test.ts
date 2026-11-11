// The home hero and the 18+ gate show the best moment of a well-rated date (2026-11-11 bounce review, David: "yes do
// 1-4"): the newest aired date's opening (a spatula and a tea urn) was hard to follow cold.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import type { Turn } from "@/lib/conversation";
import { momentLines, pickFeaturedDate } from "@/lib/featured-date";
import type { CharacterRef, EpisodeView } from "@/lib/game";
import { listStandoutDates } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const turn = (side: "a" | "b", dialogue: string): Turn => ({ side, act: 0, dialogue, action: "", emotion: "warm", interest: 0.5 });
// Eight spoken lines; the best one is the fourth, well before the last quarter.
const LINES: Turn[] = [
  turn("a", "Is that a spatula in your coat?"),
  turn("b", "It's for the tea urn. Long story."),
  turn("a", "I have time. The urn doesn't, by the look of it."),
  turn("b", "You ask like someone who actually wants the answer."),
  turn("a", "I do. Most people only want their turn to talk."),
  turn("b", "Then you can have the long version."),
  turn("a", "Good. Start with the spatula."),
  turn("b", "Fine. It begins with a bet I lost."),
];
const BEST = "You ask like someone who actually wants the answer.";

describe("the moment around a date's best line", () => {
  it("is the line before it, the best line and what follows", () => {
    const lines = momentLines(LINES, BEST, 4);
    expect(lines?.map((l) => l.text)).toEqual([LINES[2].dialogue, BEST, LINES[4].dialogue, LINES[5].dialogue]);
    expect(lines?.map((l) => l.side)).toEqual(["a", "b", "a", "b"]);
  });

  it("matches the best line inside a longer turn, and keeps it whole when the turn is clipped", () => {
    const long = [...LINES];
    long[3] = turn("b", `${"Well, honestly, and I mean this kindly, ".repeat(5)}${BEST}`);
    const lines = momentLines(long, BEST, 4, 120);
    expect(lines?.[1].text).toBe(BEST);
  });

  it("is never near the ending, and is null when the line isn't there", () => {
    expect(momentLines(LINES, LINES[7].dialogue, 4)).toBeNull(); // the last quarter would give the ending away
    expect(momentLines(LINES, "Not something anyone said.", 4)).toBeNull();
    expect(momentLines(LINES, null, 4)).toBeNull();
  });
});

describe("picking the best-rated date", () => {
  const char = (id: string, extra: Partial<CharacterRef> = {}): CharacterRef => ({ id, name: `Name ${id}`, house: true, hue: 10, portrait: null, ...extra });
  const ep = (id: string, extra: Partial<EpisodeView> = {}): EpisodeView =>
    ({
      id,
      share_path: `/episodes/${id}`,
      revealed: true,
      visibility: "public",
      hidden: false,
      characters: [char(`${id}a`), char(`${id}b`)],
      transcript: LINES,
      best_line: BEST,
      setting: "A café.",
      title: "The Urn",
      aired_at: "2026-11-05T20:00:00.000Z",
      ...extra,
    }) as unknown as EpisodeView;

  it("takes the ranked list's first date with two faces and a moment, and shows that moment", () => {
    const faces = ep("faces", { characters: [char("fa", { portrait: "/a.png" }), char("fb", { portrait: "/b.png" })] });
    const pick = pickFeaturedDate([ep("top"), faces], undefined, { best: true });
    expect(pick?.episode_id).toBe("faces");
    expect(pick?.from).toBe("moment");
    expect(pick?.lines[1].text).toBe(BEST);
    // No date with a moment: the first ranked one, from its opening.
    const plain = pickFeaturedDate([ep("nomoment", { best_line: undefined })], undefined, { best: true });
    expect(plain?.from).toBe("opening");
    expect(plain?.lines[0].text).toBe(LINES[0].dialogue);
    // Watch's lead is unchanged: the opening of the newest.
    expect(pickFeaturedDate([ep("newest")])?.from).toBe("opening");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
});

async function airedDate(name: string, ending: "second_date" | "disaster", chemistry: number) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name }), owner)).json()).id;
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  await t.db.query(
    `update episodes set transcript = $2::jsonb, visibility = 'public', best_line = $3, ending = $4,
            box_score = jsonb_set(coalesce(box_score, '{}'::jsonb), '{chemistry}', jsonb_build_object('start', 50, 'delta', $5::int - 50, 'final', $5::int))
      where id = $1`,
    [ep.id, JSON.stringify(LINES), BEST, ending, chemistry],
  );
  return ep.id as string;
}

describe("the home hero and the gate lead with the week's best-rated date", () => {
  it("ranks by chemistry and a second date over newness, and the hero plays its best moment", async () => {
    const good = await airedDate("Pell Ardent", "second_date", 82);
    const flat = await airedDate("Rook Hallow", "disaster", 40); // newer, but flat
    await t.db.query(`update episodes set revealed_at = now() - interval '1 hour' where id = $1`, [good]);
    await t.db.query(`update episodes set revealed_at = now() - interval '5 minutes' where id = $1`, [flat]);
    // Older than the week: out.
    const old = await airedDate("Sable Vane", "second_date", 99);
    await t.db.query(`update episodes set revealed_at = now() - interval '9 days' where id = $1`, [old]);

    const ranked = await listStandoutDates(t.db, null);
    expect(ranked.map((e) => e.id)).toEqual([good, flat]);

    const Home = (await import("@/app/page")).default;
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('aria-label="A moment from the date"');
    expect(html).toContain(BEST);
    expect(html).toContain(`href="/episodes/${good}?play=1"`);

    const GatePage = (await import("@/app/gate/page")).default;
    const gate = renderToStaticMarkup(await GatePage({ searchParams: Promise.resolve({ from: "/" }) }));
    expect(gate).toContain(BEST);
  });
});
