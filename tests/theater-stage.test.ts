import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Scene from "@/app/Scene";
import { bigLine, speakerOf } from "@/lib/theater-beats";
import type { CharacterRef } from "@/lib/game";

// The date theater, staged (2026-11-28, Dave: "both characters on both sides ... Do 1-5"): app/ux/theater-stage.css,
// app/Scene.tsx's `staged`, lib/theater-beats.ts.
const ROOT = join(__dirname, "..");
const css = readFileSync(join(ROOT, "app/ux/theater-stage.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function outsideMotionBlocks(text: string): string {
  let out = "";
  let i = 0;
  const open = "@media (prefers-reduced-motion: no-preference)";
  while (i < text.length) {
    const at = text.indexOf(open, i);
    if (at < 0) return out + text.slice(i);
    out += text.slice(i, at);
    let j = text.indexOf("{", at);
    let depth = 0;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

const char = (id: string, name: string, extra: Partial<CharacterRef> = {}): CharacterRef => ({ id, name, house: false, hue: 200, portrait: null, ...extra });
const turn = (side: "a" | "b", interest: number, more: object = {}) => ({ side, interest, ...more });

describe("the staged theater", () => {
  it("moves nothing outside a no-preference block", () => {
    expect(outsideMotionBlocks(css)).not.toMatch(/(^|[\s;{])(animation|transition)\s*:/);
  });

  it("pushes in on a walk-out, a move, or a swing in someone's interest, and not on a steady line", () => {
    expect(bigLine([])).toBe(false);
    expect(bigLine([turn("a", 0.5)])).toBe(false);
    expect(bigLine([turn("a", 0.5), turn("b", 0.5), turn("a", 0.55)])).toBe(false);
    expect(bigLine([turn("a", 0.5), turn("b", 0.5), turn("a", 0.8)])).toBe(true);
    expect(bigLine([turn("a", 0.5), turn("b", 0.5), turn("a", 0.2)])).toBe(true);
    expect(bigLine([turn("a", 0.5), turn("b", 0.5, { walked_out: true })])).toBe(true);
    expect(bigLine([turn("a", 0.5, { moved_to: "rooftop" })])).toBe(true);
    expect(speakerOf([])).toBe(null);
    expect(speakerOf([turn("a", 0.5), turn("b", 0.5)])).toBe("b");
  });

  it("stands both of them as figures with captions, and keeps the avatars when it isn't staged", () => {
    const characters: [CharacterRef, CharacterRef] = [
      char("a", "Mara Vey", { portrait: "/cast/house-mara-v1.webp", figure: "/cast/stage-mara-v1.webp" }),
      char("b", "Dex Marlow", { portrait: "/api/assets/abc" }),
    ];
    const staged = renderToStaticMarkup(
      createElement(Scene, { characters, venue: null, lineA: "Hi.", lineB: null, actLabel: "The challenge", moodA: "/api/shots/x", staged: { speaking: "a", act: 1, push: true } }),
    );
    expect(staged).toContain('data-speaking="a"');
    expect(staged).toContain('data-act="1"');
    expect(staged).toContain('data-push="true"');
    expect(staged.match(/data-standing="true"/g)?.length).toBe(2);
    expect(staged).toContain('src="/cast/stage-mara-v1.webp"');
    expect(staged).toContain('data-figure="portrait"');
    expect(staged).toContain('class="scene-closeup"');
    expect(staged).toContain('class="scene-title-card"');
    const plain = renderToStaticMarkup(createElement(Scene, { characters, venue: null, lineA: "Hi.", lineB: null }));
    expect(plain).not.toContain("data-staged");
    expect(plain).not.toContain("character-figure");
  });

  it("keeps the avatar for someone with no picture at all, even on the staged stage", () => {
    const html = renderToStaticMarkup(
      createElement(Scene, { characters: [char("a", "Mara"), char("b", "Dex")], venue: null, lineA: null, lineB: null, staged: { speaking: null, act: 0, push: false } }),
    );
    expect(html).not.toContain("data-standing");
    expect(html).toContain("avatar");
  });
});
