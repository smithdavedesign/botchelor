/**
 * Continuity checks for a date in a character's run of dates (the eval's sagas, lib/eval.ts). Deterministic and
 * free, like lib/quality.ts: heuristics for comparing versions over many dates, not a verdict on one line.
 *
 *  - history_claims: lines that claim a shared past ("last time", "remember when", "our first date").
 *  - invented_history: those claims between two characters who have never aired a date together — a memory
 *    hallucination. Should be 0.
 *  - callbacks: in a rematch, lines that pick up something from last time (a word from what was said, or where
 *    it was), or claim the shared past outright. A rematch with none forgot its own history.
 */
import type { Turn } from "./conversation";
import { contentWords } from "./quality";

const SHARED_PAST =
  /\b(last time|remember when|(do )?you remember|we('ve| have)? met before|since we met|our (first|last) date|the other night|like before|as before|this time around|again, huh)\b/i;

export type Continuity = {
  met_before: boolean;
  history_claims: number;
  invented_history: number;
  callbacks: number;
  called_back: boolean;
};

/**
 * `lastTime` is what each side could recall of the pair's previous date (its lines, its place), or null when the
 * two have never aired a date together.
 */
export function continuity(transcript: Turn[], lastTime: { a: string; b: string } | null): Continuity {
  const claims = transcript.filter((t) => SHARED_PAST.test(t.dialogue)).length;
  const recall = {
    a: new Set(contentWords(lastTime?.a ?? "", 5)),
    b: new Set(contentWords(lastTime?.b ?? "", 5)),
  };
  const callbacks = lastTime
    ? transcript.filter((t) => SHARED_PAST.test(t.dialogue) || contentWords(t.dialogue, 5).some((w) => recall[t.side].has(w))).length
    : 0;
  return {
    met_before: lastTime !== null,
    history_claims: claims,
    invented_history: lastTime ? 0 : claims,
    callbacks,
    called_back: callbacks > 0,
  };
}
