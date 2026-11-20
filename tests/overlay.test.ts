/**
 * One overlay primitive (2026-11-20 mobile audit, pattern 2): hand-made menus and popovers lock the page behind, make it
 * inert, close on Escape and carry a 44px ✕ (app/useOverlay.ts, app/OverlayClose.tsx), like the show's own Sheet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inertOutside, type InertNode } from "@/app/useOverlay";

type Fake = InertNode & { name: string; children: Fake[]; parentElement: Fake | null; attrs: Set<string> };
function el(name: string, tagName = "DIV", kids: Fake[] = [], attrs: string[] = []): Fake {
  const n: Fake = { name, tagName, inert: false, children: kids, parentElement: null, attrs: new Set(attrs), hasAttribute: (a) => n.attrs.has(a) };
  for (const k of kids) k.parentElement = n;
  return n;
}

describe("inertOutside", () => {
  // body > [header > [logo, menu > [button, panel]], main, script, dialog[open], toast(inert already)]
  const panel = el("panel");
  const button = el("button", "BUTTON");
  const menu = el("menu", "SPAN", [button, panel]);
  const logo = el("logo", "A");
  const header = el("header", "HEADER", [logo, menu]);
  const main = el("main", "MAIN");
  const script = el("script", "SCRIPT");
  const dialog = el("dialog", "DIALOG", [], ["open"]);
  const toast = el("toast");
  toast.inert = true;
  const body = el("body", "BODY", [header, main, script, dialog, toast]);
  el("html", "HTML", [body]);

  it("makes everything but the overlay and what holds it inert, and the undo clears only what it set", () => {
    const undo = inertOutside(menu);
    expect([logo, main].every((n) => n.inert)).toBe(true);
    // The overlay, its button and its ancestors stay live; a script, an open native dialog are left alone.
    expect([menu, button, panel, header, body, script, dialog].some((n) => n.inert)).toBe(false);
    undo();
    expect([logo, main].some((n) => n.inert)).toBe(false);
    // Inert before it opened, inert after.
    expect(toast.inert).toBe(true);
  });
});

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("the overlays on it", () => {
  const ON = [
    "app/CharacterPicker.tsx",
    "app/couples/[a]/[b]/ThreadMenu.tsx",
    "app/ShareButton.tsx",
    "app/episodes/[id]/EpisodeTheater.tsx",
    "app/AgeGate.tsx",
  ];
  it.each(ON)("%s uses useOverlay and no hand-rolled Escape listener", (p) => {
    const src = read(p);
    expect(src).toMatch(/useOverlay\(/);
    expect(src).not.toMatch(/addEventListener\("keydown"/);
  });

  it("menus and popovers carry the ✕", () => {
    for (const p of ["app/CharacterPicker.tsx", "app/couples/[a]/[b]/ThreadMenu.tsx", "app/ShareButton.tsx"]) expect(read(p), p).toMatch(/<OverlayClose /);
  });

  it("the lock and the ✕ are styled: page overflow hidden, a 44px button", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/html\.overlay-open body \{\s*overflow: hidden;/);
    expect(css).toMatch(/button\.overlay-x \{[^}]*width: 44px;[^}]*height: 44px;/);
  });
});
