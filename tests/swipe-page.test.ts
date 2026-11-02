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
import { api, HOUSE_PARTNER_ID, newUserCookie, startTestDb, validCharacter } from "./helpers";

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

  it("/matches leaves out the matches that didn't work out unless asked, and says how many", async () => {
    const owner = newUserCookie();
    const wren = await make("Wren Kestrel", owner);
    const bo = await make("Bo Quill", newUserCookie());
    const cy = await make("Cy Marr", newUserCookie());
    for (const [other, yes] of [[bo, true], [cy, false]] as const) {
      const [lo, hi] = [wren, other].sort();
      await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, $3, $3)`, [lo, hi, yes]);
    }
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    const page = async (all?: string) => renderToStaticMarkup(await MatchesPage({ searchParams: Promise.resolve({ character: wren, ...(all ? { all } : {}) }) }));
    const html = await page();
    expect(html).toContain("Bo");
    expect(html).not.toContain("Cy");
    expect(html).toContain("Show 1 that didn&#x27;t work out");
    expect(html).toContain(`href="/matches?character=${wren}&amp;all=1#messages-title"`);
    const everyone = await page("1");
    expect(everyone).toContain("Cy");
    expect(everyone).toContain("Not this time");
    expect(everyone).toContain("Hide the 1 that didn&#x27;t work out");
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
