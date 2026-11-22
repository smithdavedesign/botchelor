// The header's date meter (app/Nav.tsx): the viewer's own count, or, with no identity (a newcomer before their first
// action, or an agent reading a page, whose dates live on its MCP identity), the weekly allowance said as such. Run
// 2026-10-22-0215: an agent with 1 date left read "3 dates left" on an episode page it fetched.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import Nav from "@/app/Nav";
import ShowTabs from "@/app/ShowTabs";
import CharactersTabs from "@/app/characters/CharactersTabs";
import StudioTabs from "@/app/studio/StudioTabs";
import { navChatOn } from "@/lib/nav-chat";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const pill = (props: Parameters<typeof Nav>[0]) => {
  const html = renderToStaticMarkup(createElement(Nav, props));
  return html.match(/<a[^>]*class="token-pill[^"]*"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the header's date meter", () => {
  it("shows a viewer's own dates left, warning when they're low", () => {
    expect(text(pill({ tokens: 2 }))).toBe("2 dates left");
    expect(text(pill({ tokens: 1, personal: true }))).toBe("1 date left");
    expect(pill({ tokens: 1 })).toMatch(/class="token-pill token-pill--dates low"/);
    expect(pill({ tokens: 0 })).toMatch(/class="token-pill token-pill--dates empty"/);
  });

  // Two meters, two units (design system, 2026-11-11): the show's dates are a clapper on an outline pill; After Dark's
  // tokens are ◈ on a night pill. Never the same pill with a different word.
  it("draws the show's dates as a clapper and After Dark's tokens as ◈ on the night pill", () => {
    const dates = pill({ tokens: 2 });
    expect(dates).toContain('class="icon token-pip"');
    expect(dates).not.toContain("◈");
    const tokens = pill({ tokens: 2, meter: "tokens" });
    expect(tokens).toContain('class="token-pill token-pill--tokens"');
    expect(text(tokens)).toBe("◈ 2 tokens");
  });

  // The 2026-11-11 review: a locked After Dark screen (its Subscribe page, a locked Short) showed "◈ 0 tokens" to someone
  // with nothing to spend them on. On After Dark's host the meter shows only to someone it's open to (app/layout.tsx).
  it("shows no meter where it's \"none\": After Dark's host, for someone it isn't open to", async () => {
    expect(pill({ tokens: 0, meter: "none", personal: true })).toBe("");
    expect(pill({ tokens: 3, meter: "none", personal: false })).toBe("");
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync("app/layout.tsx", "utf8");
    // Nor to an admin, whose spends are free: a red "◈ 0" read as broke (audit 2026-11-22).
    expect(layout).toContain('meter={count.failed ? "none" : adHost ? (viewerId && afterDark && !door.admin ? "tokens" : "none") : "dates"}');
  });

  // #1962: the meter's count is the root layout's one read without a fallback of its own. When it fails (the pool busy,
  // #1948) the meter is left out for that page, never the whole frame failing, nor a full count that isn't theirs.
  it("is left out when its count doesn't load, rather than the page failing", async () => {
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/episodeAllowance\(db, viewerId\)\.then\(\s*\(allowance\) => \(\{ allowance, failed: false \}\),\s*\(err: unknown\) => \{[\s\S]*?return \{ allowance: freshAllowance\(\), failed: true \};/);
  });

  it("without an identity, says the weekly allowance, not someone's count", () => {
    const html = pill({ tokens: 3, personal: false });
    expect(text(html)).toBe("3 free dates");
    expect(html).not.toMatch(/dates? left/);
    expect(html).toContain("Everyone gets 3 free dates a week");
    expect(html).toContain('href="/shop"');
  });

  // 2026-11-22: below 1180px the word went and a phone's header read "🎬 3", whose meaning was only in a tooltip that
  // touch never shows. Now the word shortens ("3 free", "3 dates") and the link's label says it whole.
  it("keeps a short word where the bar is narrow, and says the whole of it to a screen reader", () => {
    const fresh = pill({ tokens: 3, personal: false });
    expect(fresh).toContain('aria-label="3 free dates"');
    expect(fresh).toContain('<span class="token-word">free<span class="token-word-long"> dates</span></span>');
    const mine = pill({ tokens: 1, personal: true });
    expect(mine).toContain('aria-label="1 date left"');
    expect(mine).toContain('<span class="token-word">date<span class="token-word-long"> left</span></span>');
    const css = readFileSync("app/globals.css", "utf8");
    const narrow = css.slice(css.indexOf("@media (max-width: 1180px)"));
    expect(narrow).toMatch(/^[^]*?\.nav \.token-word-long,\s*\.nav \.token-pill--tokens \.token-word \{\s*display: none;/);
    expect(narrow.slice(0, narrow.indexOf("\n}\n"))).not.toMatch(/\.nav \.token-word \{\s*display: none/);
  });
});

// Three doors and the account, the same for everyone (2026-11-15, lib/nav-chat.ts): Watch · Chat · Characters ·
// Account. Chat is one door for every thread: what was Dating (/matches, the deck, a thread) and what was Companions
// (/companion). The show's other rooms live under Watch, on the ShowTabs strip: Watch · House · Season.
describe("the nav: Watch · Chat · Characters · Account", () => {
  const labels = (html: string) => [...(html.match(/<div id="nav-menu"[\s\S]*$/)?.[0] ?? "").matchAll(/<a[^>]*href="(\/[a-z]*)"[^>]*>([A-Z][a-z]+)/g)].map((m) => `${m[2]} ${m[1]}`);

  it("shows the same doors to someone with a character and to a newcomer, who also gets the create button", () => {
    const owner = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true }));
    expect(labels(owner).slice(0, 5)).toEqual(["Watch /watch", "Chat /chat", "Characters /characters", "Studio /studio", "Account /account"]);
    for (const gone of ["/graph", "/showcase", "/swipe", "/companion", "/matches"]) expect(owner).not.toContain(`href="${gone}"`);
    expect(owner).not.toContain("Dating");
    const newcomer = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: false }));
    expect(newcomer).toMatch(/<a[^>]*href="\/chat"[^>]*>Chat/);
    expect(newcomer).toContain('href="/create"');
    // Companions is no sub-link any more, open or not.
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, companions: true }))).not.toContain("nav-sub");
  });

  it("puts one number on Chat: unread texts of both kinds", () => {
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, texts: 4 }));
    expect(html).toMatch(/<a[^>]*href="\/chat"[^>]*>Chat<span class="nav-count" aria-label="4 unread texts">4<\/span><\/a>/);
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 3, texts: 0 }))).not.toMatch(/Chat<span class="nav-count"/);
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 3, texts: 120 }))).toContain(">99+</span>");
    // The layout counts both kinds for it (lib/inbox.ts unreadChatTexts).
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("(navChat ? unreadChatTexts(db, viewerId) : unreadTexts(db, viewerId))");
  });

  it("NAV_CHAT=0 (chat: false) is the header as it was: Dating for someone with a character, none for a newcomer, Companions under Characters", () => {
    const owner = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, chat: false, companions: true, texts: 2 }));
    expect(owner).toMatch(/<a[^>]*href="\/matches"[^>]*>Dating<span class="nav-count"/);
    expect(owner).toMatch(/href="\/characters">Characters<\/a><a class="nav-sub" href="\/companion">Companions<\/a>/);
    expect(owner).not.toContain('href="/chat"');
    const newcomer = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: false, chat: false }));
    expect(newcomer).not.toContain('href="/matches"');
    expect(navChatOn({})).toBe(true);
    expect(navChatOn({ NAV_CHAT: "1" })).toBe(true);
    expect(navChatOn({ NAV_CHAT: "0" })).toBe(false);
  });
});

describe("the show's tabs: Watch · House · Season", () => {
  const strip = (active: Parameters<typeof ShowTabs>[0]["active"]) => renderToStaticMarkup(createElement(ShowTabs, { active }));
  const tabs = (html: string) => [...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => `${m[2]} ${m[1]}`);
  const current = (html: string) => /aria-current="page"[^>]*>([^<]+)</.exec(html)?.[1] ?? null;
  afterEach(() => vi.unstubAllEnvs());

  it("carries the house, and no longer Reviews or the Constellation", () => {
    expect(tabs(strip("/watch"))).toEqual(["Watch /watch", "House /house", "Season /reunion", "Shows /shows"]);
    expect(current(strip("/shows"))).toBe("Shows");
    // The fourth tab is the show ideas' (lib/show-ideas.ts): gone with its switch.
    vi.stubEnv("SHOW_IDEAS", "0");
    expect(tabs(strip("/watch"))).toEqual(["Watch /watch", "House /house", "Season /reunion"]);
    vi.unstubAllEnvs();
    expect(current(strip("/watch"))).toBe("Watch");
    expect(current(strip("/house"))).toBe("House");
    expect(current(strip("/reunion"))).toBe("Season");
  });

  it("Reels left both strips for the Studio door (2026-11-16): the Gallery and My studio, one place to show and make", () => {
    const gallery = renderToStaticMarkup(createElement(StudioTabs, { current: "gallery" }));
    expect(tabs(gallery)).toEqual(["Gallery /showcase", "My studio /studio"]);
    expect(current(gallery)).toBe("Gallery");
    expect(current(renderToStaticMarkup(createElement(StudioTabs, { current: "studio" })))).toBe("My studio");
    const page = readFileSync("app/showcase/page.tsx", "utf8");
    expect(page).toContain('<StudioTabs current="gallery" />');
    expect(page).not.toContain("<ShowTabs");
    expect(page).not.toContain("<CharactersTabs");
    // The old address of a character's Studio goes to the new place with that character picked.
    // (Its query travels too: tests/route-drift.test.ts.)
    expect(readFileSync("app/characters/[id]/studio/page.tsx", "utf8")).toContain("redirect(`/studio?${query.toString()}`)");
  });

  it("Characters' tabs are who's here: Yours first for an owner, absent for anyone else; no Text someone, no Reels", () => {
    const render = (props: Parameters<typeof CharactersTabs>[0]) => renderToStaticMarkup(createElement(CharactersTabs, props)).replace(/&#x27;/g, "'");
    const owner = render({ current: "yours", companions: true, yours: true });
    expect(tabs(owner)).toEqual(["Yours /characters?tab=yours", "People's /characters?tab=people", "The cast /characters", "Originals /characters?tab=originals", "AI agents /characters?tab=agents"]);
    expect(current(owner)).toBe("Yours");
    const visitor = render({ current: "cast", companions: true });
    expect(tabs(visitor)).toEqual(["People's /characters?tab=people", "The cast /characters", "Originals /characters?tab=originals", "AI agents /characters?tab=agents"]);
    expect(current(visitor)).toBe("The cast");
  });

  it("still takes Reviews, which marks none; the Constellation wears Characters' Cards | Map switch instead", () => {
    expect(current(strip("/reviews"))).toBeNull();
    expect(current(strip("/graph"))).toBeNull();
    expect(readFileSync("app/house/page.tsx", "utf8")).toContain('<ShowTabs active="/house" />');
    expect(readFileSync("app/reviews/page.tsx", "utf8")).toContain('<ShowTabs active="/reviews" />');
    const graph = readFileSync("app/graph/page.tsx", "utf8");
    expect(graph).not.toContain("<ShowTabs");
    expect(graph).toContain('<ViewSwitch current="map" group={origin} />');
  });

  it("keeps Reviews and the Constellation reachable from /everything", () => {
    const everything = readFileSync("app/everything/page.tsx", "utf8");
    for (const href of ["/reviews", "/graph"]) expect(everything).toContain(`<Link href="${href}">`);
  });

  it("NAV_CHAT=0 brings the old strip back", () => {
    vi.stubEnv("NAV_CHAT", "0");
    expect(tabs(strip("/graph"))).toEqual(["Watch /watch", "Reels /showcase", "Reunion /reunion", "Reviews /reviews", "Constellation /graph", "Shows /shows"]);
    expect(current(strip("/graph"))).toBe("Constellation");
    expect(current(strip("/house"))).toBeNull();
  });
});
