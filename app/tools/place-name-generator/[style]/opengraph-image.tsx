import { PLACE_STYLE_INFO, placeNames, readPlaceStyle } from "@/lib/place-names";
import { TOOL_CARD_SIZE, toolCard } from "../../card";

export const alt = "Botchelor's free place name generator";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** A style page's preview: its title and three of the places it shows. */
export default async function Image({ params }: { params: Promise<{ style: string }> }) {
  const style = readPlaceStyle((await params).style) ?? "fantasy";
  const names = placeNames({ style }).slice(0, 3).map((p) => p.name);
  return toolCard({ kicker: "Place name generator", headline: PLACE_STYLE_INFO[style].title, sub: `${names.join(" · ")}. Free, no sign-up.` });
}
