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
