import type { Db } from "../db";
import type { Media } from "./media";

/**
 * After Dark's Gallery (app/after-dark/gallery) in three tabs (David, 2026-11-15: "the Gallery should have a tab for
 * videos (reels, videos, studio videos)"): Videos first, then Pictures, then Faces. Each tab asks the database for its
 * own kind, so a Studio shoot's four pictures at a time no longer push the videos out of one shared newest-120.
 */
export const GALLERY_TABS = ["videos", "pictures", "faces"] as const;
export type GalleryTab = (typeof GALLERY_TABS)[number];
export const GALLERY_TAB_LABEL: Record<GalleryTab, string> = { videos: "Videos", pictures: "Pictures", faces: "Faces" };

/** How many a tab shows at first, and how many more each "Show older" adds; never more than the most at once. */
export const GALLERY_PAGE = 120;
export const GALLERY_MAX = 960;

export type GalleryCounts = Record<GalleryTab, number> & { reels: number; clips: number };

/** The tab asked for, else Videos when there are any, else Pictures (a new account opens on what it has). */
export function galleryTab(raw: unknown, counts: Pick<GalleryCounts, "videos">): GalleryTab {
  if (typeof raw === "string" && (GALLERY_TABS as readonly string[]).includes(raw)) return raw as GalleryTab;
  return counts.videos > 0 ? "videos" : "pictures";
}

/** `?n=`: how many to show, in whole pages, at least one page and at most GALLERY_MAX. */
export function galleryLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= GALLERY_PAGE) return GALLERY_PAGE;
  return Math.min(GALLERY_MAX, Math.ceil(n / GALLERY_PAGE) * GALLERY_PAGE);
}

/** Where it was made: in the Studio (a shoot, or one of them alone), or on a night of the two of them. */
export type MediaSource = "night" | "studio";
export const sourceOf = (m: Pick<Media, "studio" | "character_b">): MediaSource => (m.studio || !m.character_b ? "studio" : "night");
export const SOURCE_LABEL: Record<MediaSource, string> = { night: "From nights", studio: "From the Studio" };

/**
 * A night's video that the Gallery shows as one reel (Videos → Reels), on an unaliased adult_reels: not a clip (a clip
 * is a moment, listed with the clips), not a storyboard draft, and either still being filmed or with a shot that plays
 * (lib/adult/clip-chains.ts playable: ready, a file, not in the Archive).
 */
export const SHOWN_NIGHT_REEL = `coalesce(adult_reels.kind, 'night') <> 'clip' and adult_reels.status <> 'draft'
  and (adult_reels.status = 'making' or exists (select 1 from jsonb_array_elements(adult_reels.shots) s
        where s->>'status' = 'ready' and coalesce(s->>'media_id', '') <> '' and not s ? 'archived_at'))`;

/**
 * A video (on adult_images aliased `i`) that plays inside one of those reels, so the clips grid leaves it out rather
 * than show a 10-shot reel as 10 loose tiles. A shot taken out of its video (the Archive, or a 👎) is still listed, as before.
 */
export const IN_NIGHT_REEL = `exists (select 1 from adult_reels v cross join lateral jsonb_array_elements(v.shots) s
  where v.owner_id = i.owner_id and coalesce(v.kind, 'night') <> 'clip' and v.status <> 'draft' and s->>'media_id' = i.id and not s ? 'archived_at')`;

/**
 * Not a living portrait (lib/showcase-loops.ts), on adult_images aliased `i`: a PG clip made for the show's Gallery and
 * Reels, from a PG picture post or a show portrait. It's an After Dark row only because After Dark's media store makes
 * it, so no After Dark gallery lists it (David, 2026-11-18: "There are PG videos on after dark, can we move them out?").
 * It stays on the show's side, as its showcase post.
 */
export const NOT_A_LIVING_PORTRAIT = `not exists (select 1 from showcase_loops l where l.media_id = i.id)`;

/** Each tab's rows, on adult_images aliased `i`. */
export const TAB_WHERE: Record<GalleryTab, string> = {
  videos: `i.kind = 'video' and not ${IN_NIGHT_REEL}`,
  pictures: `i.kind not in ('video', 'baseline')`,
  faces: `i.kind = 'baseline'`,
};

/** How many each tab holds for this person (Videos = their reels + the clips beside them), as ownMedia lists them. */
export async function galleryCounts(db: Db, ownerId: string): Promise<GalleryCounts> {
  const [{ rows: m }, { rows: r }] = await Promise.all([
    db.query<{ clips: string; pictures: string; faces: string }>(
      `select count(*) filter (where ${TAB_WHERE.videos}) as clips, count(*) filter (where ${TAB_WHERE.pictures}) as pictures,
              count(*) filter (where ${TAB_WHERE.faces}) as faces
         from adult_images i
        where i.owner_id = $1 and i.kind not in ('frame', 'audio') and i.superseded_by is null and ${NOT_A_LIVING_PORTRAIT}`,
      [ownerId],
    ),
    db.query<{ n: string }>(`select count(*) as n from adult_reels where owner_id = $1 and ${SHOWN_NIGHT_REEL}`, [ownerId]),
  ]);
  const clips = Number(m[0]?.clips ?? 0);
  const reels = Number(r[0]?.n ?? 0);
  return { videos: clips + reels, pictures: Number(m[0]?.pictures ?? 0), faces: Number(m[0]?.faces ?? 0), reels, clips };
}
