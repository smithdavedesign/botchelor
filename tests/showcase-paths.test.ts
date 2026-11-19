import { describe, expect, it } from "vitest";
import { IN_VIEW, MAX_PLAYING, whichPlay } from "@/lib/autoplay";
import { AD_SHOWCASE, showcasePaths, showcaseSideMove } from "@/lib/showcase-paths";

// David, 2026-11-18: "can we consolidate the after dark showcase in ad.botchelor" (lib/showcase-paths.ts), and "on
// showcase pages, videos should play on hover or automatically preferably" (lib/autoplay.ts).

describe("where each side's showcase lives", () => {
  it("keeps the show's links as they were, and After Dark's on After Dark's own showcase", () => {
    const show = showcasePaths("show");
    expect([show.base, show.reels, show.creator("mara"), show.character("c1")]).toEqual(["/showcase", "/showcase/reels", "/creators/mara", "/characters/c1"]);
    const ad = showcasePaths("after_dark");
    expect([ad.base, ad.reels, ad.creator("mara"), ad.character("c 1")]).toEqual([AD_SHOWCASE, `${AD_SHOWCASE}/reels`, `${AD_SHOWCASE}?creator=mara`, `${AD_SHOWCASE}?character=c+1`]);
  });

  it("moves an old After Dark side address to its page, filters, page and the reel to open at kept", () => {
    expect(showcaseSideMove("/showcase", "?side=after_dark&creator=mara&page=2")).toEqual({ pathname: AD_SHOWCASE, search: "?creator=mara&page=2" });
    expect(showcaseSideMove("/showcase/reels", "?start=p1&side=after_dark")).toEqual({ pathname: `${AD_SHOWCASE}/reels`, search: "?start=p1" });
    expect(showcaseSideMove("/showcase/", "?side=after_dark")).toEqual({ pathname: AD_SHOWCASE, search: "" });
    // A creator's page is After Dark's showcase filtered to them.
    expect(showcaseSideMove("/creators/mara", "?side=after_dark&medium=clip")).toEqual({ pathname: AD_SHOWCASE, search: "?medium=clip&creator=mara" });
    expect(showcaseSideMove("/creators/a%20b", "?side=after_dark")).toEqual({ pathname: AD_SHOWCASE, search: "?creator=a+b" });
  });

  it("leaves the safe side and every other page where they are", () => {
    for (const [path, search] of [
      ["/showcase", ""],
      ["/showcase", "?side=pg"],
      ["/showcase/reels", "?side=pg&start=p1"],
      ["/showcase/requests", "?side=after_dark"],
      ["/creators/mara/x", "?side=after_dark"],
      ["/creators/%E0%A4%A", "?side=after_dark"],
      ["/after-dark/showcase", "?side=after_dark"],
      ["/watch", "?side=after_dark"],
    ]) {
      expect(showcaseSideMove(path, search), `${path}${search}`).toBeNull();
    }
  });
});

describe("which clips play by themselves (lib/autoplay.ts)", () => {
  const tile = (key: string, ratio: number, skip = false) => ({ key, ratio, skip });

  it("plays those mostly on screen, in page order, never a blurred or paused one", () => {
    expect(whichPlay([tile("a", 1), tile("b", IN_VIEW - 0.01), tile("c", IN_VIEW), tile("d", 0.9, true), tile("e", 0)])).toEqual(["a", "c"]);
  });

  it("plays at most MAX_PLAYING at once, the most visible first", () => {
    const tiles = Array.from({ length: MAX_PLAYING + 3 }, (_, i) => tile(`t${i}`, i < 3 ? 0.7 : 1));
    const on = whichPlay(tiles);
    expect(on).toHaveLength(MAX_PLAYING);
    // The three only 70% on screen are the ones left out.
    expect(on).toEqual(tiles.slice(3).map((t) => t.key));
    expect(whichPlay(tiles, 2)).toEqual(["t3", "t4"]);
    expect(whichPlay(tiles, 0)).toEqual([]);
  });
});
