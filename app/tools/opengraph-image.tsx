import { TOOL_CARD_SIZE, toolCard } from "./card";

export const alt = "Botchelor's free tools for original characters: names, questions, ship names and chemistry";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/**
 * The link preview for the tools hub (app/tools/page.tsx). Every tool under /tools draws or names its own card, so none
 * of them takes this one.
 */
export default function Image() {
  return toolCard({ kicker: "Free OC tools", headline: "Free tools for original characters", sub: "Names, questions, ship names and chemistry. No sign-up." });
}
