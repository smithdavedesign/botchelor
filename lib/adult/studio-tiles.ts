/**
 * The Studio's example pictures (David, 2026-10-24: "presets … as options on the shoot like they do"): one tile per
 * shoot option worth seeing, per gender, of a stock adult model, drawn by us like the looks builder's tiles
 * (lib/looks-draw.ts, kept in look_tiles, explicit ones on Venice and checked). Never another site's pictures.
 *
 * A tile's id is `nsfw-<gender>-studio_<group>-<option>`, so /api/looks/[id] serves it to After Dark only. They are
 * drawn only when the admin asks for the Studio's set by name (POST /api/admin/looks `set: "studio"`): a looks batch
 * never spends on them. A chip with no tile drawn stays a word.
 *
 * Pure: no database, no model.
 */
import { GENDERS, type Gender } from "../looks";
import type { TileSpec } from "../looks";
import { STUDIO_GROUPS, wordsFor, type GroupId, type StudioOption } from "./studio-catalog";

/** The groups whose options are worth a picture: what's happening, the pose, the POV, the clothes and the place. */
export const TILE_GROUPS: readonly GroupId[] = ["filthy", "pose", "pov", "wardrobe", "place"];

/** The stock model every tile holds fixed, so the option is what differs. */
const MODEL: Record<Gender, string> = {
  woman: "a 27-year-old adult woman with long straight brunette hair and brown eyes, slim build",
  man: "a 30-year-old adult man with short brunette hair, light stubble and brown eyes, athletic build",
};
const SEEDS: Record<Gender, number> = { woman: 270_221, man: 300_221 };

export const studioTileId = (gender: Gender, group: GroupId, option: string): string => `nsfw-${gender}-studio_${group}-${option.replace(/_/g, "-")}`;

/** What they wear in a tile that isn't about clothes: as much as the option's level shows. */
const WORN = (level: number, gender: Gender) => (level >= 2 ? "fully nude" : gender === "man" ? "only tight black briefs" : "a black lace lingerie set");

function tilePrompt(gender: Gender, group: GroupId, o: StudioOption): string {
  const words = wordsFor(o, gender);
  const tail = `Photorealistic, natural skin texture, ${o.level >= 3 ? "explicit, uncensored" : o.level >= 2 ? "uncensored" : "sensual"}. Everyone shown is an adult.`;
  const who = MODEL[gender];
  switch (group) {
    case "wardrobe":
      return [`Adult photograph of ${who}, wearing ${words === "{their outfit}" ? "a fitted white t-shirt and blue jeans" : words}.`, "Full-length shot, standing, facing the camera, the whole outfit in frame, a softly lit bedroom.", tail].join(" ");
    case "place":
      return [`Adult photograph of ${who} in ${words}, wearing an open silk robe.`, "A wide shot: the place is the main subject, the person small in it, face visible.", tail].join(" ");
    case "pov":
      return [`Adult photograph of ${who}, wearing ${WORN(o.level, gender)}. ${words}.`, "A softly lit bedroom.", tail].join(" ");
    default:
      return [
        `Adult photograph of ${who}, ${group === "filthy" ? "fully nude" : WORN(o.level, gender)}: ${words}.`,
        o.withViewer ? "Of the viewer, at most hands, hips or legs at the edge of the frame, never a face." : "A single person.",
        "A softly lit bedroom with white sheets.",
        tail,
      ].join(" ");
  }
}

/** Every Studio tile: per gender, every option of the tile groups that the gender can pick. */
export function studioTileSpecs(): TileSpec[] {
  const out: TileSpec[] = [];
  for (const gender of GENDERS) {
    for (const g of STUDIO_GROUPS.filter((x) => TILE_GROUPS.includes(x.id))) {
      for (const o of g.options) {
        if (o.only && o.only !== gender) continue;
        if (g.id === "wardrobe" && o.id === "theirs") continue;
        out.push({ id: studioTileId(gender, g.id, o.id), variant: "nsfw", gender, step: `studio_${g.id}`, option: o.id, seed: SEEDS[gender], prompt: tilePrompt(gender, g.id, o) });
      }
    }
  }
  return out;
}
