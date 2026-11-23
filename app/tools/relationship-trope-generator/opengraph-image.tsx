import { tropes } from "@/lib/relationship-tropes";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free relationship trope generator: random romance tropes for your ship";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the generator: three of the tropes its first page shows. */
export default function Image() {
  const names = tropes({}).slice(0, 3).map((tr) => tr.name);
  return toolCard({ kicker: "Relationship trope generator", headline: "Romance tropes for your ship.", sub: `${names.join(" · ")}. Free, no sign-up.` });
}
