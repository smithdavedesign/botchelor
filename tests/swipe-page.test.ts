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
import { renderToStaticMarkup } from "react-dom/server";
import MatchesPage from "@/app/matches/page";
import SwipePage from "@/app/swipe/page";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, HOUSE_PARTNER_ID, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// David, 2026-10-22: the swipe page picks whose deck it is the way /matches picks whose matches, with your characters'
// faces instead of a drop-down, and a taken one (in a relationship, wanting one partner) easy to tell apart.
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
  return { wren, lexi, dex };
}

const swipePage = async (character?: string) => renderToStaticMarkup(await SwipePage({ searchParams: Promise.resolve(character ? { character } : {}) }));
/** A face's link in the (first) row of faces, by character id. */
const face = (html: string, id: string) => {
  const row = html.match(/<nav class="character-tabs"[^>]*>.*?<\/nav>/)?.[0] ?? "";
  return row.match(new RegExp(`<a[^>]*href="[^"]*=${id}"[^>]*>.*?</a>`))?.[0] ?? "";
};

describe("the swipe page: whose deck, as faces", () => {
  it("shows your characters as faces, not a drop-down, a taken one dimmed and tagged, and opens on one that can swipe", async () => {
    const { wren, lexi } = await ownerWithATakenOne();
    const html = await swipePage();
    expect(html).not.toContain("<select");
    // The same row under the phone's slim bar (which names whose deck it is) and in the desktop's intro.
    expect(html.match(/<nav class="character-tabs" aria-label="Whose deck">/g)).toHaveLength(2);
    expect(html).toContain('<div class="swipe-faces"><nav class="character-tabs"');
    expect(html).toContain('<span class="swipe-topbar-name">Wren</span>');
    const lexiFace = face(html, lexi);
    expect(lexiFace).toContain(`href="/swipe?character=${lexi}"`);
    expect(lexiFace).toContain('class="character-tab is-taken"');
    expect(lexiFace).toContain('aria-label="Lexi: taken (dating Dex), can&#x27;t swipe"');
    expect(lexiFace).toContain(">💍 Taken<");
    // Lexi is the newer one (first in the row), but she can't swipe: without one asked for, the deck opens on Wren.
    expect(html.indexOf(`/swipe?character=${lexi}`)).toBeLessThan(html.indexOf(`/swipe?character=${wren}`));
    const wrenFace = face(html, wren);
    expect(wrenFace).toContain('aria-current="page"');
    expect(wrenFace).not.toContain("Taken");
    expect(html).toContain("Who should Wren meet?");
    expect(html).not.toContain("can&#x27;t swipe right now");
  });

  it("a card that reads like your own character says so on the web too (#426 on the web, 2026-11-13)", async () => {
    const owner = newUserCookie();
    const mine = await make("Ambrose Fenn", owner, { bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping." });
    // Someone else's character made from the same words.
    await make("Seraphina Fenn", newUserCookie(), { bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping." });
    // Someone else again, with a sheet of their own (the detector weighs traits, wants and prompts, not only the bio).
    await make("Dex Marlow", newUserCookie(), {
      bio: "Keeps bees on a roof and names every one of them.",
      traits: ["blunt", "loyal", "restless"],
      want: "Someone who laughs at bees",
      dealbreaker: "People who flinch at honey",
      extras: { prompts: [{ id: "simple_pleasures", answer: "The hum of the hive at dusk." }, { id: "geek_out", answer: "Queen genetics and rooftop drainage." }], hobbies: ["Beekeeping", "Chess"] },
    });
    jar.cookies.clear();
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const html = await swipePage(mine);
    expect(html).toContain("Seraphina Fenn");
    expect(html).toContain("Reads a lot like your own character");
    expect(html).toContain('class="swipe-twin"');
    // Dex's card carries no such line (his own article, not what follows it).
    const dex = html.match(/<article[^>]*aria-label="Dex Marlow, 27"[^>]*>.*?<\/article>/s)?.[0] ?? "";
    expect(dex).toContain("Keeps bees on a roof");
    expect(dex).not.toContain("swipe-twin");
  });

  it("a taken one stays a choice: picking it shows why it can't swipe", async () => {
    const { lexi } = await ownerWithATakenOne();
    const html = await swipePage(lexi);
    expect(face(html, lexi)).toContain('aria-current="page"');
    expect(html).toContain("Lexi can&#x27;t swipe right now");
    expect(html).toContain("Lexi is with someone and wants one partner");
  });

  it("one character: no faces, just its name", async () => {
    const owner = newUserCookie();
    await make("Wren Kestrel", owner);
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const html = await swipePage();
    expect(html).not.toContain("character-tabs");
    expect(html).toContain('<span class="swipe-topbar-name">Wren</span>');
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

  it("/matches marks the same taken face", async () => {
    const { wren, lexi } = await ownerWithATakenOne();
    const html = renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: wren }) }));
    expect(html).toContain('<nav class="character-tabs" aria-label="Whose matches">');
    expect(face(html, lexi)).toContain('class="character-tab is-taken"');
    expect(face(html, lexi)).toContain('aria-label="Lexi: taken (dating Dex), closed to other dates"');
    expect(face(html, wren)).toContain('aria-current="page"');
  });
});
