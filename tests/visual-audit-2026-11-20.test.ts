// The visual audit of 2026-11-20: small, clear fixes, each pinned here (the season clock is in tests/season-pages.test.ts,
// the casting board's lead in tests/casting-layout.test.ts, the reviews' icons and rows in tests/bot-reviews.test.ts).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => "/",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The ship page looks up a real couple by the two names (lib/ship-couple.ts); there's no database here.
vi.mock("@/lib/ship-couple", () => ({ shipCouple: async () => null }));

import FollowButton from "@/app/showcase/FollowButton";
import { FollowButton as CoupleFollow } from "@/app/couples/[a]/[b]/CoupleActions";
import DealbreakerQuiz from "@/app/episodes/[id]/DealbreakerQuiz";
import EpisodeActions from "@/app/episodes/[id]/EpisodeActions";
import ShowcaseGrid from "@/app/showcase/ShowcaseGrid";
import ShipPage from "@/app/ship/[a]/[b]/page";
import RandomOcGeneratorPage from "@/app/tools/random-oc-generator/page";
import { freshAllowance, ownAllowance } from "@/lib/allowance";
import type { Post } from "@/lib/showcase";

const css = (path: string) => readFileSync(path, "utf8");
/** One rule's body in a stylesheet, by its exact selector. */
const rule = (sheet: string, selector: string) => {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return sheet.slice(at, sheet.indexOf("}", at));
};

describe("the random OC generator is a wide page", () => {
  it("puts .page-wide on its root, so three characters sit across without wrapping their button", async () => {
    const html = renderToStaticMarkup(await RandomOcGeneratorPage({ searchParams: Promise.resolve({}) }));
    expect(html.startsWith('<div class="page-wide random-oc-page">')).toBe(true);
    expect(html).toContain('<ul class="random-oc-list"');
  });
});

describe("the marketing page's numbers", () => {
  // Six until the 2026-11-22 audit cut the page to three: still balanced, now one row of three.
  it("balance across their rows (lib/grid-balance.ts)", () => {
    expect(css("app/marketing/page.tsx")).toMatch(/className="marketing-summary grid-balanced" style=\{\{ "--cols": balancedColumns\(items\.length, 4\) \}/);
  });
});

describe("ship names wrap only between words", () => {
  it("never break a name mid-word: each sizes down to its tile by its longest word", async () => {
    const html = renderToStaticMarkup(await ShipPage({ params: Promise.resolve({ a: "barnaby", b: "juniper" }) }));
    const tiles = [...html.matchAll(/<li data-ship-name="([^"]+)" style="--len:(\d+)">/g)];
    expect(tiles.length).toBeGreaterThan(3);
    for (const [, name, len] of tiles) expect(Number(len), name).toBe(Math.max(...name.split(/[\s-]+/).map((w) => w.length)));
    // Barnaby × Juniper has a twelve-letter name: on a phone the list goes one a row.
    expect(html).toContain('<ol class="ship-names" data-long="1">');
    const sheet = css("app/globals.css");
    const names = rule(sheet, ".ship-names strong");
    expect(names).not.toMatch(/overflow-wrap|word-break/);
    expect(names).toContain("font-size: min(var(--text-xl), calc(140cqi / var(--len, 8)))");
    expect(rule(sheet, ".ship-names li")).toContain("container-type: inline-size");
  });
});

describe("an aired date's own page", () => {
  const props = { episodeId: "e", sharePath: "/e/x", shareBase: "https://botchelor.com", isCreator: false, isHost: false, revealed: true, names: ["Ada", "Bo"] as [string, string], dramaQuestion: null, myPick: null, myDramaPick: null };

  it("doesn't call a speed date's airing \"the finale\" (that's the season's last night)", () => {
    const html = renderToStaticMarkup(createElement(EpisodeActions, props));
    expect(html).not.toMatch(/finale/i);
    expect(html).toContain("This date has aired");
    const offline = renderToStaticMarkup(createElement(EpisodeActions, { ...props, visibility: "private" }));
    expect(offline).not.toMatch(/finale/i);
  });

  it("ends the dealbreaker's sentence once, whether or not the dealbreaker brings its own full stop", () => {
    const said = (answer: string, myPick: string | null) => renderToStaticMarkup(createElement(DealbreakerQuiz, { episodeId: "e", characterName: "Cosmo", options: [answer], myPick, revealed: true, answer, correct: myPick === answer }));
    const stopped = said("Anyone who keeps both feet on the ground at all times.", null);
    expect(stopped).not.toContain("..");
    // Someone who never guessed is told the answer plainly, once (the 2026-11-22 audit: no "You didn't guess this one.").
    expect(stopped).toContain("at all times.</strong></p>");
    expect(said("Liars", null)).toContain("Liars</strong>.</p>");
    expect(said("Who does that?", "Who does that?")).toContain("Who does that?</strong> You picked it");
  });
});

describe("the header's meter", () => {
  it("is the week's allowance until the count is the viewer's own: signed in, a character, a date spent or bought", () => {
    const fresh = freshAllowance();
    expect(ownAllowance(null, false, fresh)).toBe(false);
    // An anonymous id handed out by a read (an episode's thumbs) is not yet anyone's count.
    expect(ownAllowance({ authenticated: false }, false, fresh)).toBe(false);
    expect(ownAllowance({ authenticated: true }, false, fresh)).toBe(true);
    expect(ownAllowance({ authenticated: false }, true, fresh)).toBe(true);
    expect(ownAllowance({ authenticated: false }, false, { ...fresh, free_left: fresh.free_per_season - 1 })).toBe(true);
    expect(ownAllowance({ authenticated: false }, false, { ...fresh, pack_left: 5 })).toBe(true);
    expect(css("app/layout.tsx")).toContain("personal={adHost ? Boolean(viewerId) : ownAllowance(viewer, hasCharacter, dates)}");
  });
});

describe("a disabled filled button", () => {
  it("swaps the gradient for a solid that keeps its label legible, and leaves picked ones alone", () => {
    const sheet = css("app/globals.css");
    expect(rule(sheet, 'button:disabled:not(.chosen, [aria-pressed="true"])')).toContain("--grad: var(--ink);");
  });
});

describe("a creator's page", () => {
  it("shows no follower count before the first follower, here or on a couple's page", () => {
    const none = renderToStaticMarkup(createElement(FollowButton, { handle: "botchelor", followers: 0, following: false }));
    expect(none).not.toMatch(/follower/);
    expect(renderToStaticMarkup(createElement(FollowButton, { handle: "botchelor", followers: 1, following: false }))).toContain(">1 follower<");
    const couple = renderToStaticMarkup(createElement(CoupleFollow, { pair: ["a", "b"], following: false, followers: 0 }));
    expect(couple).not.toMatch(/0 followers/);
    expect(couple).toContain("Hear when they go on another date");
    expect(renderToStaticMarkup(createElement(CoupleFollow, { pair: ["a", "b"], following: false, followers: 3 }))).toContain("3 followers · hear when");
  });

  const post = (id: string, o: Partial<Post> = {}): Post => ({
    id, source: "after_dark", media_id: "m", mime: "video/mp4", rating: "pg", medium: "clip", aspect: null, act: null, place: null, pov: false, from_date: false, caption: null, status: "live",
    published_at: "", mine: false, creator: { handle: "botchelor", display_name: "Botchelor" }, character: { id: `c-${id}`, name: `Name ${id}` }, partner: null, likes: 0, liked: false, remixable: false, ...o,
  });

  it("drops a made-in caption every tile shares (a page of Studio clips), and keeps it where the kinds differ", () => {
    const same = renderToStaticMarkup(createElement(ShowcaseGrid, { posts: [post("1"), post("2"), post("3")] }));
    expect(same).not.toContain("Studio clip");
    expect(same).not.toContain("showcase-meta");
    expect(same).toContain("<strong>Name 1</strong>");
    const mixed = renderToStaticMarkup(createElement(ShowcaseGrid, { posts: [post("1"), post("2", { from_date: true })] }));
    expect(mixed).toContain("Studio clip");
    // Another creator's tiles still say whose they are.
    const theirs = renderToStaticMarkup(createElement(ShowcaseGrid, { posts: [post("1", { creator: { handle: "mara", display_name: "Mara" } }), post("2", { creator: { handle: "mara", display_name: "Mara" } })] }));
    expect(theirs).toContain('<p class="showcase-meta small muted">by <a href="/creators/mara">@mara</a></p>');
  });
});
