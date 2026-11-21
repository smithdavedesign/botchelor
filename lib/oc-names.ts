/**
 * The OC name generator (app/tools/oc-name-generator): names for an original character, by style and kind.
 *
 * Pure and deterministic, like the ship name generator (lib/ship-names.ts): no model, no randomness, no database. A
 * style, a kind and a batch number always give the same twelve names, so every page of names is a link anyone can
 * share, and it works with no model key at all.
 *
 * Modern, gothic and cozy names pair a hand-picked first name with a hand-picked surname. Fantasy and sci-fi first
 * names are built from syllables (a start, sometimes a middle, an ending that leans the way the kind asks), and their
 * surnames are two hand-picked pieces joined ("Ash" + "vale"). Every full name goes through the show's content filter
 * (lib/safety.ts), so a pairing that lands on a well-known real person is dropped, not shown.
 */
import { drawName, OC_NAME_KINDS, OC_NAME_STYLES, pick, seeded, type OcName, type OcNameKind, type OcNameStyle } from "./oc-name-pools";
import { checkFields } from "./safety";

// The lists and draws live in lib/oc-name-pools.ts (no imports, so a plain script can load them); this module's own
// exports stay as they were.
export { OC_NAME_KINDS, OC_NAME_STYLES, pick, seeded };
export type { OcName, OcNameKind, OcNameStyle } from "./oc-name-pools";

export const OC_NAMES_PATH = "/tools/oc-name-generator";
/** How many names one page shows. */
export const OC_NAMES_SHOWN = 12;
/** The highest batch an address takes; past it the batch number wraps around. */
export const OC_NAMES_MAX_BATCH = 999;

/** How each style is named on the page, and the line under its heading. */
export const OC_NAME_STYLE_INFO: Record<OcNameStyle, { label: string; title: string; blurb: string }> = {
  fantasy: { label: "Fantasy", title: "Fantasy OC name generator", blurb: "Names for elves, mages, knights and wanderers: soft or sharp first names, and surnames that sound like a place." },
  modern: { label: "Modern", title: "Modern OC name generator", blurb: "Names someone could have today: a first name and a surname you'd believe on a coffee cup or a cast list." },
  scifi: { label: "Sci-fi", title: "Sci-fi OC name generator", blurb: "Names for pilots, androids, colonists and station crews: short, hard-edged first names and surnames from far away." },
  gothic: { label: "Gothic", title: "Gothic OC name generator", blurb: "Names for old houses and older secrets: Victorian first names and surnames with a crow on the gate." },
  cozy: { label: "Cozy", title: "Cozy OC name generator", blurb: "Names for bakers, cottage witches and small-town romances: warm first names and surnames you'd find on a shop sign." },
};
export const OC_NAME_KIND_LABELS: Record<OcNameKind, string> = { any: "Any", feminine: "Feminine", masculine: "Masculine", neutral: "Neutral" };

/**
 * One name in a style, drawn from `rand` until the content filter takes it (the random OC generator, lib/random-oc.ts,
 * draws its names here). `avoid`: first names and surname families already used, so a page never repeats one; null
 * when none is free.
 */
export function drawOcName(rand: () => number, style: OcNameStyle, kind: OcNameKind, avoid: Set<string> = new Set()): OcName | null {
  let drawn = drawName(rand, style, kind);
  for (let tries = 0; tries < 40; tries++) {
    const [first, last] = drawn.name.split(" ");
    const family = `last:${last.split("-")[0]}`;
    if (!avoid.has(first) && !avoid.has(family) && checkFields({ name: drawn.name }).ok) {
      avoid.add(first);
      avoid.add(family);
      return drawn;
    }
    drawn = drawName(rand, style, kind);
  }
  // None free in forty draws (a small list, a full page): the caller draws again or stops.
  return null;
}

/**
 * A page of names: OC_NAMES_SHOWN of them, no first name or surname twice, none the content filter refuses. With no style, the page mixes
 * every style in turn. The same style, kind and batch always give the same page.
 */
export function ocNames({ style, kind = "any", batch = 1 }: { style?: OcNameStyle | null; kind?: OcNameKind; batch?: number }): OcName[] {
  const rand = seeded(`oc-names|${style ?? "mixed"}|${kind}|${batch}`);
  const seen = new Set<string>();
  const out: OcName[] = [];
  for (let tries = 0; out.length < OC_NAMES_SHOWN && tries < OC_NAMES_SHOWN * 20; tries++) {
    const s = style ?? OC_NAME_STYLES[out.length % OC_NAME_STYLES.length];
    const drawn = drawName(rand, s, kind);
    // No first name, and no surname family ("Kade" in Kade-Lin), twice on a page.
    const [first, last] = drawn.name.split(" ");
    const family = `last:${last.split("-")[0]}`;
    if (seen.has(first) || seen.has(family)) continue;
    if (!checkFields({ name: drawn.name }).ok) continue;
    seen.add(first);
    seen.add(family);
    out.push(drawn);
  }
  return out;
}

/** A style from an address segment ("sci-fi" and "scifi" both read as sci-fi), or null. */
export function readStyle(raw: unknown): OcNameStyle | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  return (OC_NAME_STYLES as readonly string[]).includes(s) ? (s as OcNameStyle) : null;
}

export function readKind(raw: unknown): OcNameKind {
  return typeof raw === "string" && (OC_NAME_KINDS as readonly string[]).includes(raw) ? (raw as OcNameKind) : "any";
}

/** A batch number from an address: a whole number from 1 to OC_NAMES_MAX_BATCH, otherwise 1. */
export function readBatch(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? ((n - 1) % OC_NAMES_MAX_BATCH) + 1 : 1;
}

/** The address of a page of names. The plain style page is its first batch with any kind. */
export function ocNamesHref(style: OcNameStyle | null, kind: OcNameKind = "any", batch = 1): string {
  const base = style ? `${OC_NAMES_PATH}/${style}` : OC_NAMES_PATH;
  const q = new URLSearchParams();
  if (kind !== "any") q.set("kind", kind);
  if (batch !== 1) q.set("batch", String(batch));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Where "Make this character" goes: the builder, with the name already in (app/create/page.tsx reads ?name=). */
export function createWithName(name: string): string {
  return `/create?name=${encodeURIComponent(name)}`;
}
