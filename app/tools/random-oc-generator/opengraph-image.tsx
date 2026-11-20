import { randomOcs, roleLine } from "@/lib/random-oc";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free random OC generator: a whole original character in one click";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the generator: the first character its first page shows. */
export default function Image() {
  const [oc] = randomOcs({});
  return toolCard({ kicker: "Random OC generator", headline: "A whole original character in one click.", sub: oc ? `${oc.name}, ${roleLine(oc)}.` : "Free, no sign-up." });
}
