/**
 * Where the showcase's posts live, by side (David, 2026-11-18: "can we consolidate the after dark showcase in
 * ad.botchelor"; its header's Showcase door "takes you out of after dark"). A post's rating decides its host:
 *  - the safe side (pg and suggestive) is the show's Gallery, /showcase, and its reels, /showcase/reels;
 *  - After Dark's side (explicit) is After Dark's own, under its Gallery: /after-dark/showcase and
 *    /after-dark/showcase/reels, so they're served from After Dark's host, behind its 18+ gate.
 * The reels are the same page on both (app/showcase/reels/feed.tsx). An old `?side=after_dark` address on the show (a
 * shared reel, a bookmark, the reels' own side tabs) moves to After Dark's (middleware.ts, showcaseSideMove).
 *
 * Pure and dependency-free: the middleware, the grid (a client component) and 📣 Publish all read it.
 */
export type ShowcasePlace = "show" | "after_dark";

/** After Dark's side of the showcase: a room of After Dark's Gallery (app/after-dark/GalleryTabs.tsx). */
export const AD_SHOWCASE = "/after-dark/showcase";

export type ShowcasePaths = {
  /** The grid. */
  base: string;
  /** The same posts, one a screen. */
  reels: string;
  /** A creator's posts: on the show their page, on After Dark the showcase filtered to them, so a link never leaves it. */
  creator: (handle: string) => string;
  /** A character: on the show their page, on After Dark the showcase filtered to them. */
  character: (id: string) => string;
};

export function showcasePaths(place: ShowcasePlace): ShowcasePaths {
  if (place === "after_dark") {
    return {
      base: AD_SHOWCASE,
      reels: `${AD_SHOWCASE}/reels`,
      creator: (handle) => `${AD_SHOWCASE}?${new URLSearchParams({ creator: handle })}`,
      character: (id) => `${AD_SHOWCASE}?${new URLSearchParams({ character: id })}`,
    };
  }
  return {
    base: "/showcase",
    reels: "/showcase/reels",
    creator: (handle) => `/creators/${handle}`,
    character: (id) => `/characters/${id}`,
  };
}

/**
 * Where a post of theirs is on the showcase (David, 2026-11-15: "the showcase page in after dark?"): its side's own
 * page (an explicit one on After Dark's showcase, so its link from the After Dark Studio stays on After Dark; else the
 * show's Gallery), their own posts, newest first, the showcase's own order. 📣 Publish's "See it on the showcase"
 * (app/showcase/PublishButton.tsx) and the "your post is live" notice (lib/showcase-social.ts). A relative link: the
 * other host sends it on (lib/after-dark-host.ts afterDarkPageMove), query and all.
 */
export const postHref = (rating: string | null | undefined, handle?: string | null): string => {
  const base = showcasePaths(rating === "nsfw" ? "after_dark" : "show").base;
  return handle ? `${base}?${new URLSearchParams({ creator: handle })}` : base;
};

/** The showcase's addresses that can ask for After Dark's side: the Gallery, its reels and a creator's page. */
const CREATOR_PAGE = /^\/creators\/([^/]+)\/?$/;

/**
 * Where a request for the showcase's After Dark side (`?side=after_dark`) now goes, as a path and query on After
 * Dark's pages; null for anything else (the safe side stays where it is). The filters travel with it, `start` (the
 * reel it opens at) and `page` too; `side` is dropped, the place says it. A creator's page becomes the showcase
 * filtered to them.
 */
export function showcaseSideMove(pathname: string, search: string): { pathname: string; search: string } | null {
  const q = new URLSearchParams(search);
  if (q.get("side") !== "after_dark") return null;
  q.delete("side");
  let to: string;
  if (pathname === "/showcase" || pathname === "/showcase/") to = AD_SHOWCASE;
  else if (pathname === "/showcase/reels" || pathname === "/showcase/reels/") to = `${AD_SHOWCASE}/reels`;
  else {
    const m = CREATOR_PAGE.exec(pathname);
    if (!m) return null;
    let handle: string;
    try {
      handle = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
    to = AD_SHOWCASE;
    q.set("creator", handle);
  }
  const s = q.toString();
  return { pathname: to, search: s ? `?${s}` : "" };
}
