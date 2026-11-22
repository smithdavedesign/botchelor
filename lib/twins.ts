import { createHash } from "node:crypto";
import { loadCharacter } from "./character";
import type { Db } from "./db";
import { findLookalikes } from "./originality";

/**
 * How long a character's twins are kept in this server's memory (2026-11-22 audit: the comparison reads every public
 * character's sheet, about 1.2 MB, and held a database connection for seconds; the swipe page compared on every view,
 * and the agents' swipe_deck and swipe on every call). A new character on the show shows up as a twin within this long;
 * an edited sheet is compared again at once, since what's kept is for the sheet it was made from.
 */
export const TWINS_TTL_MS = 10 * 60_000;
/** The most characters kept at once; the one kept longest goes first. */
const TWINS_KEPT_MAX = 500;
type KeptTwins = { at: number; sheet: string; twins: Promise<Map<string, string>> };
const keptTwins = new WeakMap<object, Map<string, KeptTwins>>();
let twinsCacheForced: boolean | null = null;
const twinsCacheOn = () => twinsCacheForced ?? (process.env.NODE_ENV === "production" && !process.env.VITEST);

/** Tests: switch the kept twins on or off regardless of the environment (null: back to the default). */
export function setTwinsCacheForTests(enabled: boolean | null): void {
  twinsCacheForced = enabled;
}

/**
 * Which characters on the show read a lot like this one of yours (#426), by id, with why. No model call. The agent deck
 * has said so since #426; the web deck says it too from 2026-11-13 (a card read word for word like the swiper's own,
 * made from the same sample, and nothing on the card said so). Kept for TWINS_TTL_MS per character and sheet, one
 * comparison at a time for everyone asking; a failed one isn't kept (it reads as no twins, as before), and each caller
 * gets its own copy. Off outside production (tests and scripts compare every time), unless a test turns it on.
 */
export async function twinsOfCharacter(db: Db, characterId: string, now = Date.now()): Promise<Map<string, string>> {
  const c = await loadCharacter(db, characterId);
  if (!c) return new Map();
  const sheet = { name: c.name, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, voice: c.voice, extras: c.extras };
  const compare = async () => new Map((await findLookalikes(db, sheet, characterId, 10)).filter((x) => x.kind === "concept").map((x) => [x.id, x.why]));
  const none = () => new Map<string, string>();
  if (!twinsCacheOn()) return compare().catch(none);
  let kept = keptTwins.get(db);
  if (!kept) keptTwins.set(db, (kept = new Map()));
  const key = createHash("sha256").update(JSON.stringify(sheet)).digest("base64url");
  const hit = kept.get(characterId);
  if (hit && hit.sheet === key && now - hit.at < TWINS_TTL_MS) return new Map(await hit.twins.catch(none));
  const twins = compare();
  kept.delete(characterId); // kept again at the end, so the one kept longest is first to go
  kept.set(characterId, { at: now, sheet: key, twins });
  if (kept.size > TWINS_KEPT_MAX) kept.delete(kept.keys().next().value!);
  const mine = kept;
  twins.catch(() => {
    if (mine.get(characterId)?.twins === twins) mine.delete(characterId);
  });
  return new Map(await twins.catch(none));
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
