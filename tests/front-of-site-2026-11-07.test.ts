// The front of the site (docs/audits/2026-11-07-audit-and-benchmark.md, items 1–5): a real date in the first seconds,
// on the gate, the home hero and /watch; the episode page's order and ?play=1; the sample character's way to Review.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Turn } from "@/lib/conversation";
import { clipLine, EXCERPT_LINES, episodeIdFrom, excerptLines, pickFeaturedDate } from "@/lib/featured-date";
import type { CharacterRef, EpisodeView } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import AgeGate from "@/app/AgeGate";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const turn = (side: "a" | "b", dialogue: string, act = 0): Turn => ({ side, act, dialogue, action: "", emotion: "warm", interest: 0.5 });
const LINES: Turn[] = [
  turn("a", "So you're the one who reviews fountains?"),
  turn("b", "", 0),
  turn("b", "Only the ones that deserve it. This one's a four."),
  turn("a", "A four! Generous for a fountain with a coin problem."),
  turn("b", "Everyone has a coin problem. Sit down, it's warmer by the wishes."),
  turn("a", "Fine. But I'm judging the wishes too."),
];

describe("a few lines of a real date (lib/featured-date.ts)", () => {
  it("cuts a long line at a word, and leaves a short one alone", () => {
    expect(clipLine("Hello there.")).toBe("Hello there.");
    const long = `${"word ".repeat(60)}end`;
    const cut = clipLine(long, 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });

  it("takes the first spoken lines, skipping an action-only one", () => {
    const lines = excerptLines(LINES, 3);
    expect(lines.map((l) => l.side)).toEqual(["a", "b", "a"]);
    expect(lines[1].text).toBe("Only the ones that deserve it. This one's a four.");
  });

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
      setting: "A fountain at dusk.",
      title: "The Coin Problem",
      aired_at: "2026-11-05T20:00:00.000Z",
      venue: undefined,
      ...extra,
    }) as unknown as EpisodeView;

  it("features the newest aired public date, preferring two drawn faces, never a private character or an unaired date", () => {
    const faces = ep("faces", { characters: [char("fa", { portrait: "/a.png" }), char("fb", { portrait: "/b.png" })] });
    const pick = pickFeaturedDate([ep("newest"), faces]);
    expect(pick?.episode_id).toBe("faces");
    expect(pick?.lines).toHaveLength(EXCERPT_LINES);
    expect(pick?.code).toBe("S2 · Night 5");
    expect(pickFeaturedDate([ep("plain")])?.episode_id).toBe("plain");
    expect(
      pickFeaturedDate([
        ep("unaired", { revealed: false }),
        ep("unlisted", { visibility: "unlisted" }),
        ep("hidden", { hidden: true }),
        ep("private", { characters: [char("p1", { private: true }), char("p2")] }),
        ep("short", { transcript: LINES.slice(0, 2) }),
      ]),
    ).toBeNull();
  });

  it("reads the episode a gate's `from` was headed to", () => {
    expect(episodeIdFrom("/episodes/abc-123?play=1")).toBe("abc-123");
    expect(episodeIdFrom("/episodes/abc-123")).toBe("abc-123");
    expect(episodeIdFrom("/watch")).toBeNull();
    expect(episodeIdFrom("/episodes/")).toBeNull();
    expect(episodeIdFrom("/episodes/%3Cscript%3E")).toBeNull();
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
afterEach(() => {
  vi.unstubAllEnvs();
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};

/** A date with a house character that has aired publicly, with lines to quote. */
async function airedDate() {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  await t.db.query(`update episodes set transcript = $2::jsonb, visibility = 'public' where id = $1`, [ep.id, JSON.stringify(LINES)]);
  return { owner, id: ep.id as string };
}

describe("the 18+ gate shows the show behind it (item 1)", () => {
  it("draws the newest date blurred behind the question, and names the date a link was for", async () => {
    const { id } = await airedDate();
    const GatePage = (await import("@/app/gate/page")).default;
    const home = renderToStaticMarkup(await GatePage({ searchParams: Promise.resolve({ from: "/" }) }));
    expect(home).toContain('class="gate-backdrop"');
    expect(home).toContain('class="age-gate has-backdrop"');
    expect(home).toContain("So you&#x27;re the one who reviews fountains?");
    expect(home).not.toContain("One tap from");
    // The backdrop has nothing to click, and the question still works without JavaScript.
    expect(home).not.toContain("Watch how it ends");
    expect(home).toContain('action="/api/age"');
    const linked = renderToStaticMarkup(await GatePage({ searchParams: Promise.resolve({ from: `/episodes/${id}?play=1` }) }));
    expect(linked).toContain("One tap from <strong>Pell Ardent ×");
    // 2026-11-14 design audit: the gate sells. The pair behind it sits at the top of the card (faces, "A × B", title),
    // and what the show is comes before the question: the legal sentence, word for word, moved above it.
    for (const html of [home, linked]) {
      expect(html).toContain('<div class="age-gate-pair">');
      expect(html.indexOf('class="age-gate-pair"')).toBeLessThan(html.indexOf('id="age-gate-title"'));
      const faces = html.slice(html.indexOf('class="age-gate-faces"'), html.indexOf('class="age-gate-pair-names"'));
      expect(faces.match(/<(img|svg)\b/g)).toHaveLength(2);
      expect(html).toContain(`× ${HOUSE_CHARACTERS[0].name}</strong>`);
      expect(html.indexOf("Botchelor is a comedic blind-date show")).toBeLessThan(html.indexOf("Are you 18 or older?"));
      expect(html).toContain("Botchelor is a comedic blind-date show starring <strong>fictional adult characters</strong>, written by AI.");
    }
  });

  it("shows the show's pair only on the show's gate: After Dark's keeps its own words and no pair", () => {
    const face = (id: string, name: string) => ({ id, name, hue: 200, portrait: null, house: false });
    const behind = { a: face("c-a", "Juno Marlowe"), b: face("c-b", "Pell Ardent"), title: "The fountain incident", target: true };
    const show = renderToStaticMarkup(createElement(AgeGate, { from: "/swipe", backdrop: true, behind }));
    expect(show).toContain('class="age-gate-pair"');
    expect(show).toContain("<strong>Juno Marlowe × Pell Ardent</strong>");
    expect(show).toContain("“The fountain incident”");
    const ad = renderToStaticMarkup(createElement(AgeGate, { from: "/after-dark", afterDark: true, behind }));
    expect(ad).not.toContain("age-gate-pair");
    expect(ad).not.toContain("Juno Marlowe");
    expect(ad).not.toContain("A comedy dating show");
    expect(ad).toContain("After Dark is <strong>explicit</strong>");
    // Kept on both: the no-JS post, the way out, the dialog's name.
    for (const html of [show, ad]) {
      expect(html).toContain('action="/api/age" method="post"');
      expect(html).toContain("No — take me away");
      expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="age-gate-title"');
    }
  });

  it("is the plain question when nothing has aired", async () => {
    const GatePage = (await import("@/app/gate/page")).default;
    const html = renderToStaticMarkup(await GatePage({ searchParams: Promise.resolve({ from: "/" }) }));
    expect(html).not.toContain("gate-backdrop");
    expect(html).toContain('class="age-gate"');
    expect(html).toContain("Are you 18 or older?");
  });
});

describe("the home hero is a real date (item 2)", () => {
  it("plays a real date's opening lines with the way to watch how it ends, not a made-up box score", async () => {
    const { id } = await airedDate();
    as(null);
    const Home = (await import("@/app/page")).default;
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('class="hero-art has-date"');
    expect(html).toContain("Only the ones that deserve it. This one&#x27;s a four.");
    expect(html).toContain(`href="/episodes/${id}?play=1"`);
    expect(html).not.toContain("Awkwardness");
    // The shelf's card and the tonight band land in the theater too (item 4): no plain link to an aired date.
    expect(html).toContain('class="episode-shelf"');
    expect(html.split(`href="/episodes/${id}"`).length - 1).toBe(0);
  });
});

describe("/watch opens on a date (item 3)", () => {
  it("leads with the newest date, then the season as one line, and doesn't list that date twice", async () => {
    const { id } = await airedDate();
    as(newUserCookie());
    const WatchPage = (await import("@/app/watch/page")).default;
    const html = renderToStaticMarkup(await WatchPage({ searchParams: Promise.resolve({}) } as never));
    const lead = html.indexOf("watch-lead");
    const season = html.indexOf('class="season-line ux-fold"');
    expect(lead).toBeGreaterThan(0);
    expect(season).toBeGreaterThan(lead);
    expect(html.slice(season, season + 400)).toMatch(/📺 Season \d+/);
    expect(html).toContain('href="/reunion#next-season"');
    expect(html).toContain("The only one so far is the date at the top.");
    expect(html.split(`href="/episodes/${id}"`).length - 1).toBe(0);
    expect(html).toContain(`href="/episodes/${id}?play=1"`);
  });
});

describe("an episode page (item 4)", () => {
  it("asks how it went after the date, and ?play=1 opens the theater for anyone", async () => {
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_GUEST_REPLIES", "0");
    const { id } = await airedDate();
    as(newUserCookie());
    const EpisodePage = (await import("@/app/episodes/[id]/page")).default;
    const html = renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ play: "1" }) }));
    expect(html).toContain('class="theater theater-clean"');
    // A stranger's playback is a replay, never "Just filmed" (that's the creator's own date).
    expect(html).toContain('<span class="chip">Replay</span>');
    const talk = html.indexOf('id="episode-talk-head"');
    expect(talk).toBeGreaterThan(html.indexOf("<h2>The date</h2>"));
    expect(talk).toBeGreaterThan(html.indexOf('id="predict"'));
    const plain = renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(plain).not.toContain("theater-clean");
    expect(plain).toContain("Watch in theater");
    expect(plain).not.toContain("🎬 Watch in theater");
  });
});

describe("/create (item 5)", () => {
  it("names every step of the rail for a screen reader", async () => {
    const { default: CreateWizard } = await import("@/app/create/CreateWizard");
    // A creator's next character: the four-step quick track (a first character takes three, tests/creator-quick-track.test.ts).
    const html = renderToStaticMarkup(createElement(CreateWizard, { myCharacters: [{ id: "c-1", name: "Mira Quell" }] }));
    expect(html).toContain('aria-label="Step 1: Identity (this step)"');
    // The quick track (2026-11-11 audit, 2.2): four steps for a new character (look included); depth is opted into from the review.
    expect(html).toContain('aria-label="Step 2: Look"');
    expect(html).toContain('aria-label="Step 3: Dating profile"');
    expect(html).toContain('aria-label="Step 4: Review"');
    expect(html).not.toContain("Step 8");
  });
});

// Design audit 2026-11-14: the date itself is on the episode page, its first exchange showing, the rest one tap away;
// the written recap (the ending) stays folded; a spectator before the finale airs gets no lines at all.
describe("an episode page shows the date's first exchange (design audit 2026-11-14)", () => {
  const renderEpisode = async (id: string) => {
    const EpisodePage = (await import("@/app/episodes/[id]/page")).default;
    return renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
  };

  it("puts the line-by-line read on the page, open, with a fold for the rest and the recap still closed", async () => {
    const { id } = await airedDate();
    as(newUserCookie());
    const html = await renderEpisode(id);
    // A section, not a closed <details>: the date's opening lines are on the page from the start.
    expect(html).toContain('<section class="card transcript episode-read has-more" id="the-date" aria-labelledby="the-date-title"><h2 id="the-date-title">Read it line by line</h2>');
    const read = html.slice(html.indexOf('id="the-date"'), html.indexOf("</section>", html.indexOf('id="the-date"')));
    expect(read).toContain("So you&#x27;re the one who reviews fountains?");
    // Six lines: four show, "Read the whole date (2 more lines)" opens the rest, closed to begin with.
    expect(read).toContain('<details class="episode-read-more"><summary><span class="episode-read-more-show">Read the whole date (2 more lines)</span>');
    expect(read).not.toMatch(/<details class="episode-read-more"[^>]*\sopen/);
    // The ending stays behind its own warning, closed.
    expect(html).toContain('<details class="recap-toggle"><summary><span class="recap-toggle-show">Show the written recap (it gives away the ending)</span>');
    expect(html).not.toMatch(/<details class="recap-toggle"[^>]*\sopen/);
    // The read comes before the recap and the diary cam.
    expect(html.indexOf('id="the-date"')).toBeLessThan(html.indexOf('class="recap-toggle"'));
  });

  it("shows a spectator no lines before the finale airs (nothing to read, nothing spoiled)", async () => {
    const owner = newUserCookie();
    const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id;
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
    await t.db.query(`update episodes set transcript = $2::jsonb, visibility = 'public' where id = $1`, [ep.id, JSON.stringify(LINES)]);
    as(newUserCookie());
    const html = await renderEpisode(ep.id);
    expect(html).not.toContain('id="the-date"');
    expect(html).not.toContain("Read it line by line");
    expect(html).not.toContain("reviews fountains");
    expect(html).not.toContain("Read the whole date");
    // Its creator, who may read it before it airs, gets the same opening on the page.
    as(owner);
    expect(await renderEpisode(ep.id)).toContain("So you&#x27;re the one who reviews fountains?");
  });
});

describe("the read's fold (app/episodes/[id]/TranscriptRead.tsx)", () => {
  it("folds what's past the first exchange, and a walk-out wherever it is; a short date shows whole", async () => {
    const { default: TranscriptRead, readNeedsMore, TRANSCRIPT_PREVIEW_LINES } = await import("@/app/episodes/[id]/TranscriptRead");
    expect(TRANSCRIPT_PREVIEW_LINES).toBe(4);
    expect(readNeedsMore(LINES)).toBe(true);
    expect(readNeedsMore(LINES.slice(0, 4))).toBe(false);
    const walkout: Turn[] = [...LINES.slice(0, 2), { ...LINES[2], walked_out: true }];
    expect(readNeedsMore(walkout)).toBe(true);
    const characters: [CharacterRef, CharacterRef] = [
      { id: "a1", name: "Ada One", house: true, hue: 10, portrait: null },
      { id: "b1", name: "Bo Two", house: true, hue: 20, portrait: null },
    ];
    const short = renderToStaticMarkup(createElement(TranscriptRead, { episodeId: "e1", characters, turns: LINES.slice(0, 3) }));
    expect(short).toContain('class="card transcript episode-read"');
    expect(short).not.toContain("episode-read-more");
    // A walk-out is the ending: even a short date keeps it behind the fold (no "N more lines" when there are none).
    const out = renderToStaticMarkup(createElement(TranscriptRead, { episodeId: "e1", characters, turns: walkout }));
    expect(out).toContain('class="card transcript episode-read has-more"');
    expect(out).toContain('<span class="episode-read-more-show">Read the whole date</span>');
    expect(out).toContain('class="chat-note chat-move chat-walkout"');
  });

  it("the stylesheet hides past line four and the walk-out only while the fold is closed", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".episode-read.has-more:has(> .episode-read-more:not([open])) .chat-thread > .chat-item:nth-child(n + 5),");
    expect(css).toContain(".episode-read.has-more:has(> .episode-read-more:not([open])) .chat-walkout {");
  });

  it("keeps a house face's whole ring inside the thread, so the fold's fade never cuts it", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    // The fade is a mask, and a mask paints only inside the thread's box: the ring has to fit within its padding.
    const ring = css.match(/\.avatar-house \{\s*outline: (\d+)px solid [^;]+;\s*outline-offset: (\d+)px;/);
    const pad = css.match(/\.episode-read \.chat-thread \{\s*padding-inline: (\d+)px;/);
    expect(ring && pad).toBeTruthy();
    expect(Number(pad![1])).toBeGreaterThanOrEqual(Number(ring![1]) + Number(ring![2]));
  });
});
