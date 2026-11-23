import { randomShip } from "@/lib/random-ship";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free random ship generator: two characters, their ship name and their chemistry";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the generator: a pair of random OCs (no database), their ship name and their chemistry. */
export default function Image() {
  const ship = randomShip(3);
  const name = (s: typeof ship.a) => (s.kind === "cast" ? s.cast.name : s.oc.name).split(" ")[0];
  const top = ship.ships[0]?.name;
  const sub = top ? `${name(ship.a)} × ${name(ship.b)} makes ${top}: ${ship.chemistry.score}/100. Free, no sign-up.` : "Their ship name and their chemistry. Free, no sign-up.";
  return toolCard({ kicker: "Random ship generator", headline: "Two characters. One ship. One click.", sub });
}
