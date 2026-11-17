/**
 * After Dark's own tags, on top of the shared vocabulary (lib/tags.ts; read docs/tags.md). The show never imports this
 * file (tests/adult-imports.test.ts): its pickers, MCP and pages only ever see the PG tags.
 *
 * Two additions:
 *  - one theme, `dark_romance` (the census's strongest theme on adult characters, 1.21×): dangerous people and tender
 *    hearts, held by the same lines as everything else on After Dark (nobody forced, nobody hurt who didn't ask for it);
 *  - a `heat` facet: what the evening's heat is like, chosen from what the census showed people pick and After Dark's
 *    lines allow. Each one that touches a hard no (lib/adult/limits.ts HARD_NOS) names it, so a roleplay with that heat is
 *    marked for a pair whose owner ruled it out, and its tag never overrides the limit.
 *
 * Left out on purpose, whatever the census said (and it said a lot: non-consent 1.25×, breeding 1.30×, group 1.26×,
 * degradation 1.22×, pet play 1.17×, incest framing 1.16×): anything that leans on consent being unclear, restraints
 * (After Dark's never-list: nobody tied up), family or school framing, anyone young, sex work, obsession, mind control,
 * and real or famous people. Breeding, group scenes, degradation, pet play, feet and futa are not refused by the lines
 * as such; they wait for David's call on what the payment processors accept (docs/tags.md "Not yet").
 */
import { byDemand, TAGS, type CensusDemand, type TagDef, type TagId } from "../tags";

export const ADULT_TAG_FACETS = [
  { id: "setup", label: "Between them" },
  { id: "theme", label: "Kind of story" },
  { id: "heat", label: "Heat" },
  { id: "type", label: "Type" },
] as const;
export type AdultTagFacet = (typeof ADULT_TAG_FACETS)[number]["id"];

/** `hardNo`: the lib/adult/limits.ts HARD_NOS id this heat runs into (tests/tags.test.ts holds it to that list). */
export type AdultTagDef = TagDef & { hardNo?: string };

const c = (sfw: number | null, nsfw: number | null): CensusDemand => ({ sfw, nsfw });

export const ADULT_ONLY_TAGS = [
  { id: "dark_romance", label: "Dark romance", icon: "🥀", facet: "theme", about: "Dangerous people, tender hearts: nobody ever forced.", census: c(1.12, 1.21) },
  { id: "tender", label: "Tender", icon: "🤍", facet: "heat", about: "Slow, close and kind.", census: c(null, null) },
  { id: "tease", label: "Tease", icon: "🪶", facet: "heat", about: "All looks, near-misses and making them wait.", census: c(null, 0.95) },
  { id: "praise", label: "Praise", icon: "🌹", facet: "heat", about: "Told how good they look, and how good they are.", census: c(null, 1.17) },
  { id: "dress_up", label: "Dressing up", icon: "👗", facet: "heat", about: "Lingerie, costumes and the reveal.", census: c(null, 1.09) },
  { id: "size_difference", label: "Size difference", icon: "🏔️", facet: "heat", about: "One of them much bigger than the other.", census: c(null, 1.19) },
  { id: "gentle_dom", label: "Gently in charge", icon: "🤲", facet: "heat", about: "One leads, softly, and checks in.", census: c(null, 1.17), hardNo: "dominance" },
  { id: "dom_sub", label: "Dom & sub", icon: "🔑", facet: "heat", about: "Orders given and taken, all agreed out loud first.", census: c(null, 1.08), hardNo: "dominance" },
  { id: "switch", label: "Switch", icon: "🔄", facet: "heat", about: "Who's in charge changes hands.", census: c(null, 1.06), hardNo: "dominance" },
  { id: "dirty_talk", label: "Dirty talk", icon: "💬", facet: "heat", about: "Says exactly what they want, out loud.", census: c(null, null), hardNo: "dirty_talk" },
] as const satisfies readonly AdultTagDef[];

/** Every tag After Dark knows: the shared ones and its own. */
export const ADULT_TAGS: readonly AdultTagDef[] = [...TAGS, ...ADULT_ONLY_TAGS];
export type AdultTagId = TagId | (typeof ADULT_ONLY_TAGS)[number]["id"];

const BY_ID: ReadonlyMap<string, AdultTagDef> = new Map(ADULT_TAGS.map((t) => [t.id, t]));
export const adultTagById = (id: string): AdultTagDef | undefined => BY_ID.get(id);
export const isAdultTagId = (id: unknown): id is AdultTagId => typeof id === "string" && BY_ID.has(id);
export const adultTagsIn = (facet: AdultTagFacet): readonly AdultTagDef[] => ADULT_TAGS.filter((t) => t.facet === facet);

/** The hard nos a set of tags runs into: a roleplay with any of them is marked for a pair that ruled one out. */
export function tagHardNos(tags: readonly string[], chips: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of tags) {
    const h = BY_ID.get(id)?.hardNo;
    if (h && chips.includes(h)) out.add(h);
  }
  return [...out];
}

/** One shelf of a roleplay picker: a tag (or ✨ Yours), how many roleplays it holds, and which. */
export type RoleplayShelf = { id: string; label: string; icon: string; about: string; count: number; has: (r: { id: string; tags?: readonly string[] }) => boolean };

/**
 * The shelves After Dark's roleplay pickers show (Set the scene, Step in): a first row of ✨ Yours (a person's own, ids
 * "u:…") and who they are to each other, and a second of the kind of story and its heat. Only tags some roleplay has,
 * each row in order of demand (Botchelor's own when `demand` has it, else the census's adult column).
 */
export function roleplayShelves(roleplays: readonly { id: string; tags?: readonly string[] }[], demand: Readonly<Record<string, number>> = {}): [RoleplayShelf[], RoleplayShelf[]] {
  const count = (id: string) => roleplays.filter((r) => r.tags?.includes(id)).length;
  const shelf = (t: AdultTagDef): RoleplayShelf => ({ id: t.id, label: t.label, icon: t.icon, about: t.about, count: count(t.id), has: (r) => Boolean(r.tags?.includes(t.id)) });
  const used = (facet: string) => byDemand(ADULT_TAGS.filter((t) => t.facet === facet && count(t.id) > 0), "nsfw", demand).map(shelf);
  const mine = roleplays.filter((r) => r.id.startsWith("u:")).length;
  const yours: RoleplayShelf[] = mine ? [{ id: "yours", label: "Yours", icon: "✨", about: "The ones you made in the Studio", count: mine, has: (r) => r.id.startsWith("u:") }] : [];
  return [
    [...yours, ...used("setup")],
    [...used("theme"), ...used("heat")],
  ];
}

/** A dropdown's groups (Step in): each roleplay under its first "between them" tag, most wanted first, the rest last. */
export function roleplayGroups<R extends { tags?: readonly string[] }>(roleplays: readonly R[], demand: Readonly<Record<string, number>> = {}): { id: string; label: string; roleplays: R[] }[] {
  const firstSetup = (r: R) => r.tags?.find((t) => BY_ID.get(t)?.facet === "setup") ?? null;
  const setups = byDemand(ADULT_TAGS.filter((t) => t.facet === "setup"), "nsfw", demand);
  const groups = setups.map((t) => ({ id: t.id, label: t.label, roleplays: roleplays.filter((r) => firstSetup(r) === t.id) }));
  const rest = roleplays.filter((r) => firstSetup(r) === null);
  return [...groups, ...(rest.length ? [{ id: "more", label: "More", roleplays: rest }] : [])].filter((g) => g.roleplays.length);
}
