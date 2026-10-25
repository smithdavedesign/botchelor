/**
 * The words for what a picture or clip shows (lib/adult/media-tags.ts): the places a tag can name, and a tile's short
 * label from its tags ("Going down · Movie theater · POV"; David, 2026-10-25: "add a label on what the scene is to each tile").
 * Its own module, with nothing but the acts, so the media listing (lib/adult/media.ts) can use it.
 */
import { ACTS } from "./acts";

/** The places a tag can name, and the words that mean each. The first match in a text wins per key; several can match. */
export const PLACES: readonly { key: string; label: string; re: RegExp }[] = [
  { key: "movie_theater", label: "Movie theater", re: /\b(movie ?theat(?:er|re)s?|cinemas?|movie ?house|picture ?house|the movies|theat(?:er|re) seats?)\b/ },
  { key: "bedroom", label: "Bedroom", re: /\b(bed ?rooms?|in bed|on the bed|white sheets)\b/ },
  { key: "hotel", label: "Hotel", re: /\b(hotel|suite)\b/ },
  { key: "motel", label: "Motel", re: /\bmotel\b/ },
  { key: "shower", label: "Shower", re: /\bshowers?\b/ },
  { key: "bath", label: "Bath", re: /\b(bath ?tubs?|bath\b|bathroom|jacuzzi|hot ?tub)\b/ },
  { key: "sofa", label: "Sofa", re: /\b(sofa|couch|living ?room)\b/ },
  { key: "kitchen", label: "Kitchen", re: /\bkitchen\b/ },
  { key: "candlelit", label: "Candlelit room", re: /\bcandle/ },
  { key: "cabin", label: "Cabin", re: /\b(cabin|fireplace|lodge)\b/ },
  { key: "sauna", label: "Sauna", re: /\bsauna\b/ },
  { key: "studio", label: "Photo studio", re: /\b(studio backdrop|photo studio|grey backdrop)\b/ },
  { key: "beach", label: "Beach", re: /\b(beach|shore|sand dunes?)\b/ },
  { key: "pool", label: "Pool", re: /\b(swimming )?pool\b/ },
  { key: "rooftop", label: "Rooftop", re: /\broof ?tops?\b/ },
  { key: "bar", label: "Bar", re: /\b(bar|pub|cocktail lounge|nightclub|club)\b/ },
  { key: "restaurant", label: "Restaurant", re: /\b(restaurant|diner|caf[eé]|bistro)\b/ },
  { key: "car", label: "Car", re: /\b(car|back ?seat|front ?seat)\b/ },
  { key: "office", label: "Office", re: /\b(office|desk)\b/ },
  { key: "garden", label: "Garden or park", re: /\b(garden|park|forest|woods|meadow)\b/ },
  { key: "gym", label: "Gym", re: /\b(gym|locker ?room)\b/ },
  { key: "boat", label: "Boat", re: /\b(boat|yacht|ferry)\b/ },
  { key: "balcony", label: "Balcony", re: /\b(balcony|terrace)\b/ },
  { key: "elevator", label: "Elevator", re: /\b(elevator|lift)\b/ },
];

/** A tile's label from its act, place and first-person tags: the act, the place, POV; null when it has none of them. */
export function showsLabel(tags: readonly { kind: string; value: string }[] | null | undefined): string | null {
  const of = (kind: string) => (tags ?? []).filter((t) => t.kind === kind).map((t) => t.value);
  const acts = of("act").map((id) => ACTS.find((a) => a.id === id)?.label).filter((x): x is string => Boolean(x));
  const places = of("place").map((key) => PLACES.find((p) => p.key === key)?.label).filter((x): x is string => Boolean(x));
  const parts = [acts[0], places[0], of("pov").length ? "POV" : undefined].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
