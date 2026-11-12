// The After Dark Studio's layout (the 2026-11-11 Studio review, David: "do 2-4"; nothing removed without his say-so).
// The Shoot tab: their own words first, the nine sections folded to one row each (the PG Studio's way), the model under a
// fold and the Shoot button stuck to the bottom of the screen. A gallery tile: ⭐, 👍/👎 and 🩹 Fix on it, everything else
// under one ⋯ in three rows. These read the source; scripts/e2e-studio.mjs clicks through it in a browser.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("app/after-dark/studio/[id]/Studio.tsx", "utf8");
const css = readFileSync("app/ux/after-dark.css", "utf8");
const between = (from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("the Shoot tab", () => {
  const shoot = between('{tab === "shoot" && (', '{tab === "pair" && (');

  it("leads with their limits, their setups and their own words, then the folded sections", () => {
    const at = (s: string) => shoot.indexOf(s);
    expect(at("Their limits:")).toBeGreaterThan(-1);
    expect(at("ad-studio-setups-quick")).toBeGreaterThan(at("Their limits:"));
    expect(at("Your own words")).toBeGreaterThan(at("ad-studio-setups-quick"));
    expect(at("ad-studio-folds")).toBeGreaterThan(at("Your own words"));
    expect(at("<FormatChips")).toBeGreaterThan(at("ad-studio-folds"));
  });

  it("puts the shape and how many in the stuck Shoot bar: one line that says them, their chips a tap away there", () => {
    const bar = shoot.slice(shoot.indexOf('<div className="ad-studio-go is-main">'));
    expect(bar.indexOf("<FormatChips")).toBeGreaterThan(-1);
    expect(bar.indexOf("{sizeChips}")).toBeGreaterThan(-1);
    expect(bar).toContain('hidden={!shapeOpen}');
    expect(bar).toContain('aria-controls="ad-shoot-shape"');
    expect(bar).toMatch(/\?\.ratio\} · \{size\}/);
    expect(shoot.indexOf("<FormatChips")).toBe(shoot.lastIndexOf("<FormatChips"));
  });

  it("folds each section to a row that says its pick, one open at a time, every chip and own-words box kept", () => {
    expect(shoot).toMatch(/className="ad-studio-fold-head" aria-expanded=\{isOpen\}/);
    expect(shoot).toContain("{foldSummary(g)}");
    expect(shoot).toContain("setOpenGroup(isOpen ? null : g.id)");
    expect(src).toContain("useState<string | null>(null)");
    expect(shoot).toContain("onClick={() => pick(g.id, o.id, g.multi)}");
    expect(shoot).toContain("…or add your own ${g.title.toLowerCase()}");
    expect(shoot).toContain("Set {first}&apos;s studio intensity to Filthy");
  });

  it("keeps the model one tap away, open when it can't run, and the Shoot button in reach", () => {
    expect(shoot).toMatch(/<details className="ad-studio-advanced" open=\{!picked \|\| !usable\(picked\) \|\| undefined\}>/);
    expect(shoot).toContain('modelSelect(editModels, picked?.id ?? "", setEditModel, "Model"');
    const go = css.slice(css.indexOf(".ad-studio-go.is-main {"));
    expect(go.slice(0, go.indexOf("}"))).toMatch(/position: sticky;[\s\S]*bottom: 0;/);
  });
});

describe("the own-key switch", () => {
  it("folds to one line above the tabs, open when it's on or has a problem", () => {
    expect(src).toMatch(/<details className="ad-studio-own ad-studio-advanced" open=\{onOwn \|\| Boolean\(s\.own_key\.problem\) \|\| undefined\}>/);
    expect(src.indexOf("ad-studio-own ad-studio-advanced")).toBeLessThan(src.indexOf('<nav className="ad-studio-tabs"'));
  });
});

describe("a gallery tile", () => {
  const tile = between("const gallery = (pics: Media[]", "/* One of their Studio animations");
  const more = tile.slice(tile.indexOf('<details className="ad-tile-more ad-studio-more">'));
  // What renders on the tile, its comments left out (they name the tools that moved).
  const onTile = tile
    .slice(0, tile.indexOf('<details className="ad-tile-more ad-studio-more">'))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("keeps ⭐, 👍/👎 and 🩹 Fix on the tile, and the tick while picking to export", () => {
    for (const s of ["<FavoriteStar", "<RateMedia", "<FixButton", "sel.selecting && <TileTools"]) expect(onTile, s).toContain(s);
  });

  it("puts every other tool under ⋯, in three rows: none of them went", () => {
    for (const s of ["More like this", "🎠 Carousel", "Upscale ${s.upscale.scale}×", "Animate…", "<SfwTwin", "Use this face", "Use as body", "<MediaTags", "<PublishButton", "Share…", "<TileTools id={p.id} api={AFTER_DARK_API} selecting={false}"]) {
      expect(more, s).toContain(s);
      expect(onTile, s).not.toContain(s);
    }
    for (const row of ['aria-label="Make more"', 'aria-label="Use it"', 'aria-label="Share it"']) expect(more).toContain(row);
  });
});
