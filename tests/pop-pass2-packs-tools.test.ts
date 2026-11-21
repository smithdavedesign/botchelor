import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PackVenues from "@/app/PackVenues";
import PlanFace from "@/app/PlanFace";
import ToolPreview from "@/app/tools/ToolPreview";
import { CHEMISTRY_EXAMPLE, chemistryTest } from "@/lib/chemistry-test";
import { ocNames } from "@/lib/oc-names";
import { PACK_VENUES, packVenues } from "@/lib/pack-venues";
import { shipNames } from "@/lib/ship-names";
import { FREE_TOOLS, SHIP_TOOL_PATH, CHEMISTRY_TOOL_PATH } from "@/lib/tools";
import { OC_NAMES_PATH } from "@/lib/oc-names";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("a date pack's picture (app/PackVenues.tsx)", () => {
  it("shows one different place per date, each a small cut that's on disk", () => {
    for (const n of [5, 15] as const) {
      const venues = packVenues(n);
      expect(venues).toHaveLength(n);
      expect(new Set(venues.map((v) => v.id)).size).toBe(n);
      for (const v of venues) {
        const size = statSync(join(ROOT, "public", v.src)).size;
        expect(size, v.id).toBeLessThan(8_000);
      }
    }
    expect(new Set([...PACK_VENUES[5], ...PACK_VENUES[15]]).size).toBe(20);
    expect(packVenues(7)).toEqual([]);
  });

  it("is a row of five, or a ribbon of fifteen written twice so it loops; decorative either way", () => {
    const five = renderToStaticMarkup(createElement(PackVenues, { dates: 5 }));
    expect(five).toMatch(/^<div class="pack-venues is-row" aria-hidden="true">/);
    expect(five.match(/<img /g)).toHaveLength(5);
    const fifteen = renderToStaticMarkup(createElement(PackVenues, { dates: 15 }));
    expect(fifteen).toMatch(/^<div class="pack-venues is-ribbon" aria-hidden="true"><div class="pack-venues-track">/);
    expect(fifteen.match(/<img /g)).toHaveLength(30);
    expect(fifteen).not.toMatch(/alt="[^"]/);
    expect(renderToStaticMarkup(createElement(PackVenues, { dates: undefined }))).toBe("");
  });

  it("is on both packs on /pricing and /shop, and never on After Dark's token shop", () => {
    expect(src("app/pricing/page.tsx")).toContain("<PackVenues dates={pack.episodes} />");
    expect(src("app/shop/page.tsx")).toContain('{unit === "date" && item.kind === "episode_pack" && <PackVenues dates={item.episodes} />}');
    expect(src("app/shop/page.tsx")).toContain('{unit === "date" && <PlanFace />}');
  });
});

describe("the Companion Plan's face (app/PlanFace.tsx)", () => {
  it("is a house companion's portrait, round, decorative", () => {
    const html = renderToStaticMarkup(createElement(PlanFace));
    expect(html).toMatch(/^<span class="plan-face" aria-hidden="true">/);
    expect(html).toContain("/cast/house-juniper-");
    expect(src("app/pricing/page.tsx")).toContain("<PlanFace />");
  });
});

describe("each free tool previews what it makes (app/tools/ToolPreview.tsx)", () => {
  it("has a preview for every tool on /tools, hidden from screen readers", () => {
    for (const t of FREE_TOOLS) {
      const html = renderToStaticMarkup(createElement(ToolPreview, { path: t.path }));
      expect(html, t.path).toMatch(/^<[a-z]+ class="tool-preview [a-z-]+" aria-hidden="true">/);
    }
    expect(src("app/tools/page.tsx")).toContain("<ToolPreview path={t.path} />");
  });

  it("shows the tools' real output, never made up for the picture", () => {
    const names = renderToStaticMarkup(createElement(ToolPreview, { path: OC_NAMES_PATH }));
    for (const n of ocNames({ style: null }).slice(0, 3)) expect(names).toContain(`<li>${n.name}</li>`);
    const ship = renderToStaticMarkup(createElement(ToolPreview, { path: SHIP_TOOL_PATH }));
    const top = shipNames("juniper", "dex").slice(0, 4).map((n) => n.name);
    expect(top).toHaveLength(4);
    // The reel is the four names and the first again, so the turn back to it has no seam.
    expect([...ship.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual([...top, top[0]]);
    const chem = renderToStaticMarkup(createElement(ToolPreview, { path: CHEMISTRY_TOOL_PATH }));
    const { score } = chemistryTest(...CHEMISTRY_EXAMPLE);
    expect(chem).toContain(`data-final="${score}"`);
    expect(chem).toContain(`width:${score}%`);
  });
});

describe("the 15-pack's ribbon never widens the page (live phone check, 2026-11-21: /pricing was 2,845px too wide)", () => {
  it("doesn't count its own width, and /pricing's phone column can shrink below its content", () => {
    const money = src("app/ux/money.css");
    expect(money).toMatch(/\.pack-venues\.is-ribbon \{\s*contain: inline-size;/);
    expect(src("app/ux/company.css")).toMatch(/@media \(max-width: 640px\) \{\s*\.pricing-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
