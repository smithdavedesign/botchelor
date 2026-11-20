/**
 * The pure half of After Dark's header doors (lib/adult/doors.ts decides them on the server; app/Nav.tsx draws them):
 * nothing here touches the database, so the client nav can import it.
 */

/**
 * `showcase`: the Gallery shows its Showcase room, the showcase's After Dark side (app/after-dark/GalleryTabs.tsx; a
 * door of the header's own until 2026-11-18).
 */
export type AdDoors = { studio: boolean; showcase: boolean };
export const NO_AD_DOORS: AdDoors = { studio: false, showcase: false };

/**
 * The Studio door's word: the Studio where it's open to them, else what its page holds for them, who's in (their own
 * characters' switches). "Characters" until 2026-11-20, when Characters became its own door (app/after-dark/characters).
 */
export const studioDoorLabel = (doors: Pick<AdDoors, "studio">): string => (doors.studio ? "Studio" : "Who's in");
