/**
 * One vocabulary of tags (David, 2026-11-17: "bring this level of tagging, themes, roleplay in … keep in mind the
 * characters relational db and social structure as well as NSFW and SFW"). Read docs/tags.md first.
 *
 * Where it came from: the Character Image Census (David's research artifact, 2026-11-17: 11,160 characters on 40
 * platforms, each with its popularity percentile on its own platform, and 38,912 Chub cards over time). Its lessons, in
 * short: the setup between two people and the character's type move popularity far more than genre does (settings
 * barely move it at all, 0.81× to 1.06×, so places stay the venues' job and are not tags); the most common setups and
 * types are average, and the rarer ones with some push and pull do better; mystery and comedy are the weakest themes.
 *
 * Three facets live here, all of them PG and shared by the show, companions and After Dark:
 *  - `setup`: who the two of them are to each other (rivals, second chance, fake dating…);
 *  - `theme`: what kind of story it is (drama, fantasy, heists…);
 *  - `type`: what kind of person a character is (cold then warm, sunshine, takes charge…).
 * After Dark adds its own in lib/adult/tags.ts (a `heat` facet and one theme), which the show never imports.
 * A fourth, `status` (single, seeing someone, taken, married), is never chosen: it's read from the relationship graph's
 * public layer (lib/relationship-stages.ts), so a character's love life on the show is part of how people find them.
 *
 * `census` is each tag's demand in that study (the average popularity percentile of characters with it, over the
 * average character, 1.00×), on safe-for-work characters and on adult ones; null where the study had no matching
 * category or fewer than 15 characters. It is a prior: pickers order by it until Botchelor's own picks say otherwise
 * (lib/tag-demand.ts).
 *
 * What is never a tag, on either side, and why: school, teachers and students, family and step-family, anyone young,
 * captor and captive, non-consent, incest framing, mind control, sex work, obsession (yandere), bullies, real or famous
 * people. Several of these drew strong demand in the study (family setups 1.27×, non-consent 1.25×, captor 1.21×); they
 * stay out because the show's and After Dark's lines say so, and tests/tags.test.ts holds every label to them.
 *
 * Pure and client-safe: the pickers, the server and MCP share it.
 */
import type { Stage } from "./relationship-stages";

export const TAG_FACETS = [
  { id: "setup", label: "Between them" },
  { id: "theme", label: "Kind of story" },
  { id: "type", label: "Type" },
] as const;
export type TagFacet = (typeof TAG_FACETS)[number]["id"];

/** Demand in the census, safe-for-work and adult (1.00× is the average character); null where it had nothing to say. */
export type CensusDemand = { sfw: number | null; nsfw: number | null };

export type TagDef = {
  id: string;
  label: string;
  icon: string;
  facet: string;
  /** One line on what it means, for the picker's title and the docs. */
  about: string;
  census: CensusDemand;
};

const c = (sfw: number | null, nsfw: number | null): CensusDemand => ({ sfw, nsfw });

/** The shared tags. Labels are plain words a person would pick, never the fandom's jargon ("Hard to get", not "tsundere"). */
export const TAGS = [
  // Between them: the census's strongest axis (the rarer setups do better than the default couple).
  { id: "rivals", label: "Rivals", icon: "⚔️", facet: "setup", about: "Rivals or enemies, and it turns into something else.", census: c(1.12, 1.15) },
  { id: "second_chance", label: "Second chance", icon: "🔁", facet: "setup", about: "Exes, or two people who missed their moment once.", census: c(1.0, 1.21) },
  { id: "friends_to_more", label: "Friends to more", icon: "🤝", facet: "setup", about: "Old friends, and one of them finally says it.", census: c(1.01, 1.21) },
  { id: "fake_dating", label: "Fake dating", icon: "💍", facet: "setup", about: "Pretending to be together, or an arranged match.", census: c(1.2, 1.17) },
  { id: "forced_proximity", label: "Stuck together", icon: "🏚️", facet: "setup", about: "Snowed in, washed up, one room: no way out but each other.", census: c(null, null) },
  { id: "roommates", label: "Roommates", icon: "🏠", facet: "setup", about: "Roommates or neighbours: close every day, and pretending not to notice.", census: c(1.08, 1.14) },
  { id: "workplace", label: "Work", icon: "💼", facet: "setup", about: "Colleagues, a crew or a team: on the show always as equals.", census: c(1.05, 1.17) },
  { id: "bodyguard", label: "Bodyguard", icon: "🛡️", facet: "setup", about: "One of them keeps the other safe for a night.", census: c(1.01, 1.02) },
  { id: "forbidden", label: "Forbidden", icon: "🚫", facet: "setup", about: "Opposite sides: a knight and a dragon, rival houses, hero and villain.", census: c(null, null) },
  { id: "opposites", label: "Opposites", icon: "🌗", facet: "setup", about: "A believer and a sceptic, a grump and a sunshine.", census: c(null, null) },
  { id: "slow_burn", label: "Slow burn", icon: "🕯️", facet: "setup", about: "Every look counts and nobody rushes.", census: c(null, null) },
  { id: "couples", label: "Already together", icon: "💑", facet: "setup", about: "A couple playing something new.", census: c(1.08, 1.15) },
  { id: "dating_show", label: "On a dating show", icon: "📺", facet: "setup", about: "Contestants, off camera: almost nobody else makes this one.", census: c(0.98, 1.22) },
  { id: "strangers", label: "Strangers", icon: "🎭", facet: "setup", about: "They've never met before tonight.", census: c(0.83, 1.01) },

  // Kind of story.
  { id: "drama", label: "Drama", icon: "🎬", facet: "theme", about: "Feelings with stakes, said out loud.", census: c(1.02, 1.1) },
  { id: "slice_of_life", label: "Everyday", icon: "🏙️", facet: "theme", about: "Ordinary life, close up.", census: c(1.03, 1.13) },
  { id: "crime", label: "Heists & spies", icon: "🗝️", facet: "theme", about: "Spies, heists and rival outfits, never anyone hurt.", census: c(1.12, 1.17) },
  { id: "spooky", label: "Spooky", icon: "👻", facet: "theme", about: "Ghosts and creaks in the dark, never gory.", census: c(1.07, 1.14) },
  { id: "fantasy", label: "Fantasy", icon: "🐉", facet: "theme", about: "Wizards, dragons and storybook kingdoms.", census: c(1.04, 1.01) },
  { id: "supernatural", label: "Supernatural", icon: "🌙", facet: "theme", about: "Vampires, witches, ghosts and things that aren't quite human.", census: c(0.97, 1.04) },
  { id: "scifi", label: "Sci-fi", icon: "🚀", facet: "theme", about: "Starships, time travel and first contact.", census: c(1.05, 1.02) },
  { id: "adventure", label: "Adventure", icon: "🧭", facet: "theme", about: "Treasure, lost temples and desert islands.", census: c(1.0, 1.07) },
  { id: "action", label: "Action", icon: "💥", facet: "theme", about: "Heroes, villains and close calls.", census: c(1.02, 1.05) },
  { id: "royalty", label: "Royalty", icon: "👑", facet: "theme", about: "Crowns, courts and heirs.", census: c(1.02, 1.05) },
  { id: "romance", label: "Romance", icon: "💞", facet: "theme", about: "The romance is the story.", census: c(0.99, 1.02) },
  { id: "cozy", label: "Cozy", icon: "☕", facet: "theme", about: "Warm, low stakes and kind.", census: c(0.98, 1.01) },
  { id: "sports", label: "Sports", icon: "🏆", facet: "theme", about: "Athletes, matches and the night before the final.", census: c(0.93, 1.05) },
  { id: "period", label: "Period", icon: "🎩", facet: "theme", about: "Another century's manners.", census: c(0.92, 0.97) },
  { id: "mystery", label: "Mystery", icon: "🕵️", facet: "theme", about: "A case, a clue and a secret.", census: c(0.83, 0.95) },
  { id: "comedy", label: "Funny", icon: "😄", facet: "theme", about: "Played for laughs.", census: c(0.81, 0.98) },

  // Type: what kind of person. The census's widest spread: push and pull beats easy agreement.
  { id: "cold", label: "Cold, then warm", icon: "🧊", facet: "type", about: "Hard to read, and worth the wait.", census: c(1.1, 1.2) },
  { id: "hard_to_get", label: "Hard to get", icon: "🌵", facet: "type", about: "Prickly on the outside, soft on the inside.", census: c(1.11, 1.25) },
  { id: "takes_charge", label: "Takes charge", icon: "🔥", facet: "type", about: "Confident and decisive: they lead.", census: c(1.13, 1.1) },
  { id: "rebel", label: "Rebel", icon: "🏍️", facet: "type", about: "Breaks the rules for the fun of it.", census: c(1.26, 1.03) },
  { id: "moody", label: "Dark & moody", icon: "🖤", facet: "type", about: "Black clothes, strong opinions, a soft spot somewhere.", census: c(1.15, 1.15) },
  { id: "morally_grey", label: "Morally grey", icon: "🦹", facet: "type", about: "The villain of someone else's story.", census: c(1.12, 1.06) },
  { id: "jealous", label: "Jealous streak", icon: "💚", facet: "type", about: "Notices who's looking, and says so.", census: c(1.12, 1.11) },
  { id: "dangerous", label: "Dangerous charm", icon: "🕶️", facet: "type", about: "Runs things nobody talks about.", census: c(1.07, 1.22) },
  { id: "high_flyer", label: "High-flyer", icon: "📈", facet: "type", about: "Rich, busy and used to getting a yes.", census: c(0.99, 1.2) },
  { id: "loyal", label: "Loyal", icon: "🫶", facet: "type", about: "Best-friend energy: always shows up.", census: c(1.03, 1.29) },
  { id: "nerd", label: "Nerd", icon: "🎮", facet: "type", about: "Games, facts and very specific enthusiasms.", census: c(1.05, 1.21) },
  { id: "not_human", label: "Not quite human", icon: "🧛", facet: "type", about: "A vampire, a ghost, a dragon or a visitor from far away.", census: c(1.16, 1.11) },
  { id: "protective", label: "Protective", icon: "🛡️", facet: "type", about: "Steps in front of trouble.", census: c(1.05, 1.07) },
  { id: "flirt", label: "Flirt", icon: "😏", facet: "type", about: "Charming, and knows it.", census: c(1.05, 0.97) },
  { id: "sweet", label: "Sweetheart", icon: "🌸", facet: "type", about: "Kind, a little shy, easy to love.", census: c(0.97, 1.01) },
  { id: "sunshine", label: "Sunshine", icon: "☀️", facet: "type", about: "Cheerful whatever the weather.", census: c(null, null) },
  { id: "grump", label: "Grump", icon: "🌧️", facet: "type", about: "Scowls first, cares later.", census: c(null, null) },
  { id: "mysterious", label: "Mysterious", icon: "🌫️", facet: "type", about: "Says less than they know.", census: c(null, null) },
  { id: "playful", label: "Playful", icon: "🎈", facet: "type", about: "Teasing, games and jokes.", census: c(null, null) },
  { id: "romantic", label: "Hopeless romantic", icon: "💌", facet: "type", about: "Believes in the grand gesture.", census: c(null, null) },
] as const satisfies readonly TagDef[];

export type TagId = (typeof TAGS)[number]["id"];

const BY_ID: ReadonlyMap<string, TagDef> = new Map(TAGS.map((t) => [t.id, t]));
export const tagById = (id: string): TagDef | undefined => BY_ID.get(id);
export const isTagId = (id: unknown): id is TagId => typeof id === "string" && BY_ID.has(id);
export const tagsIn = (facet: TagFacet): readonly TagDef[] => TAGS.filter((t) => t.facet === facet);

/** How many tags a character may carry (owner's and the auto ones together): enough to describe, few enough to mean something. */
export const CHARACTER_TAGS_MAX = 6;

/**
 * A tag's order in a picker: Botchelor's own demand when there is some (lib/tag-demand.ts), else the census's, else
 * average. `side` picks the census column. Higher first.
 */
export function tagScore(t: Pick<TagDef, "census">, side: "sfw" | "nsfw", own?: number | null): number {
  if (typeof own === "number" && Number.isFinite(own)) return own;
  return t.census[side] ?? t.census[side === "sfw" ? "nsfw" : "sfw"] ?? 1;
}

/** Tags in a picker's order: by score, ties in the vocabulary's order. */
export function byDemand<T extends Pick<TagDef, "id" | "census">>(tags: readonly T[], side: "sfw" | "nsfw", own: Readonly<Record<string, number>> = {}): T[] {
  const at = new Map(tags.map((t, i) => [t.id, i]));
  return [...tags].sort((x, y) => tagScore(y, side, own[y.id]) - tagScore(x, side, own[x.id]) || at.get(x.id)! - at.get(y.id)!);
}

/* ----------------------------------------------- the social structure ----------------------------------------------- */

/**
 * The setups that fit where a pair already stands (the relationship graph's shown stage): what the picker suggests
 * under "For these two". A pair who broke up is offered second chances, one with bad blood rivals and forbidden, a
 * couple the ones for couples. Never a rule: every roleplay stays open to every pair.
 */
export const SETUPS_FOR_STAGE: Readonly<Partial<Record<Stage, readonly TagId[]>>> = {
  just_met: ["slow_burn", "strangers"],
  didnt_click: ["opposites", "rivals"],
  sparks: ["slow_burn", "fake_dating"],
  casual: ["slow_burn", "friends_to_more"],
  dating: ["slow_burn", "fake_dating"],
  going_steady: ["couples"],
  official: ["couples"],
  moved_in: ["couples", "roommates"],
  engaged: ["couples"],
  married: ["couples"],
  friends: ["friends_to_more"],
  exes: ["second_chance"],
  broke_up: ["second_chance"],
  back_together: ["second_chance", "couples"],
  divorced: ["second_chance"],
  bad_blood: ["rivals", "forbidden"],
};

/** Where a character stands, read from the relationship graph's PUBLIC layer only: never chosen, never a private date. */
export const STATUSES = [
  { id: "single", label: "Single", icon: "🌱" },
  { id: "seeing", label: "Seeing someone", icon: "✨" },
  { id: "taken", label: "Taken", icon: "💑" },
  { id: "married", label: "Married", icon: "💒" },
] as const;
export type Status = (typeof STATUSES)[number]["id"];
export const isStatus = (s: unknown): s is Status => typeof s === "string" && STATUSES.some((x) => x.id === s);

const STATUS_RANK: Record<Status, number> = { single: 0, seeing: 1, taken: 2, married: 3 };
/** One public stage's status; a stage that ended (exes, bad blood, friends) leaves them single. */
export function statusOfStage(s: Stage | null | undefined): Status {
  switch (s) {
    case "sparks":
    case "dating":
    case "casual":
      return "seeing";
    case "going_steady":
    case "official":
    case "moved_in":
    case "engaged":
    case "back_together":
      return "taken";
    case "married":
      return "married";
    default:
      return "single";
  }
}
/** A character's status over all their public pairs: the most committed one. */
export const statusOf = (stages: readonly (Stage | null | undefined)[]): Status =>
  stages.map(statusOfStage).reduce<Status>((best, s) => (STATUS_RANK[s] > STATUS_RANK[best] ? s : best), "single");
