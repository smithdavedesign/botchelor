/**
 * The galleries' filters (David, 2026-10-29: "in studio and anywhere where we see assets cleanup the organization by adding
 * filters like tags, reels, images, boomerangs, rating, archived … we shouldn't see thumbs down or 1-3 star assets by
 * default"). Pure, so every gallery shares it: the After Dark Studio's, a scene's, the Together tab's.
 *
 * By default: no 👎 and nothing at 1 to 3 stars (the library's), and nothing in the Archive. Each of those is one tap
 * away (Rating, Archived).
 */
import type { Media } from "./adult/media";

export const MEDIA_TYPES = ["picture", "face", "clip", "reel", "boomerang", "loop"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_TYPE_LABEL: Record<MediaType, string> = { picture: "Pictures", face: "Faces", clip: "Clips", reel: "Date reels", boomerang: "Boomerangs", loop: "Loops" };

export const RATING_VIEWS = ["good", "liked", "unrated", "disliked", "all"] as const;
export type RatingView = (typeof RATING_VIEWS)[number];
export const RATING_LABEL: Record<RatingView, string> = {
  good: "Hide 👎 and 1–3★",
  liked: "👍 or 4–5★ only",
  unrated: "Not rated yet",
  disliked: "👎 or 1–3★",
  all: "Everything",
};

export type MediaFilter = { type: MediaType | null; act: string | null; place: string | null; pov: boolean; rating: RatingView; favorites: boolean; archived: boolean };
export const DEFAULT_FILTER: MediaFilter = { type: null, act: null, place: null, pov: false, rating: "good", favorites: false, archived: false };

/** What kind of thing it is: a picture, a face (a baseline), a clip, a shot of a date's reel, a boomerang or a loop. */
export function typeOf(m: Pick<Media, "kind" | "derived" | "reel_kind">): MediaType {
  if (m.kind === "baseline") return "face";
  if (m.kind !== "video") return "picture";
  if (m.derived === "boomerang" || m.derived === "loop") return m.derived;
  return m.reel_kind && m.reel_kind !== "clip" ? "reel" : "clip";
}

/** Disliked: their 👎, or at most 3 stars. Liked: their 👍, or 4 stars or more. */
const disliked = (m: Pick<Media, "rating" | "stars">) => m.rating === -1 || (typeof m.stars === "number" && m.stars <= 3);
const liked = (m: Pick<Media, "rating" | "stars">) => !disliked(m) && (m.rating === 1 || (typeof m.stars === "number" && m.stars >= 4));

/** Whether an item has a tag (what it shows: act, place, pov). */
const hasTag = (m: Pick<Media, "show_tags">, kind: string, value?: string) => (m.show_tags ?? []).some((t) => t.kind === kind && (value === undefined || t.value === value));

/** The items a filter shows, in their order. A rating seen by the page (`ratingOf`, after a tap) wins over the item's own. */
export function filterMedia<T extends Media>(items: readonly T[], f: MediaFilter, ratingOf: (m: T) => 1 | -1 | null = (m) => m.rating ?? null): T[] {
  return items.filter((m) => {
    const r = { rating: ratingOf(m), stars: m.stars };
    if (f.archived !== Boolean(m.archived)) return false;
    if (f.type && typeOf(m) !== f.type) return false;
    if (f.act && !hasTag(m, "act", f.act)) return false;
    if (f.place && !hasTag(m, "place", f.place)) return false;
    if (f.pov && !hasTag(m, "pov")) return false;
    if (f.favorites && !m.favorite) return false;
    if (f.rating === "good") return !disliked(r);
    if (f.rating === "liked") return liked(r);
    if (f.rating === "unrated") return r.rating === null && (m.stars === null || m.stars === undefined);
    if (f.rating === "disliked") return disliked(r);
    return true;
  });
}

export type MediaFacets = { type: [MediaType, number][]; act: [string, number][]; place: [string, number][]; pov: number; favorites: number; archived: number; hidden: number };

/** What there is to filter by in these items (archived ones counted apart), and how many the default hides. */
export function mediaFacets<T extends Media>(items: readonly T[], ratingOf: (m: T) => 1 | -1 | null = (m) => m.rating ?? null): MediaFacets {
  const live = items.filter((m) => !m.archived);
  const count = <K extends string>(keys: K[]) => {
    const n = new Map<K, number>();
    for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  };
  const tags = (kind: string) => live.flatMap((m) => [...new Set((m.show_tags ?? []).filter((t) => t.kind === kind).map((t) => t.value))]);
  return {
    type: count(live.map((m) => typeOf(m))).sort((a, b) => MEDIA_TYPES.indexOf(a[0]) - MEDIA_TYPES.indexOf(b[0])),
    act: count(tags("act")).slice(0, 12),
    place: count(tags("place")).slice(0, 12),
    pov: live.filter((m) => hasTag(m, "pov")).length,
    favorites: live.filter((m) => m.favorite).length,
    archived: items.length - live.length,
    hidden: live.filter((m) => disliked({ rating: ratingOf(m), stars: m.stars })).length,
  };
}

/**
 * The PG Studio's gallery (lib/studio/pg.ts): what made a picture (a shoot, a carousel, the identity pack, an SFW twin),
 * where, its rating (PG, or suggestive: signed-in people only) and whether it's on the showcase. PG pictures have no
 * 👍/👎 or stars, so nothing is hidden by default.
 */
export const PG_MADE = ["shoot", "carousel", "identity", "twin"] as const;
export type PgMade = (typeof PG_MADE)[number];
export const PG_MADE_LABEL: Record<PgMade, string> = { shoot: "Shoots", carousel: "Carousels", identity: "Identity views", twin: "SFW twins" };

export type PgFilter = { made: PgMade | null; place: string | null; rating: "pg" | "suggestive" | null; posted: boolean };
export const DEFAULT_PG_FILTER: PgFilter = { made: null, place: null, rating: null, posted: false };

type PgItem = { rating: "pg" | "suggestive"; tags?: { kind: string; value: string }[]; post?: { status: string } | null };
const pgTag = (p: PgItem, kind: string) => (p.tags ?? []).find((t) => t.kind === kind)?.value ?? null;
/** What made it; null for a picture from before tags (2026-10-29). */
export const pgMadeOf = (p: PgItem): PgMade | null => {
  const m = pgTag(p, "made");
  return (PG_MADE as readonly string[]).includes(m ?? "") ? (m as PgMade) : null;
};
const posted = (p: PgItem) => p.post?.status === "live" || p.post?.status === "pending";

export function filterPg<T extends PgItem>(items: readonly T[], f: PgFilter): T[] {
  return items.filter((p) => (!f.made || pgMadeOf(p) === f.made) && (!f.place || pgTag(p, "place") === f.place) && (!f.rating || p.rating === f.rating) && (!f.posted || posted(p)));
}

export type PgFacets = { made: [PgMade, number][]; place: [string, number][]; suggestive: number; posted: number };

export function pgFacets(items: readonly PgItem[]): PgFacets {
  const count = <K extends string>(keys: (K | null)[]) => {
    const n = new Map<K, number>();
    for (const k of keys) if (k) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    made: count(items.map(pgMadeOf)).sort((a, b) => PG_MADE.indexOf(a[0]) - PG_MADE.indexOf(b[0])),
    place: count(items.map((p) => pgTag(p, "place"))).slice(0, 12),
    suggestive: items.filter((p) => p.rating === "suggestive").length,
    posted: items.filter(posted).length,
  };
}
