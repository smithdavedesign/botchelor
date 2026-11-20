/**
 * Every kind of tie (docs/PRDs/social-network.md section 5.1), as code, like lib/character-links.ts LINK_KINDS. A new
 * kind is a line here: the schema stores `kind`, `layer` and `directed` as text, so it needs no migration. Pure and
 * client-safe: it imports nothing but types.
 *
 * Reading a tie: a symmetric kind is the same from either end, and its row starts at the lower id (`tieKey`). A directed
 * kind reads "to is from's <kind>": a `parent` tie from Ada to Bea says Bea is Ada's parent, a `crush` from Ada to Bea
 * says Bea is Ada's crush, a `told` tie from Ada to Bea says Ada told Bea. A tie to an off-screen person always starts at
 * its holder, so "Mum, Ada's parent" is a `parent` tie from Ada to Mum, as the owner would say it.
 */
import type { Stage } from "../relationship-stages";
import type { Declarer, Layer, Ring, TieKey, TieKeyInput, Valence } from "./types";

/** One kind of tie. */
export type TieKindDef = {
  id: TieKindId;
  /** The layer it's on. `dated` is the exception: its stage decides (layerOfDated). */
  layer: Layer;
  /** True when the two ends differ (parent and child, a crush, who told whom). */
  directed: boolean;
  /** For a directed kind: the reverse reading ("child" for parent: from is to's child). */
  inverse?: string;
  /** The valence a new tie gets, -2..2. */
  valence: Valence;
  /** The closeness a new tie starts at, 0..1, before any contact moves it (Phase 4). */
  closeness: number;
  /** Days for closeness to halve without contact (Phase 4); null: it never decays (kin, a nemesis, an old friend). */
  halfLifeDays: number | null;
  /** The most of these a character can hold at once (one spouse, three best friends); absent: no limit. Symmetric kinds only. */
  exclusive?: number;
  /** Who may write it: [] means only what aired makes it (lib/social/derive.ts). */
  declarable: readonly Declarer[];
  /** A conflict: never declared by a person about someone else's character (it only comes from what aired). */
  negative: boolean;
  emoji: string;
  /**
   * In words. `pair`: the two together ("siblings", "rivals"). `to`: what the to end is to the from end ("parent",
   * "their crush"). `from`: what the from end is to the to end ("child", "has a crush on them"). A symmetric kind has
   * the same word both ways. In X's world, the other end is called `to` when X is `from`, and `from` when X is `to`.
   */
  words: { pair: string; from: string; to: string };
  /**
   * The innermost ring of "X's world" a tie of this kind can reach (algorithms.ts rings): a coworker is at most a
   * friend, however close; a best friend can be in the inner circle. `inner` means no ceiling.
   */
  ring: Ring;
};

type KindSpec = Omit<TieKindDef, "id">;

/** Anyone who may declare: an owner (their own characters), an agent, the show's generator, an admin. */
const ANYONE: readonly Declarer[] = ["owner", "agent", "house", "admin"];
/** Only what aired makes these. */
const AIRED: readonly Declarer[] = [];

const same = (word: string) => ({ from: word, to: word });

const DEFS = {
  // ------------------------------------------------------------- kin: never decays
  parent: { layer: "kin", directed: true, inverse: "child", valence: 1, closeness: 0.7, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "👪", words: { pair: "parent and child", from: "child", to: "parent" }, ring: "inner" },
  sibling: { layer: "kin", directed: false, valence: 1, closeness: 0.7, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🫂", words: { pair: "siblings", ...same("sibling") }, ring: "inner" },
  half_sibling: { layer: "kin", directed: false, valence: 1, closeness: 0.6, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🫂", words: { pair: "half-siblings", ...same("half-sibling") }, ring: "close" },
  step_sibling: { layer: "kin", directed: false, valence: 1, closeness: 0.5, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🫂", words: { pair: "step-siblings", ...same("step-sibling") }, ring: "close" },
  cousin: { layer: "kin", directed: false, valence: 1, closeness: 0.4, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🌳", words: { pair: "cousins", ...same("cousin") }, ring: "friends" },
  grandparent: { layer: "kin", directed: true, inverse: "grandchild", valence: 1, closeness: 0.6, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "👵", words: { pair: "grandparent and grandchild", from: "grandchild", to: "grandparent" }, ring: "close" },
  aunt_uncle: { layer: "kin", directed: true, inverse: "niece_nephew", valence: 1, closeness: 0.4, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🧓", words: { pair: "aunt or uncle, and niece or nephew", from: "niece or nephew", to: "aunt or uncle" }, ring: "friends" },
  in_law: { layer: "kin", directed: false, valence: 1, closeness: 0.4, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "💍", words: { pair: "in-laws", ...same("in-law") }, ring: "friends" },
  family: { layer: "kin", directed: false, valence: 1, closeness: 0.5, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🏡", words: { pair: "family", ...same("family") }, ring: "close" },
  // The younger generation, for off-screen people (Phase 2b): a tie to a person starts at its holder, so "Tom is Ada's
  // son" needs a kind that reads that way. Between two characters it's the parent (grandparent) tie from the other end
  // (lib/social/relations.ts canonicalTie), so the character graph has one form of each.
  child: { layer: "kin", directed: true, inverse: "parent", valence: 1, closeness: 0.7, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "👶", words: { pair: "parent and child", from: "parent", to: "child" }, ring: "inner" },
  grandchild: { layer: "kin", directed: true, inverse: "grandparent", valence: 1, closeness: 0.6, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "🧒", words: { pair: "grandparent and grandchild", from: "grandparent", to: "grandchild" }, ring: "close" },

  // ------------------------------------------------------------- romance
  spouse: { layer: "romance", directed: false, valence: 2, closeness: 0.9, halfLifeDays: null, exclusive: 1, declarable: ANYONE, negative: false, emoji: "💒", words: { pair: "married", ...same("spouse") }, ring: "inner" },
  partner: { layer: "romance", directed: false, valence: 2, closeness: 0.8, halfLifeDays: 365, declarable: ANYONE, negative: false, emoji: "💞", words: { pair: "partners", ...same("partner") }, ring: "inner" },
  engaged: { layer: "romance", directed: false, valence: 2, closeness: 0.85, halfLifeDays: 365, exclusive: 1, declarable: ANYONE, negative: false, emoji: "💎", words: { pair: "engaged", ...same("fiancé(e)") }, ring: "inner" },
  ex: { layer: "romance", directed: false, valence: 0, closeness: 0.3, halfLifeDays: 365, declarable: ANYONE, negative: false, emoji: "💔", words: { pair: "exes", ...same("ex") }, ring: "friends" },
  crush: { layer: "romance", directed: true, inverse: "admirer", valence: 1, closeness: 0.5, halfLifeDays: 60, declarable: ANYONE, negative: false, emoji: "😳", words: { pair: "a crush", from: "has a crush on them", to: "their crush" }, ring: "close" },
  first_love: { layer: "romance", directed: false, valence: 1, closeness: 0.4, halfLifeDays: null, exclusive: 1, declarable: ANYONE, negative: false, emoji: "💌", words: { pair: "first loves", ...same("first love") }, ring: "close" },
  situationship: { layer: "romance", directed: false, valence: 1, closeness: 0.5, halfLifeDays: 45, declarable: ANYONE, negative: false, emoji: "🌀", words: { pair: "a situationship", ...same("situationship") }, ring: "close" },
  fake_couple: { layer: "romance", directed: false, valence: 0, closeness: 0.4, halfLifeDays: 180, declarable: ANYONE, negative: false, emoji: "🎭", words: { pair: "a fake couple", ...same("fake partner") }, ring: "friends" },
  // The show's dating track: the projection of `relationships` (lib/social/derive.ts). Its layer and valence come from
  // the pair's public shown stage (layerOfDated, valenceOfDated); its closeness from their public tie strength.
  dated: { layer: "romance", directed: false, valence: 1, closeness: 0.3, halfLifeDays: 90, declarable: AIRED, negative: false, emoji: "🌹", words: { pair: "dated on the show", ...same("date") }, ring: "inner" },

  // ------------------------------------------------------------- friendship: 120 days for a friend
  best_friend: { layer: "friendship", directed: false, valence: 2, closeness: 0.85, halfLifeDays: 240, exclusive: 3, declarable: ANYONE, negative: false, emoji: "🫶", words: { pair: "best friends", ...same("best friend") }, ring: "inner" },
  close_friend: { layer: "friendship", directed: false, valence: 2, closeness: 0.7, halfLifeDays: 180, declarable: ANYONE, negative: false, emoji: "🤗", words: { pair: "close friends", ...same("close friend") }, ring: "close" },
  friend: { layer: "friendship", directed: false, valence: 1, closeness: 0.5, halfLifeDays: 120, declarable: ANYONE, negative: false, emoji: "🤝", words: { pair: "friends", ...same("friend") }, ring: "friends" },
  childhood_friend: { layer: "friendship", directed: false, valence: 1, closeness: 0.5, halfLifeDays: 365, declarable: ANYONE, negative: false, emoji: "🧸", words: { pair: "childhood friends", ...same("childhood friend") }, ring: "close" },
  // Where a friendship that faded ends up (Phase 4's decay): it never fades further.
  old_friend: { layer: "friendship", directed: false, valence: 1, closeness: 0.3, halfLifeDays: null, declarable: ANYONE, negative: false, emoji: "📼", words: { pair: "old friends", ...same("old friend") }, ring: "friends" },
  roommate: { layer: "friendship", directed: false, valence: 1, closeness: 0.6, halfLifeDays: 120, declarable: ANYONE, negative: false, emoji: "🛋️", words: { pair: "roommates", ...same("roommate") }, ring: "close" },
  pen_pal: { layer: "friendship", directed: false, valence: 1, closeness: 0.4, halfLifeDays: 180, declarable: ANYONE, negative: false, emoji: "✉️", words: { pair: "pen pals", ...same("pen pal") }, ring: "friends" },

  // ------------------------------------------------------------- work
  coworker: { layer: "work", directed: false, valence: 1, closeness: 0.4, halfLifeDays: 90, declarable: ANYONE, negative: false, emoji: "💼", words: { pair: "coworkers", ...same("coworker") }, ring: "friends" },
  manager: { layer: "work", directed: true, inverse: "report", valence: 1, closeness: 0.4, halfLifeDays: 90, declarable: ANYONE, negative: false, emoji: "📋", words: { pair: "manager and report", from: "report", to: "manager" }, ring: "friends" },
  business_partner: { layer: "work", directed: false, valence: 1, closeness: 0.6, halfLifeDays: 180, declarable: ANYONE, negative: false, emoji: "📈", words: { pair: "business partners", ...same("business partner") }, ring: "close" },
  mentor: { layer: "work", directed: true, inverse: "mentee", valence: 2, closeness: 0.5, halfLifeDays: 365, declarable: ANYONE, negative: false, emoji: "🧭", words: { pair: "mentor and mentee", from: "mentee", to: "mentor" }, ring: "close" },
  classmate: { layer: "work", directed: false, valence: 1, closeness: 0.35, halfLifeDays: 365, declarable: ANYONE, negative: false, emoji: "🎒", words: { pair: "classmates", ...same("classmate") }, ring: "friends" },
  teammate: { layer: "work", directed: false, valence: 1, closeness: 0.45, halfLifeDays: 120, declarable: ANYONE, negative: false, emoji: "🏅", words: { pair: "teammates", ...same("teammate") }, ring: "friends" },
  bandmate: { layer: "work", directed: false, valence: 1, closeness: 0.55, halfLifeDays: 180, declarable: ANYONE, negative: false, emoji: "🎸", words: { pair: "bandmates", ...same("bandmate") }, ring: "friends" },

  // ------------------------------------------------------------- place (who shares a place is read from memberships)
  neighbour: { layer: "place", directed: false, valence: 1, closeness: 0.3, halfLifeDays: 120, declarable: ANYONE, negative: false, emoji: "🏘️", words: { pair: "neighbours", ...same("neighbour") }, ring: "friends" },

  // ------------------------------------------------------------- conflict: never declared about another owner's character
  rival: { layer: "conflict", directed: false, valence: -1, closeness: 0.5, halfLifeDays: 180, declarable: ANYONE, negative: true, emoji: "⚔️", words: { pair: "rivals", ...same("rival") }, ring: "acquaintances" },
  nemesis: { layer: "conflict", directed: false, valence: -2, closeness: 0.6, halfLifeDays: null, exclusive: 1, declarable: ANYONE, negative: true, emoji: "🦹", words: { pair: "nemeses", ...same("nemesis") }, ring: "acquaintances" },
  enemy: { layer: "conflict", directed: false, valence: -2, closeness: 0.5, halfLifeDays: 365, declarable: ANYONE, negative: true, emoji: "🗡️", words: { pair: "enemies", ...same("enemy") }, ring: "acquaintances" },
  grudge: { layer: "conflict", directed: true, inverse: "resented_by", valence: -1, closeness: 0.4, halfLifeDays: 365, declarable: ANYONE, negative: true, emoji: "😤", words: { pair: "a grudge", from: "holds a grudge against them", to: "someone they hold a grudge against" }, ring: "acquaintances" },
  frenemy: { layer: "conflict", directed: false, valence: -1, closeness: 0.5, halfLifeDays: 120, declarable: ANYONE, negative: true, emoji: "😏", words: { pair: "frenemies", ...same("frenemy") }, ring: "acquaintances" },
  // A confrontation in the house (lib/house-conflict.ts): -1 by default, 0 once they cleared the air, -2 when worse.
  feud: { layer: "conflict", directed: false, valence: -1, closeness: 0.4, halfLifeDays: 90, declarable: AIRED, negative: true, emoji: "🗯️", words: { pair: "feuding", ...same("feuding with them") }, ring: "acquaintances" },
  bad_blood: { layer: "conflict", directed: false, valence: -2, closeness: 0.4, halfLifeDays: 180, declarable: AIRED, negative: true, emoji: "🔥", words: { pair: "bad blood", ...same("bad blood") }, ring: "acquaintances" },

  // ------------------------------------------------------------- acquaintance
  acquaintance: { layer: "acquaintance", directed: false, valence: 0, closeness: 0.2, halfLifeDays: 60, declarable: ANYONE, negative: false, emoji: "👋", words: { pair: "acquaintances", ...same("acquaintance") }, ring: "acquaintances" },
  met_at_group_night: { layer: "acquaintance", directed: false, valence: 0, closeness: 0.25, halfLifeDays: 45, declarable: AIRED, negative: false, emoji: "🥂", words: { pair: "met at a group night", ...same("met at a group night") }, ring: "acquaintances" },
  housemate: { layer: "acquaintance", directed: false, valence: 0, closeness: 0.35, halfLifeDays: 120, declarable: AIRED, negative: false, emoji: "🏠", words: { pair: "housemates", ...same("housemate") }, ring: "acquaintances" },
  met_on_show: { layer: "acquaintance", directed: false, valence: 0, closeness: 0.2, halfLifeDays: 60, declarable: AIRED, negative: false, emoji: "📺", words: { pair: "met on the show", ...same("met on the show") }, ring: "acquaintances" },

  // ------------------------------------------------------------- communication (aired house-scene lines only)
  talked_about: { layer: "communication", directed: true, inverse: "talked_about_by", valence: 0, closeness: 0.1, halfLifeDays: 30, declarable: AIRED, negative: false, emoji: "🗣️", words: { pair: "talked about", from: "talked about them", to: "someone they talked about" }, ring: "acquaintances" },
  told: { layer: "communication", directed: true, inverse: "told_by", valence: 0, closeness: 0.2, halfLifeDays: 30, declarable: AIRED, negative: false, emoji: "🤫", words: { pair: "told", from: "told them something", to: "someone they told" }, ring: "acquaintances" },
} as const satisfies Record<string, KindSpec>;

/** A kind's id: `parent`, `best_friend`, `rival`, `dated`... */
export type TieKindId = keyof typeof DEFS;

/** The registry, by id. */
export const TIE_KINDS = Object.fromEntries(Object.entries(DEFS).map(([id, d]) => [id, { id, ...d }])) as unknown as Record<TieKindId, TieKindDef>;
/** Every kind's id, in the registry's order (by layer). */
export const TIE_KIND_IDS = Object.keys(DEFS) as TieKindId[];

export const isTieKind = (x: unknown): x is TieKindId => typeof x === "string" && Object.prototype.hasOwnProperty.call(DEFS, x);
export const kindDef = (kind: TieKindId): TieKindDef => TIE_KINDS[kind];
/** The kinds on one layer (`dated` is listed on romance, its default). */
export const kindsOnLayer = (layer: Layer): TieKindId[] => TIE_KIND_IDS.filter((k) => TIE_KINDS[k].layer === layer);
/** Whether `who` may declare this kind. Who may declare it ABOUT WHOM (own characters, someone else's) is the declare path's rule. */
export const canDeclare = (kind: TieKindId, who: Declarer): boolean => TIE_KINDS[kind].declarable.includes(who);
/** Kinds that only what aired makes. */
export const isDerivedOnly = (kind: TieKindId): boolean => TIE_KINDS[kind].declarable.length === 0;

/* ------------------------------------------------- the dated projection ------------------------------------------------- */

/**
 * The layer a `dated` tie sits on, from the pair's public shown stage (PRD section 5.1): together, sparks and back
 * together are romance; friends is friendship; exes, broke up and divorced stay romance (valence 0); bad blood is
 * conflict; just met and didn't click are acquaintances. Every stage is listed, so a new one fails to compile here.
 */
const DATED: Record<Stage, { layer: Layer; valence: Valence }> = {
  just_met: { layer: "acquaintance", valence: 1 },
  didnt_click: { layer: "acquaintance", valence: 0 },
  sparks: { layer: "romance", valence: 1 },
  dating: { layer: "romance", valence: 1 },
  casual: { layer: "romance", valence: 1 },
  back_together: { layer: "romance", valence: 1 },
  going_steady: { layer: "romance", valence: 2 },
  official: { layer: "romance", valence: 2 },
  moved_in: { layer: "romance", valence: 2 },
  engaged: { layer: "romance", valence: 2 },
  married: { layer: "romance", valence: 2 },
  friends: { layer: "friendship", valence: 1 },
  exes: { layer: "romance", valence: 0 },
  broke_up: { layer: "romance", valence: 0 },
  divorced: { layer: "romance", valence: 0 },
  bad_blood: { layer: "conflict", valence: -2 },
};

/** The layer of a `dated` tie at this shown stage (null: no public stage yet, so acquaintances). */
export const layerOfDated = (stage: Stage | null | undefined): Layer => (stage ? DATED[stage].layer : "acquaintance");
/** The valence of a `dated` tie at this shown stage: 2 once steady, 0 once apart, -2 for bad blood. */
export const valenceOfDated = (stage: Stage | null | undefined): Valence => (stage ? DATED[stage].valence : 0);

/* ------------------------------------------------------- keys ------------------------------------------------------- */

/**
 * A tie's stored key: a symmetric tie between two characters starts at the lower id, so either order finds the one row;
 * a directed tie, and a tie to an off-screen person, keep their order.
 */
export function tieKey(input: TieKeyInput): TieKey {
  if (input.toPerson !== undefined) return { from_id: input.from, to_id: null, to_person_id: input.toPerson, kind: input.kind };
  const to = input.to as string;
  if (!TIE_KINDS[input.kind]?.directed && to < input.from) return { from_id: to, to_id: input.from, to_person_id: null, kind: input.kind };
  return { from_id: input.from, to_id: to, to_person_id: null, kind: input.kind };
}

/** The other end of a tie, seen from `me` (one of its characters): its id, whether it's a person, and what it is to me. */
export function otherEnd(
  tie: { from_id: string; to_id: string | null; to_person_id: string | null; kind: TieKindId },
  me: string,
): { id: string; person: boolean; word: string } | null {
  const def = TIE_KINDS[tie.kind];
  if (!def) return null;
  if (tie.from_id === me) return tie.to_person_id ? { id: tie.to_person_id, person: true, word: def.words.to } : tie.to_id ? { id: tie.to_id, person: false, word: def.words.to } : null;
  if (tie.to_id === me) return { id: tie.from_id, person: false, word: def.words.from };
  return null;
}
