/**
 * The Who step's card for the character picked (David, 2026-11-24: "Can we add more details on the step in, like about
 * the person you selected, maybe a few images in a small caresol, some locked for premieum subscription how other
 * competitors do"): their bio and type, how many nights the viewer has had with them, and a few pictures to flip
 * through, as Candy-style companion profiles open with.
 *
 * THE PICTURES, IN ORDER: their portrait; their profile photos (PG, pinned by their owner: lib/studio/profile-photos.ts);
 * then After Dark's: the viewer's own pictures of them (as their character page shows them), then what was published
 * of them to After Dark's showcase, as far as this viewer may see it (lib/showcase.ts listShowcase: explicit posts are
 * admins' only until they're opened).
 *
 * LOCKED: someone whose plan has no pictures (a free taste, lib/adult/taste.ts; lib/adult/place.ts mediaAllowedFor)
 * gets the portrait and profile photos, and in place of After Dark's pictures the locked preview's server-blurred tiles
 * of them (lib/adult/preview.ts: nothing explicit leaves the server), each the way to the subscription. Where the tiles
 * aren't allowed (a text-only place, no 18+ cookie) only the count is said. An admin can see it as a taste does
 * (`?locked=1` on the Step in page), to check what's shown.
 */
import { isAdmin } from "../admins";
import { hasAdultCookie } from "../age";
import type { Db } from "../db";
import { authFromRequest } from "../http";
import { characterPortrait } from "../portraits";
import { listShowcase, showcaseViewer, type ShowcaseViewer } from "../showcase";
import { profilePhotos } from "../studio/profile-photos";
import { tagById } from "../tags";
import { adCharacter } from "./character-list";
import { afterDarkDoors } from "./doors";
import { latestMade } from "./latest";
import { ownMedia } from "./media";
import { accessHere, mediaAllowedFor } from "./place";
import { previewOfCharacter, previewTilesAllowed } from "./preview";
import type { WhoDetails, WhoSlide } from "./step-in-shared";

/** As many pictures as the carousel holds. */
export const WHO_SLIDES = 8;
/** Of them, profile photos at most (the rest is After Dark's). */
export const WHO_PHOTOS = 3;
/** Locked tiles at most: enough to show there's more, not a wall of blur. */
export const WHO_LOCKED = 4;
/** Where a locked tile goes: the subscription, with where they came from. */
export const WHO_SUBSCRIBE = "/after-dark/subscribe?source=step-in";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The carousel's pictures in their order, each once, `max` at most. Pure. */
export function whoSlides(parts: { portrait: WhoSlide | null; photos: readonly WhoSlide[]; made: readonly WhoSlide[]; showcase: readonly WhoSlide[]; locked: readonly WhoSlide[] }, max: number = WHO_SLIDES): WhoSlide[] {
  const seen = new Set<string>();
  const out: WhoSlide[] = [];
  for (const s of [...(parts.portrait ? [parts.portrait] : []), ...parts.photos.slice(0, WHO_PHOTOS), ...parts.made, ...parts.showcase, ...parts.locked.slice(0, WHO_LOCKED)]) {
    if (out.length >= max) break;
    if (seen.has(s.src)) continue;
    seen.add(s.src);
    out.push(s);
  }
  return out;
}

/**
 * The card for `id`, or null when it isn't someone After Dark may pair with this viewer (the character page's rule,
 * lib/adult/character-list.ts adCharacter). `media`: this viewer's plan has pictures where they are. `tiles`: the locked
 * preview's tiles may be sent them. `showcase`: who they are to the showcase, or null to leave its posts out.
 */
export async function whoDetails(db: Db, viewer: string, id: string, opts: { media: boolean; tiles: boolean; showcase: ShowcaseViewer | null }): Promise<WhoDetails | null> {
  const c = await adCharacter(db, viewer, id);
  if (!c) return null;
  const name = first(c.name);
  const portraitSrc = characterPortrait(c.id) ?? c.portrait;
  const [photos, own, shown, preview] = await Promise.all([
    profilePhotos(db, c.id).catch(() => []),
    opts.media ? ownMedia(db, viewer, WHO_SLIDES * 3, { character: c.id }) : Promise.resolve([]),
    opts.media && opts.showcase?.ratings.includes("nsfw")
      ? listShowcase(db, opts.showcase, { side: "after_dark", character: c.id, sort: "trending" }, { pageSize: WHO_SLIDES }).then((r) => r.posts)
      : Promise.resolve([]),
    opts.media ? Promise.resolve(null) : previewOfCharacter(db, c.id, opts.tiles ? WHO_LOCKED : 0),
  ]);
  const made: WhoSlide[] = latestMade(own, WHO_SLIDES)
    // A video by its picture (nothing of it loads); one with none is left to the Gallery.
    .map((m) => (m.kind === "video" ? (m.poster ? m.poster : null) : m.id))
    .filter((m): m is string => Boolean(m))
    .map((m) => ({ key: `made:${m}`, kind: "made", src: `/api/admin/after-dark/media/${m}?w=640`, alt: `One of your pictures of ${name}` }));
  // A post of one of the viewer's own pictures is that picture again: it shows once, as theirs.
  const ownIds = new Set(own.map((m) => m.id));
  const showcase: WhoSlide[] = shown
    // A clip by its still (its `?size=` copy); one with none is left to the Showcase.
    .filter((p) => !ownIds.has(p.media_id) && (p.medium === "picture" || p.poster))
    .map((p) => {
      const url = p.media ?? `/api/showcase/${p.id}/media`;
      return { key: `showcase:${p.id}`, kind: "showcase", src: `${url}${url.includes("?") ? "&" : "?"}size=tile`, alt: `${name} on the Showcase` };
    });
  const locked: WhoSlide[] = (preview?.tiles ?? []).map((t) => ({ key: `locked:${t.id}`, kind: "locked", src: `/api/after-dark/preview/${encodeURIComponent(t.id)}`, alt: `A picture of ${name}, with the subscription` }));
  const slides = whoSlides({
    portrait: portraitSrc ? { key: "portrait", kind: "portrait", src: portraitSrc, alt: c.name } : null,
    photos: photos.map((p) => ({ key: `photo:${p.asset_id}`, kind: "photo", src: p.url, alt: `A photo of ${name}` })),
    made,
    showcase,
    locked,
  });
  const held = preview ? preview.pictures + preview.videos : 0;
  return {
    id: c.id,
    name: c.name,
    bio: c.bio,
    tags: c.tags.map((t) => tagById(t)).flatMap((t) => (t ? [{ id: t.id, label: t.label, icon: t.icon }] : [])),
    nights: c.nights,
    house: c.house,
    mine: c.mine,
    slides,
    locked: held > 0 ? { count: held, href: WHO_SUBSCRIBE } : null,
    page: `/after-dark/characters/${encodeURIComponent(c.id)}`,
  };
}

/**
 * The card as this request sees it (the Who route, and the Step in page for the one it opens on): pictures when their
 * plan has them where they are, else the locked preview's tiles where those are allowed (its own rule; the tile route
 * checks it again), and the Showcase's posts as far as they may see that side. `asTaste`: an admin's look at it as a
 * free taste sees it (ignored for anyone else).
 */
export async function whoCard(db: Db, viewer: string, id: string, ctx: { headers: Headers; asTaste?: boolean }): Promise<WhoDetails | null> {
  const req = new Request("https://botchelor.local/after-dark/step-in", { headers: ctx.headers });
  const asTaste = Boolean(ctx.asTaste) && (await isAdmin(db, viewer));
  const media = !asTaste && (await mediaAllowedFor(db, viewer));
  const tiles = media ? false : previewTilesAllowed({ bot: false, attested: hasAdultCookie(ctx.headers.get("cookie")), mode: (await accessHere(db, authFromRequest(req), ctx.headers)).mode });
  const showcase = media && (await afterDarkDoors(db, viewer)).showcase ? await showcaseViewer(db, req) : null;
  return whoDetails(db, viewer, id, { media, tiles, showcase });
}
