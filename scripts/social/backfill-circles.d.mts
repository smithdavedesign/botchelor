/** Types for scripts/social/backfill-circles.mjs, which stays plain JS so it runs with no build step. */
import type { OcNameStyle } from "../../lib/oc-name-pools";
import type { NameBook } from "../../lib/social/person-names";
import type { ChatMessage } from "../loop/crowd.d.mts";

export type Kind = "cast" | "house" | "agent";
/** A character's circle so far, from its side: "<name> is their <relation>" (`phrase` says it whole when it reads one way). */
export type Summary = { people: { name: string; relation: string }[]; ties: { with: string; kind?: string; relation: string; phrase?: string }[] };
/** A show character as GET /api/admin/social/circles lists it (lib/social/circles.ts ShowCharacter, with its circle). */
export type ShowCharacter = {
  id: string;
  name: string;
  kind: Kind;
  age: number | null;
  pronouns: string | null;
  bio: string;
  archetype: string | null;
  occupation: string | null;
  hometown: string | null;
  voice: string | null;
  traits: string[];
  has_circle: boolean;
  dated: string[];
  circle?: Summary;
};
export type Workplace = { key: string; name: string; kind: string; neighbourhood: string | null };
export type World = {
  city: { key: string; name: string };
  neighbourhoods: { key: string; name: string; description: string }[];
  hangouts: { key: string; name: string; neighbourhood: string }[];
  workplaces: Workplace[];
};
export type Circle = {
  character_id: string;
  people: { name: string; relation: string; pronouns: string | null; note: string | null; deceased: boolean }[];
  places: { role: string; place?: string; name?: string; neighbourhood?: string | null }[];
  ties: { with: string; relation: string; story: string | null }[];
};
export type CircleResult = {
  character_id: string;
  status: "written" | "checked" | "skipped" | "refused";
  reason?: string;
  people: number;
  places: number;
  ties: number;
  refused: { item: string; what: string; reason: string }[];
  renamed?: Rename[];
};
/** A person written under another name than the model gave, or (`item` "place") a workplace given as a job and written as the place it's done, and why. */
export type Rename = { from: string; to: string; why: string; item?: "place" };
/** A reply's workplace that was a job (lib/social/place-names.ts): the place read from it, or null for none, and why. */
export type WorkplaceNote = { from: string; to: string | null; why: string };
/** The run's record of names: the rules' NameBook, plus adding and freeing a name. */
export type RunNameBook = NameBook & { lastCount(last: string): number; add(name: string): void; remove(name: string): void };
export type NameStats = {
  holders: number;
  people: number;
  distinctFirst: number;
  top: [string, number][];
  /** The five surnames most used. */
  topLast: [string, number][];
  overCap: number;
  fullTwice: number;
  outsideTaken: number;
  kin: number;
  kinOwn: number;
  kinOther: number;
  /** Close family (lib/social/person-names.ts sharesSurnameWords) with a surname, and how many have the character's. */
  close: number;
  closeOwn: number;
  bestFriends: number;
};
export type TieIndex = { tied: Map<string, Set<string>>; add(a: string, b: string): void; count(id: string): number; has(a: string, b: string): boolean };

export const PROMPT_VERSION: string;
export const CANDIDATES: number;
export function parseArgs(argv: string[]): { limit: number; dryRun: boolean; force: boolean; redoBroken: boolean; stats: boolean; fixWorkplaces: boolean; only: string[] | null; base: string };
export function queue(characters: ShowCharacter[], o: { force?: boolean; only?: string[] | null; limit: number; redo?: Set<string> | null }): ShowCharacter[];
export function tieIndex(characters: ShowCharacter[]): TieIndex;
export function pickCandidates(me: ShowCharacter, everyone: ShowCharacter[], ties: TieIndex, o?: { n?: number; random?: () => number }): ShowCharacter[];
export function familyHints(me: ShowCharacter, byId: Map<string, ShowCharacter>): string[];
/** A copy in a random order: each character sees the neighbourhoods and hangouts in its own (the model leans to the last). */
export function shuffled<T>(list: readonly T[], random?: () => number): T[];
/** The prompt's lines on names: the names offered, family's surname, a best friend only if they have one. */
export function nameLines(me: ShowCharacter, names: { first: string[]; last: string[] } | null): string[];
export function circleMessages(
  me: ShowCharacter,
  o: {
    world: World;
    candidates: ShowCharacter[];
    byId: Map<string, ShowCharacter>;
    workplaces: Workplace[];
    neighbourhoods?: World["neighbourhoods"];
    random?: () => number;
    names?: { first: string[]; last: string[] } | null;
  },
): ChatMessage[];
export function parseReply(raw: string | null | undefined): Record<string, unknown> | null;
/** `everyone`: the show's characters, so one of them named as an off-screen person is a tie (a candidate) or left out. */
/** A title alone ("Mum", "Auntie"), not a name: the backfill leaves that person out. */
export function isTitleOnly(name: string | null | undefined): boolean;
/** A possessive ("Ignatius's Cinder"), not a name: the backfill leaves that person out. */
export function isPossessive(name: string | null | undefined): boolean;
/** `notes`: gets the reply's workplace when it was a job, with the place read from it (or none). */
export function toCircle(
  me: ShowCharacter,
  reply: Record<string, unknown>,
  o: { candidates: ShowCharacter[]; workplaces: Workplace[]; everyone?: ShowCharacter[]; notes?: WorkplaceNote[] | null },
): Circle;
export function remember(
  me: ShowCharacter,
  circle: Circle,
  result: CircleResult | null,
  o: { byId: Map<string, ShowCharacter>; ties: TieIndex; workplaces: Workplace[]; world: World; homes?: Map<string, number> | null; replace?: boolean },
): void;
export function offerWorkplaces(workplaces: Workplace[], o?: { n?: number; random?: () => number }): Workplace[];
export const HOMES_OFFERED: number;
/** The `n` neighbourhoods with the fewest homes this run (`homes`, by key), ties at random: the model leans to one. */
export function offerNeighbourhoods(neighbourhoods: World["neighbourhoods"], homes: Map<string, number>, o?: { n?: number; random?: () => number }): World["neighbourhoods"];
/** How many of the show's people may have a surname before the prompt stops offering it. */
export const SURNAME_OFFERED_MAX: number;
/** The style of names that suits a character, from its own words. */
export function styleOf(c: ShowCharacter): OcNameStyle;
export function nameBook(everyone: ShowCharacter[], o?: { skip?: Set<string> }): RunNameBook;
export function nameCircle(me: ShowCharacter, circle: Circle, book: RunNameBook): { circle: Circle; renamed: Rename[]; dropped: { name: string; reason: string }[] };
/** The characters whose circles break the naming rules, by id, with what's wrong. */
export function brokenHolders(everyone: ShowCharacter[]): Map<string, string[]>;
export function nameStats(everyone: ShowCharacter[]): NameStats;
export function statsLine(s: NameStats): string;
