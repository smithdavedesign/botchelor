/**
 * The pure half of After Dark's header doors (lib/adult/doors.ts decides them on the server; app/Nav.tsx draws them):
 * nothing here touches the database, so the client nav can import it.
 */
export type AdDoors = { studio: boolean; showcase: boolean };
export const NO_AD_DOORS: AdDoors = { studio: false, showcase: false };

/** The Studio door's word: the Studio where it's open to them, else what its page holds for them, who's in. */
export const studioDoorLabel = (doors: Pick<AdDoors, "studio">): string => (doors.studio ? "Studio" : "Characters");

/** The showcase's After Dark side, on the show's host (`showHref`: lib/site.ts showHome). */
export const showcaseHref = (showHref: string): string => `${showHref.replace(/\/$/, "")}/showcase?side=after_dark`;
