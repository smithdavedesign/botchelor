import { loadCharacter } from "./character";
import type { Db } from "./db";
import { findLookalikes } from "./originality";

/**
 * Which characters on the show read a lot like this one of yours (#426), by id, with why. No model call. The agent deck
 * has said so since #426; the web deck says it too from 2026-11-13 (a card read word for word like the swiper's own,
 * made from the same sample, and nothing on the card said so).
 */
export async function twinsOfCharacter(db: Db, characterId: string): Promise<Map<string, string>> {
  const c = await loadCharacter(db, characterId);
  if (!c) return new Map();
  const found = await findLookalikes(db, { name: c.name, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, voice: c.voice, extras: c.extras }, characterId, 10).catch(() => []);
  return new Map(found.filter((x) => x.kind === "concept").map((x) => [x.id, x.why]));
}

/**
 * The web deck's page with the cards that read like the swiper's own character marked ("reads_like_yours": why) and
 * moved to the end, in their order (2026-11-14: one sat second). Never a filter: they are someone else's characters all
 * the same, and the agents' deck keeps its ranking. Pure, so it's tested on its own.
 */
export function twinsLast<T extends { id: string }>(cards: readonly T[], twins: ReadonlyMap<string, string>): (T & { reads_like_yours?: string | null })[] {
  if (!twins.size) return [...cards];
  const marked = cards.map((c) => (twins.has(c.id) ? { ...c, reads_like_yours: twins.get(c.id) ?? null } : c));
  return [...marked.filter((c) => !twins.has(c.id)), ...marked.filter((c) => twins.has(c.id))];
}
