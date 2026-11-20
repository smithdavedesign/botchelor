/** Types for scripts/social/backfill-circles.mjs, which stays plain JS so it runs with no build step. */
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
};
export type TieIndex = { tied: Map<string, Set<string>>; add(a: string, b: string): void; count(id: string): number; has(a: string, b: string): boolean };

export const PROMPT_VERSION: string;
export const CANDIDATES: number;
export function parseArgs(argv: string[]): { limit: number; dryRun: boolean; force: boolean; only: string[] | null; base: string };
export function queue(characters: ShowCharacter[], o: { force?: boolean; only?: string[] | null; limit: number }): ShowCharacter[];
export function tieIndex(characters: ShowCharacter[]): TieIndex;
export function pickCandidates(me: ShowCharacter, everyone: ShowCharacter[], ties: TieIndex, o?: { n?: number; random?: () => number }): ShowCharacter[];
export function familyHints(me: ShowCharacter, byId: Map<string, ShowCharacter>): string[];
export function circleMessages(
  me: ShowCharacter,
  o: { world: World; candidates: ShowCharacter[]; byId: Map<string, ShowCharacter>; workplaces: Workplace[] },
): ChatMessage[];
export function parseReply(raw: string | null | undefined): Record<string, unknown> | null;
export function toCircle(me: ShowCharacter, reply: Record<string, unknown>, o: { candidates: ShowCharacter[]; workplaces: Workplace[] }): Circle;
export function remember(
  me: ShowCharacter,
  circle: Circle,
  result: CircleResult | null,
  o: { byId: Map<string, ShowCharacter>; ties: TieIndex; workplaces: Workplace[]; world: World },
): void;
export function offerWorkplaces(workplaces: Workplace[], o?: { n?: number; random?: () => number }): Workplace[];
