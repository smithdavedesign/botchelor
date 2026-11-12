// The companions' directory is one obvious click from Characters (David, 2026-11-11: "Is it hard to get to the
// companion page now?" → yes, a footer link and a line under the tabs). It's Characters' fourth tab on /characters and
// on /companion itself, and on a phone the menu lists it under Characters. The header keeps its four doors.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CharactersTabs from "@/app/characters/CharactersTabs";
import Nav from "@/app/Nav";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

describe("Characters' tabs", () => {
  it("carry a fourth tab, Companions, when companions are open", () => {
    const html = renderToStaticMarkup(createElement(CharactersTabs, { current: "cast", companions: true }));
    expect(html.match(/class="segmented-tab"/g)).toHaveLength(4);
    expect(html).toMatch(/<a class="segmented-tab" href="\/companion">Companions<\/a><\/nav>$/);
    expect(html).toMatch(/aria-current="page" href="\/characters">The cast/);
  });

  it("mark Companions current on the directory and leave it out when companions are closed", () => {
    const here = renderToStaticMarkup(createElement(CharactersTabs, { current: "companions", companions: true }));
    expect(here).toMatch(/aria-current="page" href="\/companion">Companions/);
    expect(here).not.toMatch(/aria-current="page" href="\/characters"/);
    const closed = renderToStaticMarkup(createElement(CharactersTabs, { current: "cast", companions: false }));
    expect(closed).not.toContain('href="/companion"');
  });
});

describe("the header with companions open", () => {
  it("keeps four doors and lists the directory under Characters for the phone menu", () => {
    nav.path = "/";
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, companions: true }));
    expect(html).toMatch(/href="\/characters">Characters<\/a><a class="nav-sub" href="\/companion">Companions<\/a>/);
    const off = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true }));
    expect(off).not.toContain('href="/companion"');
  });

  it("shows Characters as the current door on the directory", () => {
    nav.path = "/companion";
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: true, companions: true }));
    expect(html).toMatch(/aria-current="page"[^>]*>Characters<|href="\/characters" aria-current="page">Characters</);
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
