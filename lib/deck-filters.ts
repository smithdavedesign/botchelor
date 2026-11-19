/**
 * What a swipe deck shows (David, 2026-11-19: "maybe add a preference filter (Agent made, human made, type, tags, etc)"):
 * who made them, how they're drawn, what they are and their type tag. The same words /characters filters by
 * (lib/directory.ts): style is the art style, type a type tag (lib/tags.ts), kind what they are (lib/kinds.ts).
 *
 * A filter narrows the deck's pool in SQL (lib/swipes.ts deckPool), so it reads every character that passes, not a
 * page of the deck and then a filter. With any filter set, the house cast isn't slotted into the page: a card shows
 * only when it passes.
 *
 * Pure, no server imports: the swipe page, its deck (a client component) and the API share it. They carry it in the
 * address (?made_by=&style=&kind=&type=), so a filtered deck is a link.
 */
import { ART_STYLE_LABEL, isArtStyle, type ArtStyle } from "./art-style";
import { KIND_IDS, KINDS, type KindId } from "./kinds";
import { isTagId, type TagId } from "./tags";

/** Who made them: a person on the site, or an agent over MCP (the house crowd included). The house cast is neither. */
export const DECK_MADE_BY = ["human", "agent"] as const;
export type DeckMadeBy = (typeof DECK_MADE_BY)[number];
export const DECK_MADE_BY_LABEL: Record<DeckMadeBy, string> = { human: "Made by people", agent: "Made by agents" };

export type DeckFilters = {
  made_by: DeckMadeBy | null;
  style: ArtStyle | null;
  kind: KindId | null;
  type: TagId | null;
};

export const NO_DECK_FILTERS: DeckFilters = { made_by: null, style: null, kind: null, type: null };

const isMadeBy = (v: unknown): v is DeckMadeBy => typeof v === "string" && (DECK_MADE_BY as readonly string[]).includes(v);
const isKind = (v: unknown): v is KindId => typeof v === "string" && (KIND_IDS as readonly string[]).includes(v);

/** The filters in an address's query (unknown values are dropped, not refused: an old link still deals a deck). */
export function parseDeckFilters(get: (key: string) => string | null | undefined): DeckFilters {
  const one = (key: string) => {
    const v = get(key);
    return typeof v === "string" ? v.trim().slice(0, 40) : null;
  };
  const made = one("made_by");
  const style = one("style");
  const kind = one("kind");
  const type = one("type");
  return {
    made_by: isMadeBy(made) ? made : null,
    style: isArtStyle(style) ? style : null,
    kind: isKind(kind) ? kind : null,
    type: isTagId(type) ? type : null,
  };
}

/** From a page's searchParams (a value may be a list: the first counts). */
export function deckFiltersFromSearch(sp: Record<string, string | string[] | undefined>): DeckFilters {
  return parseDeckFilters((k) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  });
}

export const hasDeckFilters = (f: DeckFilters): boolean => Boolean(f.made_by || f.style || f.kind || f.type);

/** The filters as query pairs, set ones only, in a fixed order. */
export function deckFilterPairs(f: DeckFilters): [string, string][] {
  const out: [string, string][] = [];
  if (f.made_by) out.push(["made_by", f.made_by]);
  if (f.style) out.push(["style", f.style]);
  if (f.kind) out.push(["kind", f.kind]);
  if (f.type) out.push(["type", f.type]);
  return out;
}

/** The filters as a query string to append ("&made_by=human&style=anime"), or "" with none. */
export const deckFilterQuery = (f: DeckFilters): string => deckFilterPairs(f).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");

/** The filters in words, for an empty deck's note ("made by people, anime"). */
export function deckFiltersSaid(f: DeckFilters, tagLabel: (id: TagId) => string | undefined): string {
  const parts: string[] = [];
  if (f.made_by) parts.push(DECK_MADE_BY_LABEL[f.made_by].toLowerCase());
  if (f.style) parts.push(ART_STYLE_LABEL[f.style].toLowerCase());
  if (f.kind) parts.push((KINDS.find((k) => k.id === f.kind)?.label ?? f.kind).toLowerCase());
  if (f.type) parts.push((tagLabel(f.type) ?? f.type).toLowerCase());
  return parts.join(", ");
}
