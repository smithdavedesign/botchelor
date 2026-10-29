/**
 * The showcase's words for what it filters by (lib/showcase.ts): an act's name (lib/adult/acts.ts), a place's
 * (lib/adult/tag-labels.ts PLACES; a PG pick's from its menu, lib/studio/pg-catalog.ts), a shape's. Pure: the page and
 * the server share it.
 */
import { ACTS } from "./adult/acts";
import { PLACES } from "./adult/tag-labels";
import { PG_GROUPS } from "./studio/pg-catalog";
import { FORMATS } from "./studio/formats";

export const actLabel = (id: string): string => ACTS.find((a) => a.id === id)?.label ?? id.replace(/_/g, " ");

export function placeLabel(key: string): string {
  const ad = PLACES.find((p) => p.key === key)?.label;
  if (ad) return ad;
  const pg = (PG_GROUPS as readonly { id: string; options: readonly { id: string; label: string }[] }[]).find((g) => g.id === "place")?.options.find((o) => o.id === key)?.label;
  return pg ?? (key === "own" ? "Their own place" : key.replace(/_/g, " "));
}

export const shapeLabel = (ratio: string): string => {
  const f = FORMATS.find((x) => x.ratio === ratio);
  return f ? `${f.label} ${f.ratio}` : ratio;
};
