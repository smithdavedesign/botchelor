/**
 * Continuity checks for a date in a character's run of dates (the eval's sagas, lib/eval.ts). Deterministic and
 * free, like lib/quality.ts: heuristics for comparing versions over many dates, not a verdict on one line.
 *
 *  - history_claims: lines that claim a shared past ("last time", "remember when", "our first date").
 *  - invented_history: those claims between two characters who have never aired a date together — a memory
 *    hallucination. Should be 0.
 *  - callbacks: in a rematch, lines that pick up something from last time (a word from what was said, or where
 *    it was), or claim the shared past outright. A rematch with none forgot its own history.
 *  - repeated_old_lines: lines that mostly re-perform the speaker's own earlier lines (half their 4-word runs). That's
 *    an echo, not a memory, so it never counts as a callback (saga-local-v1: a rematch "called back" only by
 *    repeating an old line, while both characters re-asked first-date questions).
 */
import type { Turn } from "./conversation";
import { contentWords, tokens } from "./quality";

const grams4 = (text: string): Set<string> => {
  const w = tokens(text);
  const out = new Set<string>();
  for (let i = 0; i + 4 <= w.length; i++) out.add(w.slice(i, i + 4).join(" "));
  return out;
};

const SHARED_PAST =
  /\b(last time|remember when|(do )?you remember|we('ve| have)? met before|since we met|our (first|last) date|the other night|like before|as before|this time around|again, huh|you used to|(good|nice|great|lovely) to see you again)\b/i;

/** A re-performed line: most of its 4-word runs are the speaker's own earlier words. A shared phrase alone isn't. */
const ECHO_SHARE = 0.5;

export type Continuity = {
  met_before: boolean;
  history_claims: number;
  invented_history: number;
  callbacks: number;
  called_back: boolean;
  repeated_old_lines: number;
};

/** What one side brings to a date from before: what it could recall of the other and the place, and its own old lines. */
export type Recall = { recall: string; own: string[] };

/**
 * `lastTime` is what each side could recall of the pair's previous date, or null when the two have never aired a
 * date together. `own` (each side's own earlier lines) also counts outside a rematch, for repeated_old_lines.
 */
export function continuity(transcript: Turn[], lastTime: { a: Recall; b: Recall } | null, own: { a: string[]; b: string[] } = { a: [], b: [] }): Continuity {
  const claims = transcript.filter((t) => SHARED_PAST.test(t.dialogue)).length;
  const recall = { a: new Set(contentWords(lastTime?.a.recall ?? "", 5)), b: new Set(contentWords(lastTime?.b.recall ?? "", 5)) };
  const old = {
    a: new Set([...(lastTime?.a.own ?? []), ...own.a].flatMap((l) => [...grams4(l)])),
    b: new Set([...(lastTime?.b.own ?? []), ...own.b].flatMap((l) => [...grams4(l)])),
  };
  const echoes = (t: Turn) => {
    const gs = [...grams4(t.dialogue)];
    return gs.length > 0 && gs.filter((g) => old[t.side].has(g)).length / gs.length >= ECHO_SHARE;
  };
  const repeated = transcript.filter(echoes).length;
  const callbacks = lastTime
    ? transcript.filter((t) => !echoes(t) && (SHARED_PAST.test(t.dialogue) || contentWords(t.dialogue, 5).some((w) => recall[t.side].has(w)))).length
    : 0;
  return {
    met_before: lastTime !== null,
    history_claims: claims,
    invented_history: lastTime ? 0 : claims,
    callbacks,
    called_back: callbacks > 0,
    repeated_old_lines: repeated,
  };
}
