import { firstName, randomShip } from "@/lib/random-ship";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free random ship generator: two characters, their ship name and their chemistry";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/**
 * The link preview for the generator: its first pair of random OCs (no database, as on the tools hub's card), their
 * ship name and their chemistry.
 */
export default function Image() {
  const ship = randomShip(1);
  const name = (s: typeof ship.a) => firstName(s.kind === "cast" ? s.cast.name : s.oc.name);
  const top = ship.ships[0]?.name;
  const sub = top ? `${name(ship.a)} × ${name(ship.b)} makes ${top}: ${ship.chemistry.score}/100. Free, no sign-up.` : "Their ship name and their chemistry. Free, no sign-up.";
  return toolCard({ kicker: "Random ship generator", headline: "Two characters. One ship. One click.", sub });
}
