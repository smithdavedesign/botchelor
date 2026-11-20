/**
 * What may be declared about a character's circle (docs/PRDs/social-network.md section 6.2), read the same way by every
 * path that declares: the owner's forms on the character page, the MCP tools, the season generator and the backfill of
 * the show's own characters. The relations an off-screen person or a tie can have, how each reads from a character's
 * side, the roles a character can take at a place, and free words ("mum", "older sister", "boss") as kinds.
 *
 * Who may declare what about whom (an owner's own characters, someone else's, the house's) is lib/social/declare.ts;
 * this module is the vocabulary. Pure and client-safe: it imports the kinds registry and types only.
 */
import { canDeclare, isDerivedOnly, isTieKind, TIE_KINDS, TIE_KIND_IDS, type TieKindId } from "./kinds";
import type { Declarer, Layer, PlaceKind, PlaceRole } from "./types";

/* ------------------------------------------------------ places ------------------------------------------------------ */

/** The roles a character can be declared to have at a place. `from` comes from the sheet's hometown, `visited` from what aired. */
export const DECLARED_ROLES = ["lives", "works", "regular", "studied"] as const satisfies readonly PlaceRole[];
export type DeclaredRole = (typeof DECLARED_ROLES)[number];
export const isDeclaredRole = (x: unknown): x is DeclaredRole => typeof x === "string" && (DECLARED_ROLES as readonly string[]).includes(x);

/**
 * The kinds of place each role can be at: one lives in a neighbourhood, works at a workplace (or behind the bar of a
 * hangout, or at a school), is a regular at a hangout, and studied at a school.
 */
export const ROLE_PLACES: Record<DeclaredRole, readonly PlaceKind[]> = {
  lives: ["neighbourhood"],
  works: ["workplace", "school", "venue", "hangout", "club"],
  regular: ["hangout", "venue", "club"],
  studied: ["school"],
};

/** The kinds of place someone may name new (the neighbourhoods and hangouts are the show's world, given). */
export const NEW_PLACE_KINDS = ["workplace", "school"] as const satisfies readonly PlaceKind[];
export type NewPlaceKind = (typeof NEW_PLACE_KINDS)[number];
/** The kind a new place takes for a role, when it's named rather than picked. */
export const NEW_PLACE_FOR: Partial<Record<DeclaredRole, NewPlaceKind>> = { works: "workplace", studied: "school" };

/** How a membership reads on a page: "Works at The Lighthouse". */
export const ROLE_WORDS: Record<PlaceRole, string> = {
  lives: "Lives in",
  works: "Works at",
  regular: "A regular at",
  studied: "Studied at",
  from: "From",
  visited: "Has been to",
};

/* ------------------------------------------------------ kinds ------------------------------------------------------ */

/**
 * Between two characters, these kinds are another one from the other end ("Tom is Ada's child" is "Ada is Tom's
 * parent"), so the character graph keeps one form of each. A tie to an off-screen person keeps them: it starts at its
 * holder, so it's the only way to say the person is the younger one.
 */
export const FLIPS: Partial<Record<TieKindId, TieKindId>> = { child: "parent", grandchild: "grandparent" };

/** A tie between two characters in its one stored form (pure): a `child` tie from A to B is a `parent` tie from B to A. */
export function canonicalTie<T extends { from: string; to: string; kind: TieKindId }>(t: T): T {
  const flip = FLIPS[t.kind];
  return flip ? { ...t, from: t.to, to: t.from, kind: flip } : t;
}

/** Kinds anyone may write by declaring (not the ones only what aired makes). */
const declarable = (by: Declarer): TieKindId[] => TIE_KIND_IDS.filter((k) => !isDerivedOnly(k) && canDeclare(k, by));

/**
 * The kinds a declarer may give an off-screen person: every declarable one, a conflict too (they're the holder's own
 * fiction: the boss who has it in for them). The relation reads "the person is the holder's <words.to>".
 */
export const personKinds = (by: Declarer): TieKindId[] => declarable(by);

/**
 * The kinds a declarer may give a tie between two characters: every declarable one between characters they own (the
 * house's own two, or an owner's), and only the warm ones (never a conflict) to someone else's (PRD section 6.2). The
 * younger-generation kinds are their elders' from the other end (FLIPS), so they aren't listed.
 */
export const tieKinds = (by: Declarer, o: { own: boolean }): TieKindId[] => declarable(by).filter((k) => !FLIPS[k] && (o.own || !TIE_KINDS[k].negative));

/** Whether a kind may be declared by `by` between two characters, `own` or not (FLIPS kinds count: they're stored flipped). */
export function mayDeclareTie(kind: TieKindId, by: Declarer, o: { own: boolean }): boolean {
  const k = FLIPS[kind] ?? kind;
  return !isDerivedOnly(k) && canDeclare(k, by) && (o.own || !TIE_KINDS[k].negative);
}

/** Whether a kind may be given to an off-screen person by `by`. */
export const mayDeclarePerson = (kind: TieKindId, by: Declarer): boolean => !isDerivedOnly(kind) && canDeclare(kind, by);

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One reading of a tie from a character's side, "<other> is <me>'s <label>". A symmetric kind reads one way. A directed
 * kind reads two: `reversed` false is the tie from me to them (they're my parent, my crush), true the tie from them to
 * me (my child, someone with a crush on me).
 */
export type TieChoice = { id: string; kind: TieKindId; reversed: boolean; label: string; layer: Layer; negative: boolean; emoji: string };

/** A choice's id: the kind, and `:reverse` for a directed kind read from its other end. */
export const choiceId = (kind: TieKindId, reversed: boolean): string => (reversed ? `${kind}:reverse` : kind);

/** A choice id back as a kind and a direction; null when it isn't one. */
export function parseChoice(id: string): { kind: TieKindId; reversed: boolean } | null {
  const [kind, flag, ...rest] = id.split(":");
  if (rest.length || !isTieKind(kind) || (flag !== undefined && flag !== "reverse")) return null;
  if (flag && !TIE_KINDS[kind].directed) return null;
  return { kind, reversed: flag === "reverse" };
}

/** Every way a declarer may tie two characters, as the form lists them (by layer, the registry's order). */
export function tieChoices(by: Declarer, o: { own: boolean }): TieChoice[] {
  return tieKinds(by, o).flatMap((kind) => {
    const d = TIE_KINDS[kind];
    const one = (reversed: boolean): TieChoice => ({
      id: choiceId(kind, reversed),
      kind,
      reversed,
      label: capital(reversed ? d.words.from : d.words.to),
      layer: d.layer,
      negative: d.negative,
      emoji: d.emoji,
    });
    return d.directed ? [one(false), one(true)] : [one(false)];
  });
}

/** Every relation a declarer may give an off-screen person, as the form lists them. */
export function personChoices(by: Declarer): TieChoice[] {
  return personKinds(by).map((kind) => {
    const d = TIE_KINDS[kind];
    return { id: kind, kind, reversed: false, label: capital(d.words.to), layer: d.layer, negative: d.negative, emoji: d.emoji };
  });
}

/* ------------------------------------------------------ words ------------------------------------------------------ */

/**
 * Words people (and models) use for a relation, as kinds. Checked after a kind's own id and after the qualifiers are
 * dropped ("her older sister" is "sister"). Words that name a kind only what aired makes ("housemate") map to the
 * nearest declarable one.
 */
const WORDS: Record<string, TieKindId> = {
  mother: "parent", mum: "parent", mom: "parent", mam: "parent", mama: "parent", mommy: "parent", mummy: "parent", ma: "parent",
  father: "parent", dad: "parent", daddy: "parent", papa: "parent", pa: "parent", parent: "parent", parents: "parent",
  stepmother: "parent", stepmum: "parent", stepmom: "parent", stepfather: "parent", stepdad: "parent", "step-mum": "parent", "step-dad": "parent",
  son: "child", daughter: "child", kid: "child", child: "child", stepson: "child", stepdaughter: "child", "step-son": "child", "step-daughter": "child",
  sister: "sibling", brother: "sibling", sibling: "sibling", twin: "sibling", sis: "sibling", bro: "sibling",
  "half-sister": "half_sibling", "half-brother": "half_sibling", "half sister": "half_sibling", "half brother": "half_sibling", "half-sibling": "half_sibling",
  stepsister: "step_sibling", stepbrother: "step_sibling", "step-sister": "step_sibling", "step-brother": "step_sibling", "step sister": "step_sibling", "step brother": "step_sibling",
  cousin: "cousin",
  grandmother: "grandparent", grandfather: "grandparent", grandma: "grandparent", grandpa: "grandparent", gran: "grandparent", granny: "grandparent",
  grandad: "grandparent", granddad: "grandparent", nan: "grandparent", nana: "grandparent", nanna: "grandparent", grandparent: "grandparent",
  grandson: "grandchild", granddaughter: "grandchild", grandkid: "grandchild", grandchild: "grandchild",
  aunt: "aunt_uncle", auntie: "aunt_uncle", aunty: "aunt_uncle", uncle: "aunt_uncle",
  niece: "family", nephew: "family", godmother: "family", godfather: "family", godparent: "family", goddaughter: "family", godson: "family", relative: "family",
  "mother-in-law": "in_law", "father-in-law": "in_law", "sister-in-law": "in_law", "brother-in-law": "in_law", "in-law": "in_law",
  husband: "spouse", wife: "spouse", spouse: "spouse",
  girlfriend: "partner", boyfriend: "partner", partner: "partner",
  fiance: "engaged", fiancee: "engaged", "fiancé": "engaged", "fiancée": "engaged",
  ex: "ex", "ex-wife": "ex", "ex-husband": "ex", "ex-girlfriend": "ex", "ex-boyfriend": "ex", "ex-partner": "ex", "former partner": "ex",
  "first love": "first_love", crush: "crush", situationship: "situationship", "fake partner": "fake_couple",
  "best friend": "best_friend", bestie: "best_friend", bff: "best_friend", "best mate": "best_friend",
  "close friend": "close_friend", friend: "friend", pal: "friend", buddy: "friend", mate: "friend",
  "childhood friend": "childhood_friend", "old friend": "old_friend", "school friend": "childhood_friend",
  roommate: "roommate", flatmate: "roommate", housemate: "roommate", "pen pal": "pen_pal", penpal: "pen_pal",
  coworker: "coworker", "co-worker": "coworker", colleague: "coworker", workmate: "coworker",
  boss: "manager", manager: "manager", supervisor: "manager", "line manager": "manager",
  "business partner": "business_partner", mentor: "mentor", coach: "mentor",
  classmate: "classmate", schoolmate: "classmate", "uni friend": "classmate", teammate: "teammate", bandmate: "bandmate",
  neighbour: "neighbour", neighbor: "neighbour",
  rival: "rival", nemesis: "nemesis", "arch-nemesis": "nemesis", archnemesis: "nemesis", enemy: "enemy", frenemy: "frenemy", grudge: "grudge",
  acquaintance: "acquaintance",
};

/** Words that qualify a relation without changing its kind ("her older sister", "my late gran"). */
const QUALIFIERS = /^(?:his|her|their|my|your|the|an?|older|oldest|elder|eldest|younger|youngest|big|little|baby|late|former|estranged|twin|only|beloved|dear|favourite|favorite)\s+/i;

/** A relation's words, lower-case, without punctuation or the qualifiers ("Her older sister!" is "sister"). */
function relationWords(text: string | null | undefined): string {
  let w = (text ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 4 && QUALIFIERS.test(w); i++) w = w.replace(QUALIFIERS, "");
  return w;
}

/**
 * A relation in words as a kind ("mum", "older sister", "ex-wife", "boss"), or the kind's own id ("best_friend",
 * "best friend"). Null when it isn't one the registry knows. Only the kind: whether it may be declared is the caller's.
 */
export function kindFromWords(text: string | null | undefined): TieKindId | null {
  const w = relationWords(text);
  if (!w) return null;
  // The words first: "housemate" is a roommate when someone declares it (the kind of that name is the show's, aired).
  if (WORDS[w]) return WORDS[w];
  const id = w.replace(/[\s-]+/g, "_");
  if (isTieKind(id)) return id;
  // The last word or two carry the relation ("her sister from Leeds" isn't parsed, but "work best friend" is).
  const words = w.split(" ");
  for (const n of [2, 1]) {
    if (words.length > n) {
      const tail = words.slice(-n).join(" ");
      if (WORDS[tail]) return WORDS[tail];
      const tailId = tail.replace(/[\s-]+/g, "_");
      if (isTieKind(tailId)) return tailId;
    }
  }
  return null;
}

/**
 * Words for the other end of a directed kind, between two characters: "Sam is my mentee" is a mentor tie read from its
 * other end (I'm Sam's mentor). An off-screen person can't be one of these (a tie to a person starts at its holder), so
 * only ties read them: a niece off-screen is family.
 */
const OTHER_END: Record<string, TieKindId> = {
  mentee: "mentor", protege: "mentor", "protégé": "mentor", apprentice: "mentor", student: "mentor", pupil: "mentor", trainee: "mentor",
  employee: "manager", assistant: "manager", intern: "manager", report: "manager", "direct report": "manager",
  niece: "aunt_uncle", nephew: "aunt_uncle",
};

/**
 * A relation in words between two characters, "<other> is my <words>", as a kind and which end it's read from (`reversed`
 * as TieChoice has it). Null when it isn't one the registry knows.
 */
export function tieFromWords(text: string | null | undefined): { kind: TieKindId; reversed: boolean } | null {
  const w = relationWords(text);
  if (!w) return null;
  if (OTHER_END[w]) return { kind: OTHER_END[w], reversed: true };
  const kind = kindFromWords(w);
  return kind ? { kind, reversed: false } : null;
}
