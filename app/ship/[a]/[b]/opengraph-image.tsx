import { nameFromSegment, shipPair } from "@/lib/ship-names";
import { SHIP_CARD_SIZE, shipCard } from "../../card";

export const alt = "Ship names for two original characters, from Botchelor's free OC ship name generator";
export const size = SHIP_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for /ship/<a>/<b>: the pair and their top ship names (lib/ship-names.ts). */
export default async function Image({ params }: { params: Promise<{ a: string; b: string }> }) {
  const { a, b } = await params;
  const pair = shipPair(nameFromSegment(a), nameFromSegment(b));
  return shipCard(pair.ok ? { a: pair.a.display, b: pair.b.display, names: pair.names.map((n) => n.name) } : null);
}
