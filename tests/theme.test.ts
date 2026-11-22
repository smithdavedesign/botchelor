// The theme preference (lib/theme.ts; docs/brand.md, Themes) and the header the design system settled on
// (2026-11-11): five kinds of thing, the After Dark door as a link in the tools, "Back to the show" on its host.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Nav from "@/app/Nav";
import ThemeSetting from "@/app/ThemeSetting";
import { themeAttribute, themeFromCookie } from "@/lib/theme";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The declarations inside the first `{ … }` that follows `selector`, one per line, trimmed. */
function block(selector: string): string[] {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} is in globals.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", at + selector.length);
  let depth = 1;
  let i = open + 1;
  for (; i < CSS.length && depth > 0; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") depth--;
  }
  return CSS.slice(open + 1, i - 1)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("/*") && !l.startsWith("*"));
}

describe("the theme preference", () => {
  it("reads a pick from the cookie and treats everything else as the system's", () => {
    expect(themeFromCookie("light")).toBe("light");
    expect(themeFromCookie("dark")).toBe("dark");
    for (const v of ["system", "", undefined, null, "DARK", "auto"]) expect(themeFromCookie(v)).toBe("system");
  });

  it("writes <html data-theme> only for a pick, so the stylesheet's own dark rules carry the system's", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });

  it("keeps the system's dark tokens and the picked dark tokens identical", () => {
    const system = block(':root:not([data-theme="light"])');
    const picked = block(':root[data-theme="dark"]');
    expect(system.length).toBeGreaterThan(20);
    expect(picked).toEqual(system);
    // A viewer who picked Light never gets the dark tokens, whatever the device says.
    expect(CSS).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/);
  });

  it("offers Light, Dark and System on the account page, open on the current pick", () => {
    const html = renderToStaticMarkup(createElement(ThemeSetting, { initial: "dark" }));
    for (const label of ["Light", "Dark", "System"]) expect(html).toContain(label);
    const radio = (value: string) => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0] ?? "";
    expect(radio("dark")).toContain('checked=""');
    expect(radio("light")).not.toContain("checked");
    expect(radio("system")).not.toContain("checked");
  });
});

describe("the header's tools", () => {
  it("has the After Dark door as a link in the tools, not among the links, and never a toggle", () => {
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, afterDark: true }));
    const tools = html.match(/<div class="nav-tools">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(tools).toMatch(/<a[^>]*class="nav-ad-link"[^>]*href="[^"]*\/after-dark"/);
    expect(tools).toContain("After Dark");
    expect(html).not.toContain("nav-after-dark");
    expect(html).not.toMatch(/role="switch"/);
  });

  it("on After Dark's host turns the door into the way back and drops the create button", () => {
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, meter: "tokens", adHost: true, hasCharacter: false }));
    expect(html).toContain("Back to the show");
    expect(html).not.toContain("nav-cta");
  });

  it("gives a newcomer one call to action in the bar, in words and as the compact plus", () => {
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, hasCharacter: false }));
    expect(html).toMatch(/class="button nav-cta nav-cta-full"[^>]*href="\/create"/);
    expect(html).toMatch(/class="button nav-cta nav-cta-compact"[^>]*aria-label="Make your character"/);
  });

  // One loud button a screen (2026-11-22 audit): the bar's call to action was filled, a twin of every page's own next
  // step (home's "Meet them", /shop's Buy, /pricing's upgrade). In the bar it's the outline button now, the same size.
  it("draws the bar's call to action as the outline button, never filled", () => {
    const cta = block(".nav a.nav-cta,");
    expect(cta).toContain("background: transparent;");
    expect(cta).toContain("border: 1.5px solid var(--accent);");
    expect(cta).toContain("color: var(--accent-text);");
    expect(cta).toContain("box-shadow: none;");
    expect(cta.join(" ")).not.toContain("var(--grad)");
    // The border comes out of the padding, so the pill keeps its size.
    expect(cta).toContain("padding: calc(0.4rem - 1.5px) calc(0.9rem - 1.5px);");
    expect(block(".nav a.nav-cta:hover,")).toContain("background: var(--soft);");
  });

  // A phone's meter read only "3" (2026-11-22 audit): its word was display: none under 1180px, gone for a screen reader
  // too. It's out of sight there now but in the link's name, and back in sight for a newcomer once the links fold.
  it("keeps the meter's word in its name when narrow, and shows it to a newcomer on a phone", () => {
    expect(block("  .nav .token-word")).toEqual(["position: absolute;", "width: 1px;", "height: 1px;", "padding: 0;", "margin: -1px;", "overflow: hidden;", "clip: rect(0, 0, 0, 0);", "white-space: nowrap;", "border: 0;"]);
    expect(CSS).not.toMatch(/\.nav \.token-word \{\s*display: none;/);
    const phone = CSS.slice(CSS.indexOf("@media (max-width: 900px) {"));
    expect(phone).toMatch(/\.nav:not\(:has\(\.char-picker\)\) a\.token-pill--dates \.token-word \{\s*position: static;/);
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 3, personal: false, hasCharacter: false }));
    expect(html).toMatch(/<span class="token-word">free dates<\/span>/);
  });
});
