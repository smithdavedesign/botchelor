import { ocNames } from "@/lib/oc-names";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free OC name generator: fantasy, modern, sci-fi, gothic and cozy names";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the generator: three of the names its first page shows. */
export default function Image() {
  const names = ocNames({}).slice(0, 3).map((n) => n.name);
  return toolCard({ kicker: "OC name generator", headline: "Names for your original character.", sub: `${names.join(" · ")}. Free, no sign-up.` });
}
