/**
 * The structured side of a character (data plan Tier 2, David 2026-10-22): what they are (kind), the type they play
 * (archetype), what they're here for (goal) and the kinds they're drawn to. All optional, all public, all in `extras`
 * (lib/extras.ts). One source for the builder, the API, the MCP schema and the tests. Pure: no server imports.
 *
 * The engine never reads any of it: a date's ending stays a function of the sheet and the seed. `drawn_to` only nudges
 * the order of a swipe deck (lib/swipes.ts deckFor), never who's in it.
 */

/** What a character is. "other" takes a short label of the owner's own (extras.kind_label). */
export const KINDS = [
  { id: "human", label: "Human", emoji: "🧑" },
  { id: "vampire", label: "Vampire", emoji: "🧛" },
  { id: "werewolf", label: "Werewolf", emoji: "🐺" },
  { id: "ghost", label: "Ghost", emoji: "👻" },
  { id: "robot", label: "Robot", emoji: "🤖" },
  { id: "alien", label: "Alien", emoji: "👽" },
  { id: "witch", label: "Witch", emoji: "🧙" },
  { id: "fae", label: "Fae", emoji: "🧚" },
  { id: "merfolk", label: "Merfolk", emoji: "🧜" },
  { id: "monster", label: "Monster", emoji: "🦑" },
  { id: "animal", label: "Talking animal", emoji: "🦊" },
  { id: "other", label: "Something else", emoji: "✨" },
] as const;
export type KindId = (typeof KINDS)[number]["id"];
export const KIND_IDS = KINDS.map((k) => k.id) as unknown as readonly [KindId, ...KindId[]];
export const KIND_LABEL_MAX = 30;

/** The kinds a character can be drawn to: any named kind ("other" means nothing to match on). At most four. */
export const DRAWN_TO_IDS = KIND_IDS.filter((k) => k !== "other") as unknown as readonly [Exclude<KindId, "other">, ...Exclude<KindId, "other">[]];
export const DRAWN_TO_MAX = 4;

/** The type they play: the show's own house archetypes, so people's characters and the cast share one vocabulary. */
export const ARCHETYPES = [
  { id: "showman", label: "The showman" },
  { id: "mysterious_loner", label: "The mysterious loner" },
  { id: "gentle_giant", label: "The gentle giant" },
  { id: "sarcastic_romantic", label: "The sarcastic romantic" },
  { id: "confident_flirt", label: "The confident flirt" },
  { id: "awkward_intellectual", label: "The awkward intellectual" },
  { id: "chaotic_extrovert", label: "The chaotic extrovert" },
  { id: "sceptic", label: "The sceptic" },
  { id: "caretaker", label: "The caretaker" },
  { id: "thrill_seeker", label: "The thrill-seeker" },
  { id: "fixer", label: "The fixer" },
  { id: "grande_dame", label: "The grande dame" },
  { id: "earnest_optimist", label: "The earnest optimist" },
  { id: "competitive_perfectionist", label: "The competitive perfectionist" },
  { id: "drifter", label: "The drifter" },
  { id: "charming_menace", label: "The charming menace" },
  { id: "quiet_authority", label: "The quiet authority" },
] as const;
export type ArchetypeId = (typeof ARCHETYPES)[number]["id"];
export const ARCHETYPE_IDS = ARCHETYPES.map((a) => a.id) as unknown as readonly [ArchetypeId, ...ArchetypeId[]];

/** "The thrill-seeker" → "thrill_seeker"; null when it isn't one of ours (a generated candidate's own invention). */
export function archetypeId(label: string): ArchetypeId | null {
  const id = label.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_");
  return (ARCHETYPE_IDS as readonly string[]).includes(id) ? (id as ArchetypeId) : null;
}

/** What they're here for (extras.here_for): `want` already says who they're looking for, this is what for. */
export const GOALS = [
  { id: "long_term", label: "Something real" },
  { id: "casual", label: "Something casual" },
  { id: "friendship", label: "New friends" },
  { id: "chaos", label: "Pure chaos" },
  { id: "figuring_it_out", label: "Figuring it out" },
] as const;
export type GoalId = (typeof GOALS)[number]["id"];
export const GOAL_IDS = GOALS.map((g) => g.id) as unknown as readonly [GoalId, ...GoalId[]];

const KIND_BY_ID = new Map<string, (typeof KINDS)[number]>(KINDS.map((k) => [k.id, k]));
const ARCHETYPE_BY_ID = new Map<string, string>(ARCHETYPES.map((a) => [a.id, a.label]));
const GOAL_BY_ID = new Map<string, string>(GOALS.map((g) => [g.id, g.label]));

/** "🧛 Vampire", or the owner's own label for "other" ("✨ Lighthouse spirit"); null when unsaid. */
export function kindLabel(extras: { kind?: string | null; kind_label?: string | null } | null | undefined): string | null {
  const k = extras?.kind ? KIND_BY_ID.get(extras.kind) : undefined;
  if (!k) return null;
  const name = k.id === "other" && extras?.kind_label?.trim() ? extras.kind_label.trim() : k.label;
  return `${k.emoji} ${name}`;
}
export const archetypeLabel = (id: string | null | undefined): string | null => (id ? (ARCHETYPE_BY_ID.get(id) ?? null) : null);
export const goalLabel = (id: string | null | undefined): string | null => (id ? (GOAL_BY_ID.get(id) ?? null) : null);
export const kindName = (id: string): string => KIND_BY_ID.get(id)?.label ?? id;

/** The swipe deck's small nudge (lib/swipes.ts): less than a like-back (2) or a shared trait (3). Never a filter. */
export const DRAWN_TO_BOOST = 1.5;

/** The boost a card gets in a deck: `theirKind` is one of the kinds `mine` is drawn to. */
export function drawnToBoost(drawnTo: readonly string[] | null | undefined, theirKind: string | null | undefined): number {
  return theirKind && drawnTo?.includes(theirKind) ? DRAWN_TO_BOOST : 0;
}
