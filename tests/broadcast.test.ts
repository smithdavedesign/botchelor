import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TestCard from "@/app/TestCard";
import VoteCast from "@/app/motion/VoteCast";
import SoundToggle from "@/app/motion/SoundToggle";
import { Booth } from "@/app/characters/[id]/Booth";
import { resultHeadline, type CeremonyFace } from "@/lib/ceremony";
import { roseOrder } from "@/lib/ceremony-night";
import { cue, soundOn } from "@/app/motion/cues";

// On the air (2026-11-28, Dave: "Yes do 1-5 and 8"): app/ux/broadcast.css and the pieces it dresses.
const ROOT = join(__dirname, "..");
const css = readFileSync(join(ROOT, "app/ux/broadcast.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet with every `@media (prefers-reduced-motion: no-preference) { … }` block cut out. */
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

const face = (id: string, name: string): CeremonyFace => ({ id, name, hue: 300, portrait: null, house: false });

describe("on the air", () => {
  it("moves nothing outside a no-preference block", () => {
    expect(outsideMotionBlocks(css)).not.toMatch(/(^|[\s;{])(animation|transition)\s*:/);
  });

  it("draws the test card: seven bars, the strip, and the plate", () => {
    const html = renderToStaticMarkup(createElement(TestCard));
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<span><\/span>/g)?.length).toBe(14);
    expect(html).toContain("Please stand by");
  });

  it("says nothing until a vote is cast, and keeps a status region for it", () => {
    const html = renderToStaticMarkup(createElement(VoteCast, { pick: "a" }));
    expect(html).toBe('<span class="vote-cast" role="status"></span>');
  });

  it("keeps sound off by default, and a cue with sound off is silent", () => {
    expect(soundOn()).toBe(false);
    expect(() => cue("chime")).not.toThrow();
    const html = renderToStaticMarkup(createElement(SoundToggle));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Sound off");
  });

  it("captions the booth with the first line, and offers the next", () => {
    const lines = [
      { line: "I didn't expect to like him.", episode_id: "ep1", at: "2026-11-20T20:00:00.000Z" },
      { line: "Ask me again next week.", episode_id: null, at: "2026-11-19T20:00:00.000Z" },
    ];
    const html = renderToStaticMarkup(createElement(Booth, { name: "Mara", shot: null, lines }));
    expect(html).toContain("I didn&#x27;t expect to like him.");
    expect(html).toContain('href="/episodes/ep1"');
    expect(html).toContain("Next line (1 of 2)");
    expect(html).toContain("/cast/set-confessional-");
  });

  it("names the last rose the way the reveal tells it", () => {
    const kept = roseOrder([face("a", "Mara Vey"), face("b", "Dex Marlow")], "2026-12-06");
    expect(resultHeadline({ finale: false, last_rose: kept.at(-1)!, kept })).toBe(`${kept.at(-1)!.name.split(" ")[0]} got the last rose`);
    expect(resultHeadline({ finale: true, last_rose: face("a", "Mara Vey"), kept: [] })).toBe("Mara got the final rose");
    expect(resultHeadline({ finale: false, last_rose: null, kept })).toBe("2 roses, handed out");
  });
});
