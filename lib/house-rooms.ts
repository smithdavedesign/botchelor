/**
 * The show's house, room by room (lib/house-scenes.ts HOUSE_PLACES): where the cast talk over the dates that aired. Like
 * the show's sets (lib/show-sets.ts) they're reviewed files in `public/cast`, drawn empty and free on Workers AI with
 * the backdrop-v3 prompt (scripts/prompts.mjs freeBackdropPrompt), and `tests/house-rooms.test.ts` checks each file is
 * on disk. A scene on /house runs over its room (app/HouseScene.tsx).
 *
 * Client-safe: pure constants, no server imports.
 */
import type { HousePlaceId } from "./house-scenes";

/** Each room, empty, as it was drawn (the plate goes into freeBackdropPrompt). No people and no lettering. */
export const HOUSE_ROOM_PLATES: Record<HousePlaceId, string> = {
  kitchen:
    "an empty modern villa kitchen late at night, a long white marble island with three tall stools, a sink with a few stacked plates and a tea towel, warm pendant lights glowing low, dark windows, a bowl of lemons",
  terrace:
    "an empty villa terrace after dark, warm string lights zigzagging overhead, two rattan loungers and a low table with candles, potted olive trees, the lights of a distant city in soft blur",
  stairs:
    "an empty wide floating staircase inside a modern villa at night, warm oak steps, a glass balustrade, one soft wall light halfway up, a large abstract painting in pink and gold, shadows gathering at the top",
  sofa:
    "an empty huge curved pink velvet sofa in a villa living room at night, piled cushions and a throw, a large wall screen glowing with a blurred pink and gold picture, a low coffee table with two mugs, warm lamps",
  pool:
    "the empty edge of a glowing turquoise villa pool at night, underwater lights rippling, wet stone tiles, two rolled towels on the edge, palm silhouettes against a deep blue sky, warm house windows behind",
  laundry:
    "an empty villa laundry room at night, two front-loading washing machines, a wooden folding counter with a tall stack of fluffy towels, a hanging rail with a few shirts, a small dark window, warm overhead light",
};

/** The version in the files' names: a redrawn room gets a new one, so a cached old picture is never shown for it. */
export const HOUSE_ROOM_VERSION = "v1";

/** A scene's place as one of the rooms: an unknown one is the kitchen, as lib/house-scenes.ts housePlace has it. */
export const houseRoom = (place: string): HousePlaceId => (Object.hasOwn(HOUSE_ROOM_PLATES, place) ? (place as HousePlaceId) : "kitchen");

export const houseRoomPath = (place: string): string => `/cast/house-${houseRoom(place)}-${HOUSE_ROOM_VERSION}.webp`;

/** The hour the house camera shows in each room, in keeping with when the cast are there (HOUSE_PLACES `when`). */
const ROOM_HOUR: Record<HousePlaceId, number> = { kitchen: 23, terrace: 22, stairs: 0, sofa: 21, pool: 22, laundry: 20 };

/**
 * The house camera's clock on a scene ("22:47"): set dressing, like the REC light beside it. The room's hour, and
 * minutes from the scene's id, so a scene always shows the same time.
 */
export function houseCamTime(place: string, sceneId: string): string {
  let h = 0;
  for (let i = 0; i < sceneId.length; i++) h = (h * 31 + sceneId.charCodeAt(i)) >>> 0;
  return `${String(ROOM_HOUR[houseRoom(place)]).padStart(2, "0")}:${String(h % 60).padStart(2, "0")}`;
}

/**
 * A room as a CSS background, darkened so the lines over it read: `scrim` is how dark the top is, and the bottom is
 * darker still. The same wash as the sets (lib/show-sets.ts showSetBackground).
 */
export const houseRoomBackground = (place: string, scrim = 0.55): string =>
  `linear-gradient(180deg, rgba(14,8,20,${scrim}) 0%, rgba(14,8,20,${Math.min(0.94, Math.round((scrim + 0.3) * 100) / 100)}) 100%), url(${houseRoomPath(place)})`;
