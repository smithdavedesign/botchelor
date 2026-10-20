import { SHIP_CARD_SIZE, shipCard } from "../../ship/card";

export const alt = "Botchelor's free OC ship name generator: two names in, ship names out";
export const size = SHIP_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the generator itself. */
export default function Image() {
  return shipCard(null);
}
