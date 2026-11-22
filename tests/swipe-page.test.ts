import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The swipe and matches pages read the viewer from next/headers: hand them this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import MatchesPage from "@/app/matches/page";
import SwipePage from "@/app/swipe/page";
import { twinsLast } from "@/lib/twins";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, HOUSE_PARTNER_ID, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CHARACTER_COOKIE } from "@/lib/current-character";
import { pairKey } from "@/lib/relationships";

// David, 2026-10-22: the swipe page picks whose deck it is the way /matches picks whose matches, with your characters'
// faces instead of a drop-down, and a taken one (in a relationship, wanting one partner) easy to tell apart. Since
// 2026-11-18 those faces live in the header's picker (app/CharacterPicker.tsx), and the deck follows it; on a phone the
// deck's slim bar carries the same picker, since the header isn't there.
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
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.restoreAllMocks();
});

const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

async function make(name: string, cookie: string, extra: Record<string, unknown> = {}) {
  const res = await api.createCharacter(validCharacter({ name, open_to_dates: true, extras: PROFILE, ...extra }), cookie);
  return (await res.json()).id as string;
}

/** An owner with two characters, each with a dating profile: Wren, and Lexi (the newer one), who's taken by Dex. */
async function ownerWithATakenOne() {
  const owner = newUserCookie();
  const wren = await make("Wren Kestrel", owner);
  const lexi = await make("Lexi Moreau", owner);
  await t.db.query(`update characters set created_at = created_at + interval '1 minute' where id = $1`, [lexi]); // the newest: first in the row
  expect((await api.editCharacter(lexi, { partner_style: "one" }, owner)).status).toBe(200);
  const dex = await make("Dex Marlow", newUserCookie());
  const [lo, hi] = [lexi, dex].sort();
  // computed_at set, so the graph doesn't recompute this hand-made edge from (no) episodes.
  await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage, computed_at) values ($1, $2, 3, 2, 'dating', now())`, [lo, hi]);
  jar.cookies.clear();
  jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
  return { owner, wren, lexi, dex };
}

const swipePage = async (character?: string) => renderToStaticMarkup(await SwipePage({ searchParams: Promise.resolve(character ? { character } : {}) }));
/** The faces in the slim bar's picker, in order. */
const tiles = (html: string) => [...html.matchAll(/<button[^>]*class="char-picker-tile[^"]*"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
/** One face in the bar's picker, by its short name. */
const tile = (html: string, first: string) => tiles(html).find((t) => t.includes(`>${first}<`)) ?? "";

describe("the swipe page: whose deck, as faces", () => {
  it("follows the header: the bar carries the same picker, a taken one dimmed and tagged, and with nobody remembered it opens on one that can swipe", async () => {
    const { wren, lexi } = await ownerWithATakenOne();
    const html = await swipePage();
    // No character menu: the only menus are the deck's filters (app/swipe/DeckFilterForm.tsx).
    expect(html.replace(/<details class="deck-filters[\s\S]*?<\/details>/g, "")).not.toContain("<select");
    expect(html).not.toContain("character-tabs");
    // One picker, in the phone's slim bar (the header's own is the layout's); it names whose deck it is.
    expect(html.match(/class="char-picker char-picker--bar"/g)).toHaveLength(1);
    expect(html).toContain('<span class="char-picker-name">Wren</span>');
    const lexiFace = tile(html, "Lexi");
    expect(lexiFace).toContain('class="char-picker-tile is-taken"');
    expect(lexiFace).toContain('aria-label="Lexi: taken (dating Dex)"');
    expect(lexiFace).toContain(">💍 Taken<");
    // Lexi is the newer one (first among the faces), but she can't swipe: without one asked for or remembered, the
    // deck opens on Wren, and says so to the header.
    expect(tiles(html).map((t) => (t.includes(">Lexi<") ? "lexi" : "wren"))).toEqual(["lexi", "wren"]);
    expect(tile(html, "Wren")).toContain('aria-current="true"');
    expect(tile(html, "Wren")).not.toContain("Taken");
    expect(html).toMatch(/Who should <button type="button" class="heading-switch"[^>]*>Wren<\/button> meet\?/);
    expect(html).not.toContain("can&#x27;t swipe right now");
    expect(wren).not.toBe(lexi);
  });

  it("the one remembered in the header wins even when it's taken: the deck says why, and offers another", async () => {
    const { lexi } = await ownerWithATakenOne();
    jar.cookies.set(CHARACTER_COOKIE, lexi);
    const html = await swipePage();
    expect(html).toContain('<span class="char-picker-name">Lexi</span>');
    expect(html).toContain("Lexi can&#x27;t swipe right now");
    expect(html).toContain('<button type="button" class="button secondary" aria-haspopup="dialog">Swipe for another of yours</button>');
  });

  it("a card that reads like your own character says so on the web too, and twins go to the end of the page (#426 on the web)", async () => {
    const owner = newUserCookie();
    const mine = await make("Ambrose Fenn", owner, { bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping." });
    // Someone else's character made from the same words; the house cast member is the only other card, so both render.
    await make("Seraphina Fenn", newUserCookie(), { bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping." });
    jar.cookies.clear();
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const html = await swipePage(mine);
    expect(html).toContain("Seraphina Fenn");
    expect(html).toContain("Reads a lot like your own character");
    expect(html).toContain('class="swipe-twin"');
    // The order is the pure rule's (lib/twins.ts twinsLast): twins after everyone else, their line on them.
    const cards = [{ id: "a" }, { id: "twin" }, { id: "b" }, { id: "twin2" }];
    const twins = new Map([["twin", "the same bio"], ["twin2", "the same prompts"]]);
    expect(twinsLast(cards, twins).map((c) => `${c.id}${c.reads_like_yours ? "*" : ""}`)).toEqual(["a", "b", "twin*", "twin2*"]);
    expect(twinsLast(cards, new Map()).map((c) => c.id)).toEqual(["a", "twin", "b", "twin2"]);
  });

  it("a taken one stays a choice: asked for in the address, it shows why it can't swipe", async () => {
    const { lexi } = await ownerWithATakenOne();
    const html = await swipePage(lexi);
    expect(tile(html, "Lexi")).toContain('aria-current="true"');
    expect(html).toContain("Lexi can&#x27;t swipe right now");
    expect(html).toContain("Lexi is with someone and wants one partner");
  });

  it("one character: no picker, just its name", async () => {
    const owner = newUserCookie();
    await make("Wren Kestrel", owner);
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const html = await swipePage();
    expect(html).not.toContain("char-picker");
    expect(html).not.toContain("heading-switch");
    expect(html).toContain('<span class="swipe-topbar-name">Wren</span>');
    expect(html).toContain("Who should Wren meet?");
  });

  // David, 2026-11-11: new matches "didn't appear", and "Show N that didn't work out" mixed them back in with everyone
  // instead of filtering. Now two tabs, one list at a time, each pass saying whose it was, and nothing filed away unseen.
  it("/matches files the ones that didn't work out under their own tab, says why, and never before they're seen", async () => {
    const owner = newUserCookie();
    const wren = await make("Wren Kestrel", owner);
    const other = async (name: string, yes: { wren: boolean | null; them: boolean | null }) => {
      const id = await make(name, newUserCookie());
      const [lo, hi] = [wren, id].sort();
      const [yesLo, yesHi] = lo === wren ? [yes.wren, yes.them] : [yes.them, yes.wren];
      // Past the wait for texts (talk, then decide), so the answers show.
      await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, matched_at) values ($1, $2, $3, $4, now() - interval '3 hours')`, [lo, hi, yesLo, yesHi]);
      return { id, lo, hi };
    };
    await other("Bo Quill", { wren: true, them: true }); // open: a date both want
    await other("Cy Marr", { wren: true, them: false }); // Cy passed, seen: filed away
    await other("Di Vale", { wren: false, them: true }); // Wren passed, seen: filed away
    const ed = await other("Ed Fenn", { wren: true, them: false }); // Ed passed, but the match is still unseen
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values ('n-ed', $1, 'matched', 'New match', $2)`, [userIdOf(owner), `/messages/${ed.lo}/${ed.hi}`]);
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const page = async (q: { show?: string; all?: string } = {}) => renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: wren, ...q }) }));
    const shows = (html: string, name: string) => html.includes(`>${name}</span>`) || html.includes(`>${name}</strong>`);

    const open = await page();
    expect(["Bo", "Ed"].filter((n) => shows(open, n))).toEqual(["Bo", "Ed"]);
    expect(["Cy", "Di"].filter((n) => shows(open, n))).toEqual([]);
    expect(open).toContain('<nav class="tabs matches-filter" aria-label="Which matches">');
    expect(open).toMatch(/aria-current="page"[^>]*>Open · 2</);
    expect(open).toContain(`href="/matches?character=${wren}&amp;show=over#messages-title">Didn&#x27;t work out · 2<`);
    expect(open).toContain('title="Ed passed"'); // still here while unseen, with why on it

    const over = await page({ show: "over" });
    expect(["Cy", "Di"].filter((n) => shows(over, n))).toEqual(["Cy", "Di"]);
    expect(["Bo", "Ed"].filter((n) => shows(over, n))).toEqual([]); // only the ones that didn't work out
    expect(over).toContain("Cy passed");
    expect(over).toContain("Wren passed");
    expect(over).toContain("Matched, no texts");
    expect(over).toMatch(/aria-current="page"[^>]*>Didn&#x27;t work out · /);
    // The old link (?all=1) opens the same list.
    const legacy = await page({ all: "1" });
    expect(["Cy", "Di"].filter((n) => shows(legacy, n))).toEqual(["Cy", "Di"]);

    // Once Ed's match is seen, it's filed away too.
    await t.db.query(`update notifications set read_at = now() where id = 'n-ed'`);
    expect(shows(await page(), "Ed")).toBe(false);
    expect(shows(await page({ show: "over" }), "Ed")).toBe(true);
  });

  it("/matches shows no filter while nothing has been filed away", async () => {
    const owner = newUserCookie();
    const wren = await make("Wren Kestrel", owner);
    const bo = await make("Bo Quill", newUserCookie());
    const [lo, hi] = [wren, bo].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, matched_at) values ($1, $2, true, true, now() - interval '3 hours')`, [lo, hi]);
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const html = renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: wren }) }));
    expect(html).not.toContain("matches-filter");
    expect(html).toContain(">Bo</span>");
  });

  it("/matches follows the header's character, never the one with news (the header's dot says where that is)", async () => {
    const { owner, wren, lexi, dex } = await ownerWithATakenOne();
    const [lo, hi] = pairKey(lexi, dex);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'n', $2)`, [userIdOf(owner), `/messages/${lo}/${hi}`]);
    jar.cookies.set(CHARACTER_COOKIE, wren);
    const html = renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("character-tabs");
    // The heading names whose matches these are, and its name opens the header's picker.
    // The name and its 's kept together (2026-11-20 mobile audit, B2).
    expect(html).toMatch(/<span class="heading-switch-keep"><button type="button" class="heading-switch"[^>]*>Wren<\/button>&#x27;s<\/span> matches/);
    expect(html).toContain(`href="/swipe?character=${wren}"`);
    // The address still wins.
    const asked = renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: lexi }) }));
    expect(asked).toMatch(/class="heading-switch"[^>]*>Lexi</);
  });

  // UX audit 2026-11-22: "No matches yet for Orrin" while two of the owner's other characters had live matches.
  it("/matches with nobody for this one leads to the owner's others that have someone", async () => {
    const owner = newUserCookie();
    const wren = await make("Wren Kestrel", owner);
    const lexi = await make("Lexi Moreau", owner);
    const bo = await make("Bo Quill", newUserCookie());
    const [lo, hi] = [wren, bo].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, matched_at) values ($1, $2, true, true, now() - interval '3 hours')`, [lo, hi]);
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const html = renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: lexi }) }));
    expect(html).toContain("No matches yet for Lexi");
    expect(html).toContain(`Your other character has matches: <a href="/matches?character=${wren}">Wren</a>.`);
    // One who has someone points nowhere else.
    const own = renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: wren }) }));
    expect(own).not.toContain("matches-elsewhere");
  });
});

// 2026-11-14 design audit: without a character, /swipe was a sentence, a button and four small faces. Now a real deck
// card from this season's cast to try, which sends nothing, and Make a character once it's swiped.
describe("the swipe page without a character: a demo card", () => {
  const house = HOUSE_CHARACTERS[0];

  it("deals one of this season's cast as a real deck card, with Pass, Like and the way to a real deck", async () => {
    const html = await swipePage();
    expect(html).toContain('class="swipe-deck swipe-demo"');
    expect(html).toContain(`aria-label="${house.name}, ${house.age}"`);
    expect(html).toContain('class="swipe-card swipe-top');
    expect(html).toContain(`aria-label="Pass on ${house.name}"`);
    expect(html).toContain(`aria-label="Like ${house.name}"`);
    expect(html).toContain(">On the show this season<");
    expect(html).toContain('href="/create?next=%2Fswipe"');
    expect(html).toContain("Match before you date");
    // Not the full-screen deck: a visitor keeps the site's header and footer.
    expect(html).not.toContain("swipe-fullscreen");
  });

  it("the profile that scrolls inside the card is reachable by keyboard, and the card peeking behind is never read or reached", async () => {
    const html = await swipePage();
    const top = html.slice(html.indexOf('class="swipe-card swipe-top'));
    expect(top).toMatch(/class="swipe-body" role="region" aria-label="[^"]+ profile" tabindex="0"/);
    const behind = html.match(/<article class="swipe-card swipe-next"[^>]*>/)?.[0];
    if (behind) {
      expect(behind).toContain('aria-hidden="true"');
      expect(behind).toContain('inert=""');
    }
  });

  it("the demo deck never calls the API: no fetch, no /api path, and the prompt names who likes back", () => {
    const src = readFileSync(join(__dirname, "..", "app", "swipe", "DemoDeck.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\/api\//);
    expect(code).not.toMatch(/sendBeacon|XMLHttpRequest|useRouter|"use server"/);
    expect(code).toContain("Make a character to swipe for real — {name} likes back.");
  });
});
