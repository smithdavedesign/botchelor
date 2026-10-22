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
    expect(text(pill({ tokens: 2 }))).toBe("◈ 2 dates left");
    expect(text(pill({ tokens: 1, personal: true }))).toBe("◈ 1 date left");
    expect(pill({ tokens: 1 })).toContain('class="token-pill low"');
    expect(pill({ tokens: 0 })).toContain('class="token-pill empty"');
  });

  it("without an identity, says the weekly allowance, not someone's count", () => {
    const html = pill({ tokens: 3, personal: false });
    expect(text(html)).toBe("◈ 3 free dates");
    expect(html).not.toMatch(/dates? left/);
    expect(html).toContain("Everyone gets 3 free dates a week");
    expect(html).toContain('href="/shop"');
  });
});
