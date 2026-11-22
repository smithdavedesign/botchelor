import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AwardCard, { leadingFigure } from "@/app/AwardCard";
import ShipPage from "@/app/ship/[a]/[b]/page";
import { readName, shipMerge, shipPair } from "@/lib/ship-names";
import type { ReunionAward } from "@/lib/reunion";

// The ship page looks up a real couple by the two names (lib/ship-couple.ts); there's no database here.
vi.mock("@/lib/ship-couple", () => ({ shipCouple: async () => null }));

const ROOT = join(__dirname, "..");

describe("award title cards (app/AwardCard.tsx)", () => {
  const golden: ReunionAward = {
    title: "🏆 The golden couple",
    name: "Barnaby Thorne × Sable Quist",
    detail: "9 of 9 dates ended in a yes to another.",
    chars: [
      { id: "house-barnaby", name: "Barnaby Thorne", house: true, hue: 20, portrait: null },
      { id: "house-sable", name: "Sable Quist", house: true, hue: 300, portrait: null },
    ],
  };

  it("finds the figure a line opens on, and only that", () => {
    expect(leadingFigure("9 of 9 dates ended in a yes to another.")).toEqual({ n: 9, rest: " of 9 dates ended in a yes to another." });
    expect(leadingFigure("10 viewers called them the most likable.")).toEqual({ n: 10, rest: " viewers called them the most likable." });
    expect(leadingFigure("The date that went most wrong this season.")).toBeNull();
    expect(leadingFigure("2026")).toBeNull();
  });

  it("is a dark title card with the pair's faces large, the figure counting up and the words intact", () => {
    const html = renderToStaticMarkup(createElement(AwardCard, { award: golden, line: golden.detail }));
    expect(html).toContain('class="card award award-card sheen-once tilt"');
    expect(html).toContain('class="award-faces is-pair"');
    expect(html.match(/href="\/characters\/house-(barnaby|sable)"/g)).toHaveLength(2);
    expect(html).toMatch(/<span class="count-up" data-final="9"><span>9<\/span><\/span> of 9 dates ended in a yes to another\./);
    expect(html.replace(/<[^>]+>/g, "")).toContain("9 of 9 dates ended in a yes to another.");
  });

  it("is the same card on the season pages, faces unlinked", () => {
    const html = renderToStaticMarkup(createElement(AwardCard, { award: golden, line: golden.detail, linked: false }));
    expect(html).not.toContain("href=");
    const season = readFileSync(join(ROOT, "app/seasons/[slug]/page.tsx"), "utf8");
    expect(season).toContain("<AwardCard key={award.title} award={award} line={award.detail} linked={false} />");
    expect(readFileSync(join(ROOT, "app/ReunionPanel.tsx"), "utf8")).toContain("<AwardCard key={award.title} award={award}");
  });
});

describe("the best ship name builds itself", () => {
  it("cuts Barnaby × Juniper as Barn|aby + Jun|iper", () => {
    const pair = shipPair("barnaby", "juniper");
    if (!pair.ok) throw new Error("refused");
    expect(pair.names[0].name).toBe("Barniper");
    expect(shipMerge(pair.a, pair.b, pair.names[0])).toEqual({ keepA: "Barn", dropA: "aby", dropB: "Jun", keepB: "iper" });
  });

  it("always keeps the blend's own name, and gives up only letters of the two names", () => {
    for (const [x, y] of [["nell", "sable"], ["juniper", "dex"], ["harry", "draco"], ["mary-jane", "peter"], ["sable", "nell"]]) {
      const pair = shipPair(x, y);
      if (!pair.ok) throw new Error(`${x} × ${y} refused`);
      for (const blend of pair.names) {
        const m = shipMerge(pair.a, pair.b, blend);
        if (!m) continue;
        expect(m.keepA + m.keepB).toBe(blend.name);
        const words = [(m.keepA + m.dropA).toLowerCase(), (m.dropB + m.keepB).toLowerCase()].sort();
        expect(words).toEqual([pair.a.core, pair.b.core].sort());
        expect([...(m.keepA + m.dropA + m.dropB + m.keepB)].length).toBeLessThanOrEqual(16);
      }
    }
  });

  it("is left alone when the pair is too long to show uncut", () => {
    const a = readName("Maximilianna")!;
    const b = readName("Bartholomew")!;
    const pair = shipPair("Maximilianna", "Bartholomew");
    if (!pair.ok) throw new Error("refused");
    expect(shipMerge(a, b, pair.names[0])).toBeNull();
  });

  it("puts only the ship name in the page's text; the given-up letters are generated content", async () => {
    const html = renderToStaticMarkup(await ShipPage({ params: Promise.resolve({ a: "barnaby", b: "juniper" }) }));
    expect(html).toContain('<strong><span class="ship-keep-a" data-drop="aby" style="--drop-len:3">Barn</span><span class="ship-keep-b" data-drop="Jun" style="--drop-len:3">iper</span></strong>');
    expect(html).toContain('<span class="ship-stamp" aria-hidden="true">Top pick</span>');
    const sheet = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    // Text alternative "" so a screen reader never reads the falling letters; the plain form first for older browsers.
    expect(sheet).toContain('content: attr(data-drop) "\\00a0" / "";');
    expect(sheet).toContain('content: attr(data-drop) / "";');
  });
});
