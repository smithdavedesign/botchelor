// "Up next" at the end of an episode (the 2026-11-22 audit: an episode ended on "You didn't guess this one." and "You
// didn't predict this one.", then the footer, and the only ways on were "More episodes" and "Previously on"). The couple's
// next date first, then the newest other dates, in one cheap read; the theater's ending offers the first; and the guess
// results are only for those who played.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined), has: (name: string) => jar.cookies.has(name), getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TheaterUpNext, { AUTOPLAY_SECONDS, UP_NEXT_AFTER_MS } from "@/app/episodes/[id]/TheaterUpNext";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { UP_NEXT_LIMIT, upNextFor } from "@/lib/up-next";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const partner = HOUSE_CHARACTERS[0].id;

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

async function someone(name: string) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name }), owner)).json()).id as string;
  return { owner, character };
}

/** A date between `character` and the house partner, aired publicly `hoursAgo`. */
async function aired(who: { owner: string; character: string }, hoursAgo: number) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: who.character, partner_id: partner }, who.owner);
  expect(res.status).toBe(200);
  const id = (await res.json()).id as string;
  expect((await api.reveal(id, who.owner)).status).toBeLessThan(300);
  await t.db.query(`update episodes set visibility = 'public', revealed_at = now() - make_interval(hours => $2::int) where id = $1`, [id, hoursAgo]);
  return id;
}

const page = async (id: string, cookie: string | null = null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
  const { default: EpisodePage } = await import("@/app/episodes/[id]/page");
  return renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })).replace(/<!-- -->/g, "");
};

describe("what's up next after a date", () => {
  it("is the couple's next date first, then the newest others: one table a night, nothing private, never the viewer's own", async () => {
    const lexi = await someone("Lexi Marlowe");
    const first = await aired(lexi, 6);
    const second = await aired(lexi, 5);
    const bo = await someone("Bo Tanner");
    const bos = await aired(bo, 4);
    const cy = await someone("Cy Lund");
    const table1 = await aired(cy, 3);
    const di = await someone("Di Ames");
    const table2 = await aired(di, 2);
    await t.db.query(`update episodes set group_id = 'night-1' where id = any($1::text[])`, [[table1, table2]]);
    const ed = await someone("Ed Pryor");
    const offline = await aired(ed, 1);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [offline]);

    const afterFirst = await upNextFor(t.db, first, null);
    expect(afterFirst.map((e) => e.id)).toEqual([second, table2, bos]);
    expect(afterFirst.map((e) => e.next_of_couple)).toEqual([true, false, false]);
    expect(afterFirst[0]).toMatchObject({ share_path: `/episodes/${second}`, revealed: true });
    expect(afterFirst[0].characters.map((c) => c.id).sort()).toEqual([lexi.character, partner].sort());
    // A card never carries the ending.
    expect(JSON.stringify(afterFirst)).not.toMatch(/"ending/);

    // Their latest date: nothing of theirs comes next, and their earlier date isn't offered as "next" either.
    expect((await upNextFor(t.db, second, null)).map((e) => e.id)).toEqual([table2, bos]);
    // The viewer's own dates are on their account page: the night's other table stands in for theirs.
    expect((await upNextFor(t.db, bos, userIdOf(di.owner))).map((e) => e.id)).toEqual([table1, second, first]);
    // A mixer table isn't followed by another table of its night (the page links the whole night).
    expect((await upNextFor(t.db, table1, null)).map((e) => e.id)).toEqual([bos, second, first]);
    expect(UP_NEXT_LIMIT).toBe(3);
  }, 60_000);

  it("closes the episode page as title cards, and the guess results are only for those who played", async () => {
    const lexi = await someone("Lexi Marlowe");
    const first = await aired(lexi, 3);
    const second = await aired(lexi, 2);
    const bo = await someone("Bo Tanner");
    await aired(bo, 1);

    const html = await page(first);
    const block = html.slice(html.indexOf('<section class="episode-up-next"'));
    expect(block).toContain('<h2 id="up-next-head">Up next</h2>');
    expect(block).toContain('aria-label="Up next"');
    expect(block).toContain(`href="/episodes/${second}?play=1"`);
    expect(block).toContain("Their next date first, then the latest from the show.");
    expect(block.match(/class="episode-shelf-card tap-card"/g)).toHaveLength(2);
    // It ends the date's column: after the results, before the rail.
    expect(html.indexOf('<section class="episode-up-next"')).toBeLessThan(html.indexOf('class="episode-rail"'));

    // Someone who never played: no "You didn't…", the dealbreaker said once, plainly.
    expect(html).not.toContain("You didn&#x27;t");
    expect(html).not.toContain("You didn't");
    const said = html.match(/real dealbreaker/g) ?? [];
    expect(said.length).toBeLessThanOrEqual(1);
    if (said.length) expect(html).toMatch(/Lexi Marlowe&#x27;s real dealbreaker: <strong>/);

    // Someone who called the ending sees their result, once.
    const caller = newUserCookie();
    await t.db.query(`insert into predictions (episode_id, user_id, pick) values ($1, $2, 'friends')`, [first, userIdOf(caller)]);
    const theirs = await page(first, caller);
    expect(theirs.match(/You picked Just friends/g)).toHaveLength(1);
    expect(theirs).not.toContain("You didn&#x27;t");
  }, 60_000);
});

describe("Up next on the theater's ending", () => {
  const next = {
    href: "/episodes/e2?play=1",
    characters: [
      { id: "house-nell", name: "Nell Abiodun", house: true, hue: 30, portrait: null },
      { id: "house-rafe", name: "Rafe Okafor", house: true, hue: 200, portrait: null },
    ] as [never, never],
  };

  it("waits behind the ending, so the show's daily clip (three seconds past the ending) still ends on the ending alone", () => {
    expect(renderToStaticMarkup(createElement(TheaterUpNext, { next }))).toBe("<div></div>");
    const clip = src("scripts/clips/daily-clip.mjs");
    const hold = clip.match(/locator\("\.theater-verdict"\)\.waitFor\([^)]*\)[^;]*;\s*await page\.waitForTimeout\(([\d_]+)\)/);
    expect(hold, "the clip's hold after the ending").not.toBeNull();
    expect(Number(hold![1].replace(/_/g, ""))).toBeLessThan(UP_NEXT_AFTER_MS);
  });

  it("is a clear Next episode button with a countdown that shows, cancels, pauses while hidden and stops on any input", () => {
    const theater = src("app/episodes/[id]/TheaterUpNext.tsx");
    expect(AUTOPLAY_SECONDS).toBeGreaterThanOrEqual(5);
    expect(theater).toContain("▶ Next episode");
    expect(theater).toContain("Plays in {left} s");
    expect(theater).toContain('onClick={() => setStopped(true)}');
    expect(theater).toContain('const events = ["pointerdown", "keydown", "wheel"] as const;');
    expect(theater).toContain('if (document.visibilityState === "visible") setLeft((n) => Math.max(0, n - 1));');
    expect(theater).toContain("router.push(next.href);");
    // Offered only on a viewer's ending, after the share and the report card; the creator's verdict card is unchanged.
    const ending = src("app/episodes/[id]/EpisodeTheater.tsx");
    expect(ending).toMatch(/📝 See its report card[\s\S]{0,200}\{upNext && <TheaterUpNext next=\{upNext\} \/>\}/);
    expect(src("app/episodes/[id]/VerdictCard.tsx")).not.toContain("TheaterUpNext");
    expect(src("app/episodes/[id]/page.tsx")).toContain("upNext={next[0] ? { href: `${next[0].share_path}?play=1`, characters: next[0].characters } : null}");
  });
});
