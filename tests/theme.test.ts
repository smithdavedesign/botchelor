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
});
