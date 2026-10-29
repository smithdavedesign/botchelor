import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MediaFilterBar from "@/app/after-dark/MediaFilterBar";
import PgFilterBar from "@/app/studio/PgFilterBar";
import type { Media } from "@/lib/adult/media";
import type { PgPicture } from "@/lib/studio/pg";
import { DEFAULT_FILTER, DEFAULT_PG_FILTER, filterMedia, filterPg, mediaFacets, pgFacets, typeOf } from "@/lib/media-filter";

// The galleries' filters (lib/media-filter.ts; David, 2026-10-29): what it is, pose, place, rating and the Archive, with
// no 👎 and nothing at 1–3 stars by default.

const m = (id: string, more: Partial<Media> = {}): Media => ({ id, character_id: "c", character_b: null, kind: "scene", status: "ready", created_at: "2026-10-29T00:00:00Z", mime: "image/png", ...more });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("what a thing is", () => {
  it("tells a picture, a face, a clip, a date reel's shot, a boomerang and a loop apart", () => {
    expect(typeOf(m("a"))).toBe("picture");
    expect(typeOf(m("a", { kind: "baseline" }))).toBe("face");
    expect(typeOf(m("a", { kind: "video", reel_kind: "clip" }))).toBe("clip");
    expect(typeOf(m("a", { kind: "video" }))).toBe("clip");
    expect(typeOf(m("a", { kind: "video", reel_kind: "night" }))).toBe("reel");
    expect(typeOf(m("a", { kind: "video", derived: "boomerang" }))).toBe("boomerang");
    expect(typeOf(m("a", { kind: "video", derived: "loop", reel_kind: "clip" }))).toBe("loop");
  });
});

describe("the gallery filter", () => {
  const items = [
    m("liked", { rating: 1, show_tags: [{ kind: "act", value: "kiss" }, { kind: "place", value: "beach" }] }),
    m("down", { rating: -1 }),
    m("three", { stars: 3 }),
    m("four", { stars: 4, favorite: true, show_tags: [{ kind: "pov", value: "pov_a" }] }),
    m("liked-but-low", { rating: 1, stars: 2 }),
    m("plain"),
    m("clip", { kind: "video", reel_kind: "clip", show_tags: [{ kind: "act", value: "kiss" }] }),
    m("archived", { kind: "video", archived: true, rating: 1 }),
  ];

  it("hides 👎, 1–3★ and the Archive by default, each a tap away", () => {
    expect(ids(filterMedia(items, DEFAULT_FILTER))).toEqual(["liked", "four", "plain", "clip"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, rating: "disliked" }))).toEqual(["down", "three", "liked-but-low"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, rating: "liked" }))).toEqual(["liked", "four"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, rating: "unrated" }))).toEqual(["plain", "clip"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, rating: "all" }))).toHaveLength(7);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, archived: true }))).toEqual(["archived"]);
  });

  it("narrows by type, pose, place, first person and favorites, and a rating just tapped wins over the saved one", () => {
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, type: "clip" }))).toEqual(["clip"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, act: "kiss" }))).toEqual(["liked", "clip"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, place: "beach" }))).toEqual(["liked"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, pov: true }))).toEqual(["four"]);
    expect(ids(filterMedia(items, { ...DEFAULT_FILTER, favorites: true }))).toEqual(["four"]);
    expect(ids(filterMedia(items, DEFAULT_FILTER, (x) => (x.id === "plain" ? -1 : (x.rating ?? null))))).toEqual(["liked", "four", "clip"]);
  });

  it("counts what there is to filter by, the Archive apart, and how many the default hides", () => {
    const f = mediaFacets(items);
    expect(f.type).toEqual([
      ["picture", 6],
      ["clip", 1],
    ]);
    expect(f.act).toEqual([["kiss", 2]]);
    expect(f.place).toEqual([["beach", 1]]);
    expect([f.pov, f.favorites, f.archived, f.hidden]).toEqual([1, 1, 1, 3]);
  });

  it("shows chips only for what's there, with counts, and says what the default hides", () => {
    const html = renderToStaticMarkup(createElement(MediaFilterBar, { items, value: DEFAULT_FILTER, onChange: () => {}, shown: 4 }));
    expect(html).toContain("Pictures<span class=\"media-filter-count\">6</span>");
    expect(html).toContain("Clips");
    expect(html).toContain("First person");
    expect(html).toContain("🗄 Archived");
    expect(html).toContain('aria-label="Pose"');
    expect(html).toContain("4 shown · 3 with a 👎 or 1–3★ hidden");
    expect(html).not.toContain("Clear the filters");
    expect(html).not.toContain("Boomerangs");
    const one = renderToStaticMarkup(createElement(MediaFilterBar, { items: [m("x")], value: { ...DEFAULT_FILTER, rating: "all" }, onChange: () => {}, shown: 1 }));
    expect(one).not.toContain("Pictures");
    expect(one).toContain("Clear the filters");
  });
});

describe("the PG Studio's filter", () => {
  const p = (id: string, made: string | null, more: Partial<PgPicture> = {}): PgPicture => ({
    id,
    rating: "pg",
    created_at: "2026-10-29T00:00:00Z",
    shoot_id: null,
    tags: made ? [{ kind: "made", value: made }] : [],
    ...more,
  });
  const pics = [
    p("shoot", "shoot", { tags: [{ kind: "made", value: "shoot" }, { kind: "place", value: "beach" }] }),
    p("carousel", "carousel", { tags: [{ kind: "made", value: "carousel" }, { kind: "place", value: "beach" }], rating: "suggestive" }),
    p("view", "identity"),
    p("twin", "twin", { post: { id: "post", status: "live" } }),
    p("old", null),
  ];

  it("filters by what made it, place, rating and the showcase; hides nothing by default", () => {
    expect(ids(filterPg(pics, DEFAULT_PG_FILTER))).toHaveLength(5);
    expect(ids(filterPg(pics, { ...DEFAULT_PG_FILTER, made: "carousel" }))).toEqual(["carousel"]);
    expect(ids(filterPg(pics, { ...DEFAULT_PG_FILTER, place: "beach" }))).toEqual(["shoot", "carousel"]);
    expect(ids(filterPg(pics, { ...DEFAULT_PG_FILTER, rating: "suggestive" }))).toEqual(["carousel"]);
    expect(ids(filterPg(pics, { ...DEFAULT_PG_FILTER, posted: true }))).toEqual(["twin"]);
    expect(pgFacets(pics)).toEqual({
      made: [
        ["shoot", 1],
        ["carousel", 1],
        ["identity", 1],
        ["twin", 1],
      ],
      place: [["beach", 2]],
      suggestive: 1,
      posted: 1,
    });
  });

  it("names places by the menu's words, and shows nothing when there's nothing to tell apart", () => {
    const html = renderToStaticMarkup(createElement(PgFilterBar, { items: pics, value: DEFAULT_PG_FILTER, onChange: () => {}, shown: 5 }));
    for (const word of ["Shoots", "Carousels", "Identity views", "SFW twins", "Suggestive", "📣 On the showcase", "Beach"]) expect(html).toContain(word);
    expect(renderToStaticMarkup(createElement(PgFilterBar, { items: [p("a", "shoot"), p("b", "shoot")], value: DEFAULT_PG_FILTER, onChange: () => {}, shown: 2 }))).toBe("");
  });
});
