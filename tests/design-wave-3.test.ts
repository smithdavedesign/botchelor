// The design system's third wave (2026-11-11; docs/design-system-rollout.md): After Dark's token packs flag the best
// value, once, on the cheapest token the chosen processor sells.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BuyTokens from "@/app/after-dark/tokens/BuyTokens";

const PACKS = [
  { tokens: 10, price: "$9.99", each: "100¢", cents: 100 },
  { tokens: 25, price: "$22.99", each: "92¢", cents: 92 },
  { tokens: 50, price: "$42.99", each: "86¢", cents: 86 },
];
const option = (packs: number[]) => ({ id: "ccbill" as const, label: "CCBill", statement: "Botchelor After Dark", packs });

describe("the token packs' Best value flag", () => {
  it("sits on the cheapest token, once, and reads in the button's name", () => {
    const html = renderToStaticMarkup(createElement(BuyTokens, { packs: PACKS, options: [option([10, 25, 50])] }));
    expect(html.match(/Best value/g)?.length).toBe(1);
    expect(html).toMatch(/data-token-pack="50"[^>]*aria-label="50 tokens for \$42\.99, best value"/);
    expect(html).toMatch(/<button[^>]*class="is-best"[^>]*data-token-pack="50"/);
    expect(html).not.toMatch(/data-token-pack="25"[^>]*best value/);
  });

  it("moves to the cheapest pack the processor actually sells", () => {
    const html = renderToStaticMarkup(createElement(BuyTokens, { packs: PACKS, options: [option([10, 25])] }));
    expect(html).toMatch(/data-token-pack="25"[^>]*aria-label="25 tokens for \$22\.99, best value"/);
    expect(html).not.toMatch(/data-token-pack="50"[^>]*best value/);
  });

  it("flags nothing without prices per token, or with a tie", () => {
    const bare = renderToStaticMarkup(createElement(BuyTokens, { packs: PACKS.map(({ cents: _c, ...p }) => p), options: [option([10, 25, 50])] }));
    expect(bare).not.toContain("Best value");
    const tie = renderToStaticMarkup(createElement(BuyTokens, { packs: PACKS.map((p) => ({ ...p, cents: 90 })), options: [option([10, 25, 50])] }));
    expect(tie).not.toContain("Best value");
  });
});
