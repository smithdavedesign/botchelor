// The directory of who can be texted is one obvious click from Characters (David, 2026-11-11: "Is it hard to get to
// the companion page now?" → yes, a footer link and a line under the tabs). It's Characters' fourth tab on /characters
// and on /companion itself. Since 2026-11-15 (lib/nav-chat.ts) the tab says what it does, "Text someone", and the
// header's door to every thread is Chat; with NAV_CHAT=0 the tab is "Companions" and the phone menu lists it again.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CharactersTabs from "@/app/characters/CharactersTabs";
import Nav from "@/app/Nav";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

describe("Characters' tabs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("carry a fourth tab that says what it does, Text someone, when companions are open (Reels is the fifth since 2026-11-16)", () => {
    const html = renderToStaticMarkup(createElement(CharactersTabs, { current: "cast", companions: true }));
    expect(html.match(/class="segmented-tab"/g)).toHaveLength(5);
    expect(html).toMatch(/<a class="segmented-tab" href="\/companion">Text someone<\/a><a class="segmented-tab" href="\/showcase">Reels<\/a><\/nav>$/);
    expect(html).not.toContain("Companions");
    expect(html).toMatch(/aria-current="page" href="\/characters">The cast/);
  });

  it("mark it current on the directory and leave it out when companions are closed", () => {
    const here = renderToStaticMarkup(createElement(CharactersTabs, { current: "companions", companions: true }));
    expect(here).toMatch(/aria-current="page" href="\/companion">Text someone/);
    expect(here).not.toMatch(/aria-current="page" href="\/characters"/);
    const closed = renderToStaticMarkup(createElement(CharactersTabs, { current: "cast", companions: false }));
    expect(closed).not.toContain('href="/companion"');
  });

  it("NAV_CHAT=0: the tab is Companions again", () => {
    vi.stubEnv("NAV_CHAT", "0");
    expect(renderToStaticMarkup(createElement(CharactersTabs, { current: "cast", companions: true }))).toMatch(/href="\/companion">Companions<\/a><a class="segmented-tab" href="\/showcase">Reels<\/a><\/nav>$/);
  });
});

describe("the header with companions open", () => {
  it("has no sub-link: Chat is the door, and it's current on the directory", () => {
    nav.path = "/companion";
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, companions: true }));
    expect(html).not.toContain('href="/companion"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Chat/);
    expect(html).not.toMatch(/<a[^>]*aria-current="page"[^>]*>Characters/);
    nav.path = "/";
  });

  it("NAV_CHAT=0: four doors, the directory under Characters for the phone menu, Characters current on it", () => {
    nav.path = "/";
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, companions: true, chat: false }));
    expect(html).toMatch(/href="\/characters">Characters<\/a><a class="nav-sub" href="\/companion">Companions<\/a>/);
    const off = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, chat: false }));
    expect(off).not.toContain('href="/companion"');
    nav.path = "/companion";
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, companions: true, chat: false }))).toMatch(/<a[^>]*aria-current="page"[^>]*>Characters/);
    nav.path = "/";
  });

  it("hides the sub-link in the desktop bar and shows it in the folded menu", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const phone = css.indexOf("@media (max-width: 900px)");
    const hidden = css.indexOf(".nav-links a.nav-sub {\n  display: none;");
    const shown = css.indexOf(".nav-links a.nav-sub {\n    display: block;");
    expect(hidden).toBeGreaterThan(-1);
    expect(hidden).toBeLessThan(phone);
    expect(shown).toBeGreaterThan(phone);
  });
});
