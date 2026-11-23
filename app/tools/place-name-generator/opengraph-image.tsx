import { placeNames } from "@/lib/place-names";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free place name generator: towns, wilds, realms and taverns for your world";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the generator: three of the places its first page shows. */
export default function Image() {
  const names = placeNames({}).slice(0, 3).map((p) => p.name);
  return toolCard({ kicker: "Place name generator", headline: "Names for the places in your story.", sub: `${names.join(" · ")}. Free, no sign-up.` });
}
