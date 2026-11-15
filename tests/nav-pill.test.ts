// The header's date meter (app/Nav.tsx): the viewer's own count, or, with no identity (a newcomer before their first
// action, or an agent reading a page, whose dates live on its MCP identity), the weekly allowance said as such. Run
// 2026-10-22-0215: an agent with 1 date left read "3 dates left" on an episode page it fetched.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import Nav from "@/app/Nav";
import ShowTabs from "@/app/ShowTabs";
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
    expect(layout).toContain('meter={adHost ? (viewerId && afterDark ? "tokens" : "none") : "dates"}');
  });

  it("without an identity, says the weekly allowance, not someone's count", () => {
    const html = pill({ tokens: 3, personal: false });
    expect(text(html)).toBe("3 free dates");
    expect(html).not.toMatch(/dates? left/);
    expect(html).toContain("Everyone gets 3 free dates a week");
    expect(html).toContain('href="/shop"');
  });
});

// Three doors and the account, the same for everyone (2026-11-15, lib/nav-chat.ts): Watch · Chat · Characters ·
// Account. Chat is one door for every thread: what was Dating (/matches, the deck, a thread) and what was Companions
// (/companion). The show's other rooms live under Watch, on the ShowTabs strip: Watch · House · Reels · Reunion.
describe("the nav: Watch · Chat · Characters · Account", () => {
  const labels = (html: string) => [...(html.match(/<div id="nav-menu"[\s\S]*$/)?.[0] ?? "").matchAll(/<a[^>]*href="(\/[a-z]*)"[^>]*>([A-Z][a-z]+)/g)].map((m) => `${m[2]} ${m[1]}`);

  it("shows the same doors to someone with a character and to a newcomer, who also gets the create button", () => {
    const owner = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true }));
    expect(labels(owner).slice(0, 4)).toEqual(["Watch /watch", "Chat /chat", "Characters /characters", "Account /account"]);
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

describe("the show's tabs: Watch · House · Reels · Reunion", () => {
  const strip = (active: Parameters<typeof ShowTabs>[0]["active"]) => renderToStaticMarkup(createElement(ShowTabs, { active }));
  const tabs = (html: string) => [...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => `${m[2]} ${m[1]}`);
  const current = (html: string) => /aria-current="page"[^>]*>([^<]+)</.exec(html)?.[1] ?? null;
  afterEach(() => vi.unstubAllEnvs());

  it("carries the house, and no longer Reviews or the Constellation", () => {
    expect(tabs(strip("/watch"))).toEqual(["Watch /watch", "House /house", "Reels /showcase", "Reunion /reunion"]);
    expect(current(strip("/watch"))).toBe("Watch");
    expect(current(strip("/house"))).toBe("House");
    expect(current(strip("/showcase"))).toBe("Reels");
  });

  it("still takes the two pages that left it: the Constellation reads as the house's, Reviews marks none", () => {
    expect(current(strip("/graph"))).toBe("House");
    expect(current(strip("/reviews"))).toBeNull();
    // Both pages still wear the strip, and /house does now.
    expect(readFileSync("app/house/page.tsx", "utf8")).toContain('<ShowTabs active="/house" />');
    expect(readFileSync("app/graph/page.tsx", "utf8")).toContain('<ShowTabs active="/graph" />');
    expect(readFileSync("app/reviews/page.tsx", "utf8")).toContain('<ShowTabs active="/reviews" />');
  });

  it("keeps Reviews and the Constellation reachable from /everything", () => {
    const everything = readFileSync("app/everything/page.tsx", "utf8");
    for (const href of ["/reviews", "/graph"]) expect(everything).toContain(`<Link href="${href}">`);
  });

  it("NAV_CHAT=0 brings the old strip back", () => {
    vi.stubEnv("NAV_CHAT", "0");
    expect(tabs(strip("/graph"))).toEqual(["Watch /watch", "Reels /showcase", "Reunion /reunion", "Reviews /reviews", "Constellation /graph"]);
    expect(current(strip("/graph"))).toBe("Constellation");
    expect(current(strip("/house"))).toBeNull();
  });
});
