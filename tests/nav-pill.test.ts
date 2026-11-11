// The header's date meter (app/Nav.tsx): the viewer's own count, or, with no identity (a newcomer before their first
// action, or an agent reading a page, whose dates live on its MCP identity), the weekly allowance said as such. Run
// 2026-10-22-0215: an agent with 1 date left read "3 dates left" on an episode page it fetched.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Nav from "@/app/Nav";

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

  it("without an identity, says the weekly allowance, not someone's count", () => {
    const html = pill({ tokens: 3, personal: false });
    expect(text(html)).toBe("3 free dates");
    expect(html).not.toMatch(/dates? left/);
    expect(html).toContain("Everyone gets 3 free dates a week");
    expect(html).toContain('href="/shop"');
  });
});

// Five doors since the 2026-11-07 product review (David: "do 1-5"): Watch · Dating · Characters · (Companions) ·
// Account. The Constellation and the Showcase moved under Watch — the ShowTabs strip on every spectator surface —
// which supersedes the 2026-11-01 "Constellation stays in the nav" call, with David's sign-off on the review plan.
describe("the five-door nav", () => {
  it("shows the doors and nothing else; Dating is one door at /matches", () => {
    const owner = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true }));
    expect(owner).toMatch(/<a[^>]*href="\/matches"[^>]*>Dating/);
    for (const href of ["/watch", "/characters", "/account"]) expect(owner).toContain(`href="${href}"`);
    for (const gone of ["/graph", "/showcase", "/swipe"]) expect(owner).not.toContain(`href="${gone}"`);
    const newcomer = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: false }));
    expect(newcomer).not.toContain('href="/matches"');
    expect(newcomer).toContain('href="/create"');
  });

  it("keeps the Constellation one tap away: the show strip carries it on every spectator surface", async () => {
    const ShowTabs = (await import("@/app/ShowTabs")).default;
    const strip = renderToStaticMarkup(createElement(ShowTabs, { active: "/watch" }));
    for (const href of ["/watch", "/showcase", "/reunion", "/reviews", "/graph"]) expect(strip).toContain(`href="${href}"`);
    expect(strip).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/watch"/);
  });
});
