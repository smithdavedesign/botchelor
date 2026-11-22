/**
 * Tonight's two votes as one card on an owner's home (app/TonightVotes.tsx; the 2026-11-21 product review: the
 * signed-in home stacked ten modules, two of them ballots one under the other). Pure renders and the stylesheet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DareVote from "@/app/DareVote";
import SituationVote from "@/app/SituationVote";
import TonightVotes from "@/app/TonightVotes";
import type { DareBoard } from "@/lib/dares";
import type { SituationBoard } from "@/lib/situations";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

const NOW = Date.parse("2026-11-21T20:00:00Z");
const situation: SituationBoard = {
  day: "2026-11-21",
  closes_at: "2026-11-22T18:00:00Z",
  cast: [
    { id: "house-sable", name: "Sable Quist", hue: 10, portrait: null },
    { id: "house-barnaby", name: "Barnaby Thorne", hue: 200, portrait: null },
  ],
  headline: null,
  choices: [
    { id: "film", title: "Leads in an old film", icon: "🎬", premise: "They talk in quick, witty banter.", votes: 0 },
    { id: "ice", title: "New partners on the ice", icon: "⛸", premise: "One evening at the empty rink.", votes: 0 },
    { id: "chefs", title: "Rival chefs", icon: "🍳", premise: "Professional pride is on the line.", votes: 0 },
  ],
  my_pick: null,
  total: 0,
  last: null,
};
const dares: DareBoard = {
  day: "2026-11-21",
  closes_at: "2026-11-22T18:00:00Z",
  target: { id: "house-barnaby", name: "Barnaby Thorne", hue: 200, portrait: null },
  choices: [
    { id: "d1", text: "Announce that the night ends with a formal handshake.", votes: 0 },
    { id: "d2", text: "Narrate one moment of the date like a nature documentary.", votes: 0 },
    { id: "d3", text: "Ask the question you'd normally save for date five.", votes: 0 },
  ],
  my_pick: null,
  total: 0,
  last: null,
};
const text = (html: string) => html.replace(/&#x27;/g, "'");
const render = (props: { situation: SituationBoard | null; dares: DareBoard | null }) => text(renderToStaticMarkup(createElement(TonightVotes, { ...props, now: NOW, insider: true })));

describe("the Tonight card", () => {
  it("is one card with one heading, holding both votes as parts", () => {
    const html = render({ situation, dares });
    expect(html.match(/<section\b/g)?.length).toBe(1);
    expect(html).toContain('<section id="tonight-votes" class="card situation tonight-votes" aria-labelledby="tonight-votes-head">');
    expect(html).toContain('<h2 id="tonight-votes-head">Tonight\'s two votes</h2>');
    // Each vote keeps its anchor (the band and /vote link to #situation), its question a level down, and no card of its own.
    expect(html).toContain('<div id="situation" class="situation tonight-part" role="group" aria-labelledby="situation-head">');
    expect(html).toContain('<div id="dare" class="situation dare tonight-part" role="group" aria-labelledby="dare-head">');
    expect(html).toContain('<h3 id="situation-head">Sable Quist × Barnaby Thorne: what happens on their date?</h3>');
    expect(html).toContain('<h3 id="dare-head">Dare Barnaby Thorne to…</h3>');
    expect(html.match(/<h2\b/g)?.length).toBe(1);
    expect(html).toContain('<p class="kicker">The situation</p>');
    expect(html).toContain('<p class="kicker">The dare</p>');
    // Every choice of both is there to press: three and three.
    expect(html.match(/class="situation-choice"/g)?.length).toBe(6);
    expect(html.indexOf('id="dare"')).toBeGreaterThan(html.indexOf('id="situation"'));
  });

  it("with only one vote on, shows that one as the card it always was; with neither, nothing", () => {
    const only = render({ situation, dares: null });
    expect(only).toContain('<section id="situation" class="card situation" aria-labelledby="situation-head">');
    expect(only).toContain("Tonight's situation · you pick");
    expect(only).not.toContain("tonight-votes");
    const dare = render({ situation: null, dares });
    expect(dare).toContain('<section id="dare" class="card situation dare" aria-labelledby="dare-head">');
    expect(dare).toContain("Tonight's dare · you pick");
    expect(render({ situation: null, dares: null })).toBe("");
  });

  it("leaves /watch's two cards as they were: each its own section, its question an h2", () => {
    const s = text(renderToStaticMarkup(createElement(SituationVote, { board: situation, now: NOW })));
    const d = text(renderToStaticMarkup(createElement(DareVote, { board: dares })));
    expect(s).toContain('<section id="situation" class="card situation" aria-labelledby="situation-head">');
    expect(s).toContain('<h2 id="situation-head">');
    expect(d).toContain('<section id="dare" class="card situation dare" aria-labelledby="dare-head">');
    expect(d).toContain('<h2 id="dare-head">');
  });

  it("sits its two parts side by side on a wide screen and one after the other on a phone", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.tonight-votes-parts \{\s*display: grid;/);
    expect(css).toMatch(/@media \(min-width: 900px\) \{\s*\.tonight-votes-parts \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // A part is half the card's width, so its choices run one under another.
    expect(css).toMatch(/\.tonight-part \.situation-choices \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
