/**
 * Recall by meaning, the shared pieces (docs/PRDs/cross-mode-memory.md): the switch and the relative meaning bonus that
 * companion facts (lib/companion-memory.ts) and a character's shared memory (lib/character-memories.ts) both rank with.
 * Pure apart from the key lookup, and imports nothing heavy, so either can use it without pulling in the other.
 */
import { embedKey } from "./originality-concept";

type Env = Record<string, string | undefined>;

/** MEMORY_EMBED=0 turns recall by meaning off; otherwise it's on whenever an embedding key is set. */
export const memoryEmbedOn = (env: Env = process.env): boolean => env.MEMORY_EMBED?.trim() !== "0" && Boolean(embedKey(env).key);
/** How long a reply waits for its question's embedding before ranking by words alone. */
export const RECALL_TIMEOUT_MS = 1200;
/** The most a fact's meaning adds to its score: the same as a message sharing every one of its words. */
const MEANING_WEIGHT = 6;
/** Below this spread between the best match and the typical fact, nothing stands out by meaning and nothing is added. */
const MEANING_MIN_SPREAD = 0.04;
/**
 * Each fact's bonus by meaning, 0 to MEANING_WEIGHT: how far its similarity to the question sits above the thread's
 * median, as a share of how far the best one does. Relative on purpose, so it doesn't depend on the model's scale; and
 * nothing when no fact stands out (a "hi" is about nothing in particular). A fact without a usable vector gets 0.
 */
export function meaningBonus(sims: readonly (number | null)[]): number[] {
  const known = sims.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (known.length < 2) return sims.map(() => 0);
  const median = known[Math.floor(known.length / 2)];
  const best = known[known.length - 1];
  if (best - median < MEANING_MIN_SPREAD) return sims.map(() => 0);
  return sims.map((x) => (x === null || x <= median ? 0 : (MEANING_WEIGHT * (x - median)) / (best - median)));
}

