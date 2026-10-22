import { CHEMISTRY_CARD_SIZE, chemistryCard } from "./card";

export const alt = "Botchelor's free OC chemistry test: will these two characters make it?";
export const size = CHEMISTRY_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the test itself (a result has its own: app/api/og/chemistry). */
export default function Image() {
  return chemistryCard(null);
}
