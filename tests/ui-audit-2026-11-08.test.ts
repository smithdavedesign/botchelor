/**
 * The 2026-11-08 UI design audit (docs/audits/2026-11-08-ui-design-audit.md): what each of its thirteen fixes promises.
 * The CSS token ratchet (item 9) has its own file, tests/css-tokens.test.ts.
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The companions browser and the feedback dock are client components that use the router.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import CompanionBrowser, { COMPANIONS_PAGE } from "@/app/companion/CompanionBrowser";
import DateExcerpt, { EXCERPT_LINES_AT_ONCE } from "@/app/DateExcerpt";
import EpisodeShelf from "@/app/EpisodeShelf";
import { FeedEntry } from "@/app/EpisodeItem";
import Icon, { ICON_NAMES } from "@/app/Icon";
import ShowcaseGrid from "@/app/showcase/ShowcaseGrid";
import StripPager from "@/app/watch/StripPager";
import type { CompanionListItem } from "@/lib/companion";
import type { FeaturedDate } from "@/lib/featured-date";
import { feedEpisodes, nightFaces, nightPairs, withoutEpisode } from "@/lib/feed-items";
import { listAiredFeed, type EpisodeView, type FeedItem } from "@/lib/game";
import { balancedColumns } from "@/lib/grid-balance";
import { SHOW_HANDLE } from "@/lib/showcase-labels";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = (el: ReactElement) => renderToStaticMarkup(el);

// ---------------------------------------------------------------------------------------------------------------------
// Item 2: a mixer night is one entry on Watch and home, not nine cards of the same rooftop.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const userOf = (cookie: string) => cookie.split("=")[1];

/** One public date for a new host (or `host`), aired `minutesAgo` minutes ago. */
async function aired(minutesAgo: number, opts: { visibility?: string; host?: string } = {}) {
  const host = opts.host ?? newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), host)).json();
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, ...(opts.visibility ? { visibility: opts.visibility } : {}) }, host);
  if (res.status !== 200) throw new Error(`episode setup failed with ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  await t.db.query(`update episodes set revealed_at = now() - $2 * interval '1 minute', air_after = null where id = $1`, [id, minutesAgo]);
  return id;
}

/** A group night (`kind`) holding these dates as its tables. */
async function night(id: string, kind: "mixer" | "double", tables: string[]) {
  await t.db.query(
    `insert into group_nights (id, kind, venue, created_by, status, couple_a, couple_b) values ($1, $2, 'rooftop_bar', 'house', $3, '{}'::jsonb, '{}'::jsonb)`,
    [id, kind, kind === "mixer" ? "done" : "booked"],
  );
  await t.db.query(`update episodes set group_id = $1 where id = any($2::text[])`, [id, tables]);
}

const shape = (items: FeedItem[]) => items.map((i) => (i.kind === "mixer" ? { night: i.night_id, tables: i.episodes.map((e) => e.id) } : i.episode.id));

describe("Watch's latest list with a mixer night as one entry (lib/game.ts listAiredFeed)", () => {
  it("groups a mixer's tables where its newest table aired, pages by entries, and leaves double dates and lone tables as dates", async () => {
    const viewer = newUserCookie();
    const plain1 = await aired(10);
    const plain2 = await aired(20);
    const plain3 = await aired(30);
    const [m1, m2, m3] = [await aired(25), await aired(5), await aired(15)];
    const own = await aired(3, { host: viewer }); // the viewer's own table at the same mixer
    const [d1, d2] = [await aired(12), await aired(13)];
    const lone = await aired(40);
    const unseen = await aired(41, { visibility: "private" });
    await night("night-m", "mixer", [m1, m2, m3, own]);
    await night("night-d", "double", [d1, d2]);
    await night("night-l", "mixer", [lone, unseen]);

    const me = userOf(viewer);
    const page1 = await listAiredFeed(t.db, me, 1, 3);
    expect(page1).toMatchObject({ page: 1, pages: 3, total: 7, per_page: 3 });
    // The night sits where its newest table aired (5 minutes ago), its tables in the order they aired; never the
    // viewer's own (their account page has it).
    expect(shape(page1.items)).toEqual([{ night: "night-m", tables: [m1, m3, m2] }, plain1, d1]);
    const night1 = page1.items[0] as Extract<FeedItem, { kind: "mixer" }>;
    expect(night1.venue).toBe(night1.episodes[0].venue ?? null);
    expect(night1.episodes.every((e) => e.double && e.group_kind === "mixer")).toBe(true);
    // A double date is two couples' own dates: each stays its own entry.
    expect(shape((await listAiredFeed(t.db, me, 2, 3)).items)).toEqual([d2, plain2, plain3]);
    // A night with one table anyone may see is that date.
    expect((await listAiredFeed(t.db, me, 3, 3)).items).toEqual([{ kind: "episode", episode: expect.objectContaining({ id: lone }) }]);
    // Past the end: empty, with the real count.
    expect(await listAiredFeed(t.db, me, 9, 3)).toEqual({ items: [], page: 9, pages: 3, total: 7, per_page: 3 });

    // Anyone else sees the viewer's table too, at the night's head now that it's the newest.
    const everyone = await listAiredFeed(t.db, null, 1, 3);
    expect(shape(everyone.items)[0]).toEqual({ night: "night-m", tables: [m1, m3, m2, own] });
    expect(feedEpisodes(everyone.items).map((e) => e.id)).toEqual([m1, m3, m2, own, plain1, d1]);
  });

  it("is what Watch and home list", () => {
    const watch = source("app/watch/page.tsx");
    expect(watch).toContain("listAiredFeed(db, viewerId, page)");
    expect(watch).toContain("<FeedEntry key=");
    expect(watch).not.toContain("listAiredPage");
    const home = source("app/page.tsx");
    expect(home).toContain("listAiredFeed(conn, viewerId, 1, 6)");
    expect(home).toContain("<EpisodeShelf items={");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The feed helpers (lib/feed-items.ts).

const face = (id: string, name: string) => ({ id, name, hue: 10, house: false, portrait: null, agent: false });
const ep = (id: string, a: [string, string], b: [string, string], extra: Partial<EpisodeView> = {}) =>
  ({ id, characters: [face(...a), face(...b)], revealed: true, share_path: `/episodes/${id}`, setting: "A rooftop.", venue: "rooftop_bar", ...extra }) as unknown as EpisodeView;
const sable = ["s", "Sable Okafor"] as [string, string];
const greta = ["g", "Greta Lind"] as [string, string];
const sigrid = ["i", "Sigrid Holm"] as [string, string];
const barnaby = ["b", "Barnaby Cole"] as [string, string];
const t1 = ep("t1", sable, greta);
const t2 = ep("t2", sigrid, barnaby);
const t3 = ep("t3", sable, barnaby);
const t4 = ep("t4", greta, sigrid);
const mixer = (episodes: EpisodeView[]): FeedItem => ({ kind: "mixer", night_id: "n1", venue: "rooftop_bar", episodes });
const single = (e: EpisodeView): FeedItem => ({ kind: "episode", episode: e });

describe("a feed page's helpers", () => {
  it("lists every date on the page in order, a night's tables where the night sits", () => {
    const solo = ep("solo", ["x", "Xan"], ["y", "Yul"]);
    expect(feedEpisodes([mixer([t1, t2]), single(solo)]).map((e) => e.id)).toEqual(["t1", "t2", "solo"]);
  });

  it("takes the featured date out: a night keeps its other tables, one left reads as that date, none left is gone", () => {
    const solo = ep("solo", ["x", "Xan"], ["y", "Yul"]);
    const page = [mixer([t1, t2, t3]), single(solo)];
    expect(withoutEpisode(page, "nope")).toEqual(page);
    expect(withoutEpisode(page, "solo")).toEqual([mixer([t1, t2, t3])]);
    expect(withoutEpisode(page, "t2")).toEqual([mixer([t1, t3]), single(solo)]);
    expect(withoutEpisode([mixer([t1, t2])], "t1")).toEqual([single(t2)]);
    expect(withoutEpisode([mixer([t1])], "t1")).toEqual([]);
  });

  it("names a night's people once each, in the order they sat down, and a few of its pairs by first name", () => {
    expect(nightFaces([t1, t2, t3, t4]).map((c) => c.name)).toEqual(["Sable Okafor", "Greta Lind", "Sigrid Holm", "Barnaby Cole"]);
    expect(nightPairs([t1, t2])).toEqual({ line: "Sable × Greta · Sigrid × Barnaby", more: 0 });
    expect(nightPairs([t1, t2, t3, t4])).toEqual({ line: "Sable × Greta · Sigrid × Barnaby · Sable × Barnaby", more: 1 });
  });
});

describe("a mixer night's card (Watch) and tile (home)", () => {
  it("is one card opening the night's page, with its faces, its tables and a few of its pairs", () => {
    const card = html(createElement(FeedEntry, { item: mixer([t1, t2, t3, t4]) }));
    expect(card).toContain('<li class="card episode-item night-item tap-card">');
    expect(card).toContain('href="/mixers/n1"');
    expect(card).toContain("Speed-dating night");
    expect(card).toContain("4 singles · 4 tables aired");
    expect(card).toContain("Sable × Greta · Sigrid × Barnaby · Sable × Barnaby and 1 more");
    expect(card.match(/class="avatar/g)).toHaveLength(4);
    expect(card).not.toContain("/episodes/t1"); // the night's page lists its tables
  });

  it("shows six faces, then how many more", () => {
    const people = Array.from({ length: 5 }, (_, i) => ep(`p${i}`, [`a${i}`, `Ann${i} X`], [`b${i}`, `Bea${i} Y`]));
    const card = html(createElement(FeedEntry, { item: mixer(people) }));
    expect(card.match(/class="avatar/g)).toHaveLength(6);
    expect(card).toContain('<span class="night-faces-more">+4</span>');
  });

  it("is a date's own card otherwise, on the venue's photo, linked to the episode", () => {
    const card = html(createElement(FeedEntry, { item: single(t1) }));
    expect(card).toContain('href="/episodes/t1"');
    expect(card).toMatch(/<div class="venue-photo episode-item-photo"[^>]*><img [^>]*src="\/cast\/venue-rooftop_bar-v2\.webp"[^>]*loading="lazy"/);
  });

  it("lets a tap on the picture's faces or chip through to the card's link", () => {
    // They sit above the picture's grade (z-index 1), so above the .stretch overlay (z-index 0) too.
    const css = source("app/ux/catalog.css");
    expect(css).toMatch(/\.photo-chip \{[^}]*z-index: 1;[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.episode-item-photo :is\(\.pair-faces, \.night-faces\) \{[^}]*z-index: 1;[^}]*pointer-events: none;/);
  });

  it("on home's shelf, a night is one tile too", () => {
    const shelf = html(createElement(EpisodeShelf, { items: [mixer([t1, t2, t3]), single(t4)] }));
    expect(shelf.match(/class="episode-shelf-card tap-card"/g)).toHaveLength(2);
    expect(shelf).toContain('href="/mixers/n1"');
    expect(shelf).toContain("3 tables at");
    expect(shelf).toContain('href="/episodes/t4?play=1"');
    expect(shelf.match(/class="venue-photo episode-shelf-photo"/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 3: the real date's card isn't half empty while it types.

const featured: FeaturedDate = {
  episode_id: "e9",
  share_path: "/episodes/e9",
  title: null,
  code: "S2 · Night 7",
  characters: [face("a", "Ada Lumen"), face("b", "Bo Quill")] as unknown as FeaturedDate["characters"],
  venue: "rooftop_bar",
  setting: "A rooftop.",
  lines: [
    { side: "a", text: "You came." },
    { side: "b", text: "I said I would." },
    { side: "a", text: "People say a lot of things." },
    { side: "b", text: "I'm not people." },
  ] as FeaturedDate["lines"],
};

describe("the real date's opening lines (app/DateExcerpt.tsx)", () => {
  it("shows the first two lines at once, and only the rest type in after them", () => {
    expect(EXCERPT_LINES_AT_ONCE).toBe(2);
    const card = html(createElement(DateExcerpt, { date: featured }));
    const lines = card.match(/<li class="date-excerpt-line[^"]*"[^>]*>.*?<\/li>/g) ?? [];
    expect(lines).toHaveLength(4);
    for (const line of lines.slice(0, 2)) {
      expect(line).toContain(" is-now");
      expect(line).not.toContain("--i");
      expect(line).not.toContain("date-excerpt-typing");
    }
    expect(lines[2]).toContain('style="--i:0"');
    expect(lines[3]).toContain('style="--i:1"');
    expect(lines.slice(2).every((l) => l.includes("date-excerpt-typing"))).toBe(true);
  });

  it("sits on the venue's photo, and lays out in two columns on Watch's wide page", () => {
    const card = html(createElement(DateExcerpt, { date: featured, wide: true }));
    expect(card).toContain('class="date-excerpt is-wide"');
    expect(card).toContain("url(/cast/venue-rooftop_bar-v2.webp)");
    expect(card).toMatch(/<a class="button"[^>]*href="\/episodes\/e9\?play=1"[^>]*><svg class="icon"[^>]*>.*?<\/svg> Watch how it ends<\/a>/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 4: Companions shows a page of 24, not all 173.

const companion = (i: number): CompanionListItem => ({
  id: `c${i}`,
  name: `Person ${String(i).padStart(2, "0")}`,
  bio: "Restores old radios.",
  portrait: null,
  hue: null,
  house: false,
  yours: false,
  pronouns: null,
  thread_id: null,
  last: null,
  last_at: null,
  age: 30,
  traits: ["dry"],
  source: "community",
  on_show: false,
  created_at: "2026-11-01T00:00:00.000Z",
});

describe("the companions browser's pages (app/companion/CompanionBrowser.tsx)", () => {
  it(`shows ${COMPANIONS_PAGE} and a way to the next ones, and says how many are shown of how many`, () => {
    expect(COMPANIONS_PAGE).toBe(24);
    const many = html(createElement(CompanionBrowser, { threads: [], others: Array.from({ length: 30 }, (_, i) => companion(i)) }));
    expect(many.match(/<li class="companion-tile"/g)).toHaveLength(24);
    expect(many).toContain('<p class="companion-more"><button type="button" class="button secondary">Show 6 more</button> <span class="muted small">24 of 30 shown</span></p>');
    const few = html(createElement(CompanionBrowser, { threads: [], others: Array.from({ length: 24 }, (_, i) => companion(i)) }));
    expect(few.match(/<li class="companion-tile"/g)).toHaveLength(24);
    expect(few).not.toContain("companion-more");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Items 5 and 6: two page widths; a short grid never ends on one lonely card.

describe("page widths (docs/brand.md, Layout)", () => {
  it("are two: main's reading column, and the wide one the browsing pages opt into", () => {
    const globals = source("app/globals.css");
    expect(globals).toMatch(/--page-read: 46rem;/);
    expect(globals).toMatch(/--page-wide: 72rem;/);
    expect(globals).toMatch(/\nmain \{[^}]*max-width: var\(--page-read\);/);
    expect(source("app/ux/catalog.css")).toMatch(/main:has\(> \.page-wide\) \{\s*max-width: var\(--page-wide\);/);
    for (const [page, root] of [
      ["app/page.tsx", '<div className="home page-wide">'],
      ["app/watch/page.tsx", 'className="watch-page page-wide"'],
      ["app/characters/page.tsx", 'className="characters-hub page-wide"'],
      ["app/companion/page.tsx", 'className="companion-page page-wide"'],
      ["app/showcase/page.tsx", "showcase-page page-wide"],
      ["app/reunion/page.tsx", "page-wide"],
      ["app/reviews/page.tsx", "page-wide"],
      ["app/graph/page.tsx", "page-wide"],
    ]) {
      expect(source(page), page).toContain(root);
    }
  });

  it("has one <main>, the layout's: a page's root is never a second one", () => {
    for (const page of ["app/showcase/page.tsx", "app/showcase/requests/page.tsx", "app/creators/[handle]/page.tsx", "app/doubles/[id]/page.tsx", "app/date/[code]/page.tsx"]) {
      expect(source(page), page).not.toMatch(/<main[\s>]/);
    }
  });
});

describe("balanced grids (lib/grid-balance.ts)", () => {
  it("puts a short row all in one line, and otherwise the count that leaves the fewest empty places", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => balancedColumns(n))).toEqual([1, 2, 3, 4, 3, 3, 4, 4, 3, 4, 4, 4, 3]);
    // Never two a row on a wide screen just because two divides evenly: ten is 4 + 4 + 2, not five rows of two.
    expect(balancedColumns(10)).toBe(4);
    expect(balancedColumns(5, 3)).toBe(3);
    expect(balancedColumns(0)).toBe(1);
    expect(balancedColumns(6, 6)).toBe(6);
  });

  it("is set on the season's cast, at home and on Characters", () => {
    expect(source("app/page.tsx")).toMatch(/className="home-cast-faces grid-balanced"[\s\S]{0,200}"--cols": balancedColumns\(/);
    expect(source("app/characters/page.tsx").match(/gallery grid-balanced/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 8: drawn icons, not emoji, for the ones that recur.

describe("icons (app/Icon.tsx)", () => {
  it("draws every name in the text's own colour, hidden from screen readers unless it's given words", () => {
    for (const name of ICON_NAMES) {
      const svg = html(createElement(Icon, { name }));
      expect(svg, name).toMatch(/^<svg class="icon" viewBox="0 0 24 24" width="1em" height="1em"[^>]*aria-hidden="true">.+<\/svg>$/);
      expect(svg, name).toMatch(/stroke="currentColor"|fill="currentColor"/);
    }
    const labelled = html(createElement(Icon, { name: "lock", label: "private" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="private"');
    expect(labelled).not.toContain("aria-hidden");
  });

  it("replaced the recurring emoji in the nav, the cards and the vote cards", () => {
    expect(source("app/Nav.tsx")).not.toMatch(/🔔|🌙/);
    expect(source("app/EpisodeItem.tsx")).not.toMatch(/💞|🤖/);
    expect(source("app/WeeklyReveal.tsx")).not.toContain("🔓");
    expect(source("app/FeedbackDock.tsx")).toContain('<Icon name="chat"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 11: the house's own posts don't sign themselves on every tile.

describe("the showcase grid's caption", () => {
  const post = (id: string, handle: string) => ({
    id,
    source: "after_dark" as const,
    media_id: "m",
    mime: "image/png",
    medium: "picture" as const,
    aspect: null,
    act: "kiss",
    place: null,
    pov: false,
    from_date: true,
    caption: null,
    status: "live",
    published_at: "",
    mine: false,
    creator: { handle, display_name: handle },
    character: { id: "c", name: "Juniper" },
    partner: null,
    likes: 0,
    liked: false,
    remixable: false,
    rating: "pg" as const,
  });

  it("names a creator, but not the show itself", () => {
    expect(SHOW_HANDLE).toBe("botchelor");
    const grid = html(createElement(ShowcaseGrid, { posts: [post("p1", "mara"), post("p2", SHOW_HANDLE)] }));
    const captions = grid.match(/<p class="showcase-by small">.*?<\/p>/g) ?? [];
    expect(captions).toHaveLength(2);
    expect(captions[0]).toContain('<a href="/creators/mara">@mara</a> · Juniper');
    expect(captions[1]).not.toContain("@botchelor");
    expect(captions[1]).toContain("Juniper");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 12: Watch's open rooms open in place, no second numbered pager.

describe("Watch's open rooms (app/watch/StripPager.tsx)", () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => createElement("article", { key: i }, `Room ${i + 1}`));

  it("shows the first row on desktop and a Show all button for the rest, never page numbers", () => {
    const strip = html(createElement(StripPager, { label: "Open rooms", children: cards(5) }));
    expect(strip.match(/class="strip-item"/g)).toHaveLength(3);
    expect(strip.match(/class="strip-item off-page"/g)).toHaveLength(2);
    expect(strip).toContain('<button type="button" class="link-button strip-more" aria-expanded="false">Show all 5</button>');
    expect(strip).not.toMatch(/aria-label="[^"]*pages"/);
    expect(html(createElement(StripPager, { label: "Open rooms", children: cards(3) }))).not.toContain("strip-more");
    // Its groups are named for what they hold: there are no pages any more.
    expect(source("app/watch/page.tsx")).not.toMatch(/<StripPager label="[^"]*pages"/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Items 10 and 13: Create's first step on a phone, and the feedback button.

describe("smaller things", () => {
  it("cuts Create's intro to one line and hides the empty preview on the first step on a phone", () => {
    const wizard = source("app/create/CreateWizard.tsx");
    expect(wizard).toContain('<p className="muted wizard-intro">An original fictional adult.');
    expect(wizard).toMatch(/!edit && step === S\.identity \? " is-first" : ""/);
    expect(source("app/ux/catalog.css")).toMatch(/@media \(max-width: 640px\) \{\s*\.wizard-preview\.is-first \{\s*display: none;/);
  });

  it("makes the feedback button a corner circle that says Feedback on hover or focus", () => {
    const css = source("app/ux/catalog.css");
    expect(css).toMatch(/\.feedback-fab \{[^}]*width: 2\.75rem;/);
    expect(css).toMatch(/\.feedback-fab:is\(:hover, :focus-visible\) \.feedback-fab-label \{[^}]*opacity: 1;/);
  });

  it("loads the audit's stylesheet last, so it settles what the others left", () => {
    const layout = source("app/layout.tsx");
    const imports = [...layout.matchAll(/^import "\.\/(?:ux\/)?[\w-]+\.css";$/gm)].map((m) => m[0]);
    expect(imports.at(-1)).toBe('import "./ux/catalog.css";');
  });
});
