/**
 * The gallery's "Now showing" (lib/showcase-feature.ts, app/showcase/ShowcaseFeature.tsx; the visual pop audit's pass 3,
 * Showcase as a cinema): one PG clip large above /showcase's grid, the same for everyone. Pure, no database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShowcaseFeature from "@/app/showcase/ShowcaseFeature";
import { parseFilters, type Post } from "@/lib/showcase";
import { featureReel, isUnfiltered, pickFeature } from "@/lib/showcase-feature";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "app", "ux", "showcase.css"), "utf8");
const page = readFileSync(join(root, "app", "showcase", "page.tsx"), "utf8");

const post = (over: Partial<Post> = {}): Post => ({
  id: "p1",
  source: "pg",
  media_id: "m1",
  mime: "video/mp4",
  rating: "pg",
  medium: "clip",
  aspect: "9:16",
  act: null,
  place: null,
  pov: false,
  from_date: false,
  caption: null,
  status: "published",
  published_at: "2026-11-20T10:00:00Z",
  creator: { handle: "darood", display_name: "Darood" },
  character: { id: "c1", name: "Azimuth Reed" },
  partner: null,
  mine: false,
  remixable: false,
  likes: 3,
  liked: false,
  poster: true,
  ...over,
});

describe("pickFeature", () => {
  it("takes a date reel from the top of the trending order, else the top clip", () => {
    expect(pickFeature([post({ id: "a" }), post({ id: "b", medium: "reel" })])?.id).toBe("b");
    expect(pickFeature([post({ id: "a" }), post({ id: "b" })])?.id).toBe("a");
  });

  it("features only PG clips: never a picture, a suggestive or an explicit post", () => {
    expect(pickFeature([post({ id: "pic", mime: "image/webp", medium: "picture" }), post({ id: "s", rating: "suggestive" }), post({ id: "x", rating: "nsfw" })])).toBeNull();
    expect(pickFeature([post({ id: "x", rating: "nsfw", medium: "reel" }), post({ id: "ok" })])?.id).toBe("ok");
  });

  it("looks only a few places down for a reel", () => {
    const clips = Array.from({ length: 8 }, (_, i) => post({ id: `c${i}` }));
    expect(pickFeature([...clips, post({ id: "late", medium: "reel" })])?.id).toBe("c0");
  });
});

describe("featureReel", () => {
  it("plays from the show's media route with its tile still first, and opens the reels at it", () => {
    const r = featureReel(post({ partner: { id: "c2", name: "Dex Arlo" } }));
    expect(r.src).toBe("/api/showcase/p1/media");
    expect(r.poster).toBe("/api/showcase/p1/media?size=tile");
    expect(r.names).toBe("Azimuth Reed × Dex Arlo");
    expect(r.reelsHref).toBe("/showcase/reels?start=p1&sort=trending&medium=video");
    expect(r.by?.handle).toBe("darood");
  });

  it("credits nobody on the show's own posts, and falls back to 3:4 for an odd shape", () => {
    const r = featureReel(post({ creator: { handle: "botchelor", display_name: "Botchelor" }, aspect: null, poster: false, media: "https://ad.example/m.mp4?t=1" }));
    expect(r.by).toBeNull();
    expect(r.aspect).toBe("3:4");
    expect(r.poster).toBeNull();
    expect(r.src).toBe("https://ad.example/m.mp4?t=1");
  });

  it("lists up to four more PG clips with a still as Also showing, never the feature itself", () => {
    const top = post({ id: "top" });
    const rest = [top, post({ id: "a" }), post({ id: "pic", mime: "image/webp", medium: "picture" }), post({ id: "nostill", poster: false }), post({ id: "x", rating: "nsfw" }), post({ id: "b" }), post({ id: "c" }), post({ id: "d" }), post({ id: "e" })];
    const r = featureReel(top, rest);
    expect(r.also.map((a) => a.id)).toEqual(["a", "b", "c", "d"]);
    expect(r.also[0]).toEqual({ id: "a", poster: "/api/showcase/a/media?size=tile", names: "Azimuth Reed", href: "/showcase/reels?start=a&sort=trending&medium=video" });
    expect(featureReel(top).also).toEqual([]);
  });
});

describe("ShowcaseFeature", () => {
  it("shows Also showing as links into the reels, and nothing when there are none", () => {
    const top = post({ id: "top" });
    const html = renderToStaticMarkup(createElement(ShowcaseFeature, { reel: featureReel(top, [top, post({ id: "a", partner: { id: "c2", name: "Dex Arlo" } })]) }));
    expect(html).toContain("Also showing");
    expect(html).toContain('aria-label="Watch: Azimuth Reed × Dex Arlo"');
    expect(html).toContain('<img src="/api/showcase/a/media?size=tile" alt="" loading="lazy"');
    expect(renderToStaticMarkup(createElement(ShowcaseFeature, { reel: featureReel(top) }))).not.toContain("Also showing");
  });

  it("paints the still first, muted and looping, loads nothing until it plays, and has no play button before the page is live", () => {
    const html = renderToStaticMarkup(createElement(ShowcaseFeature, { reel: featureReel(post()) }));
    expect(html).toContain("Now showing");
    expect(html).toMatch(/<video[^>]*muted=""[^>]*loop=""[^>]*playsInline=""[^>]*preload="none"[^>]*poster="\/api\/showcase\/p1\/media\?size=tile"/);
    expect(html).toContain('style="aspect-ratio:9 / 16"');
    expect(html).not.toContain("showcase-feature-play");
    expect(html).toContain('href="/showcase/reels?start=p1&amp;sort=trending&amp;medium=video"');
    expect(html).toContain("Meet Azimuth");
  });

  it("shows the first frame of a clip with no still", () => {
    const html = renderToStaticMarkup(createElement(ShowcaseFeature, { reel: featureReel(post({ poster: false })) }));
    expect(html).toMatch(/preload="metadata"/);
    expect(html).toContain('src="/api/showcase/p1/media#t=0.1"');
  });
});

describe("isUnfiltered", () => {
  // parseFilters always sets page (1 when none is asked for): the live page never showed the feature while the check
  // read every filter, page included, as having to be unset (2026-11-21).
  it("is the gallery as it opens, page 1 included, from what parseFilters really returns", () => {
    expect(parseFilters({}).page).toBe(1);
    expect(isUnfiltered(parseFilters({}))).toBe(true);
    expect(isUnfiltered(parseFilters(new URLSearchParams("")))).toBe(true);
    expect(isUnfiltered(parseFilters({ page: "1" }))).toBe(true);
    expect(isUnfiltered(parseFilters({ junk: "x" }))).toBe(true);
  });

  it("is false on a later page or with any filter, sort or side", () => {
    for (const q of [{ page: "2" }, { sort: "trending" }, { medium: "video" }, { character: "c1" }, { creator: "darood" }, { following: "1" }, { pov: "1" }, { side: "pg" }, { shape: "9:16" }]) {
      expect(isUnfiltered(parseFilters(q)), JSON.stringify(q)).toBe(false);
    }
  });
});

describe("the page and its styles", () => {
  it("shows it on the unfiltered gallery only, from the shared copy", () => {
    expect(page).toContain('isUnfiltered(filters) ? await shared("showcase:feature", () => showcaseFeature(db)) : null');
  });

  it("only twinkles where motion is welcome", () => {
    const parts = css.split("@media (prefers-reduced-motion: no-preference)");
    const outside = parts[0] + parts.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
    expect(outside).not.toMatch(/\.showcase-feature[^{]*\{[^}]*animation/);
    expect(css).toMatch(/\.showcase-feature::before \{\s*animation: showcase-bulbs/);
  });
});
