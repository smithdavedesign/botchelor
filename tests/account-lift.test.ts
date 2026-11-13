import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountCharacterTile } from "@/app/account/AccountPanel";
import { DateRow } from "@/app/account/YourDates";

vi.mock("next/navigation", async (original) => ({ ...((await original()) as object), useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/account" }));

/** The account page's lists (2026-11-13 design lift): a character is a tile with one main action; a date is one row. */
describe("your characters as tiles", () => {
  const html = renderToStaticMarkup(createElement("ul", null, createElement(AccountCharacterTile, { c: { id: "c1", name: "Ambrose Fenn", hue: 200, portrait: "/api/assets/p1" } })));

  it("shows the face, the name, Send on a date as the one button, and Matches, Swipe and Edit as quiet links", () => {
    expect(html).toContain('class="account-character card"');
    expect(html).toContain('width="56"');
    expect(html).toContain("Ambrose Fenn");
    expect(html).toContain('class="button small account-character-go"');
    expect(html).toContain('href="/create?character=c1"');
    expect(html).toContain('href="/matches?character=c1"');
    expect(html).toContain('href="/swipe?character=c1"');
    expect(html).toContain('href="/characters/c1/edit"');
    expect(html).toContain('href="/characters/c1"');
  });
});

describe("your dates as rows", () => {
  const side = (id: string, name: string) => ({ id, name, hue: 120, house: false, portrait: null });
  const date = (is_host: boolean) => ({ episode_id: "e1", share_path: "/episodes/e1", title: "Ambrose Fenn × Nell Abiodun", visibility: "public" as const, is_host, a: side("c1", "Ambrose Fenn"), b: side("c2", "Nell Abiodun") });

  it("a date you host: two faces, the title, and who sees it as a small select of one word each", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(DateRow, { e: date(true), onVisibility: () => {} })));
    expect(html).toContain('class="account-date"');
    expect(html).toContain('class="pair-faces"');
    expect((html.match(/width="32"/g) ?? []).length).toBe(2);
    expect(html).toContain('class="account-date-title"');
    expect(html).toContain('class="visibility-chip"');
    expect(html).toContain('aria-label="Who sees Ambrose Fenn × Nell Abiodun"');
    expect(html).toContain('<option value="public" selected="">Public</option>');
    expect(html).toContain('<option value="unlisted">Unlisted</option>');
    expect(html).toContain('<option value="private">Private</option>');
    expect(html).not.toContain("in the feed");
  });

  it("a date of your character's that someone else hosts: the word as a chip", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(DateRow, { e: date(false), onVisibility: () => {} })));
    expect(html).toContain('class="chip account-date-chip"');
    expect(html).not.toContain("<select");
  });
});
