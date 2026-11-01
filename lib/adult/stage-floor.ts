/**
 * Two checks on what After Dark's model writes, after David's Star Dust × Sable night (2026-10-21):
 *
 *  - The stage floor. The stage is the model's own claim at the end of each batch, and it ran behind the words: oral sex
 *    from line 23 was marked "tension and the first touches", and "kissing" while they rode each other's faces. Each
 *    line is read for what it plainly shows (a kiss, undressing, sex), and the stage is never below the furthest of
 *    them. It only ever raises the claim: a line that shows nothing keeps the stage it had.
 *  - The steer, performed, never quoted. A Direct steer came back word for word as a line's action ("*Eat my pussy*").
 *    A line whose action copies the steer keeps its words without that action; a line whose words copy it is dropped.
 */
import { STAGES } from "./stages";

const SEX = 4;
const UNDRESSING = 3;
const KISSING = 2;
const TOUCHES = 1;

/**
 * What each stage looks like on the page, most explicit first. Plain words only: an innuendo shows nothing, and a word
 * with an everyday sense counts only with a body in it (#1145: "the sound penetrates the nave", "the climax of the chord"
 * and "a thrust of the organ" read as sex for an acoustician and a musician who'd talked about pitch). v2.3's filthy
 * heat (lib/adult/heat.ts) writes plainer talk, in the dialogue as much as the actions; a line is read whole, so its
 * words count wherever they are, and a few of the plain words that talk uses are signs too.
 */
const SIGNS: [number, RegExp][] = [
  [
    SEX,
    /\b(eat(s|ing)?\s+(her|him|me|you)\s+out|face\b.{0,25}\bsits?\s+on\b|go(es|ing)?\s+down\s+on|sits?\s+on\s+(her|his|my|your)\s+face|rid(e|es|ing)\s+(her|his|my|your)\s+face|face[- ]?sit|inside\s+(her|him|me|you)\b|thrust(s|ing)?\s+(into|inside|deeper|harder|against)\s+(her|him|me|you)\b|(his|her|my|your)\s+thrusts\b|penetrat(es|ed|ing)?\s+(her|him|me|you)\b|fuck(s|ed|ing)?\b|cum(s|ming)?\b|orgasm|(she|he|i|you|they|we)\s+climax(es|ed|ing)?\b|squirt(s|ed|ing)?\b(?!\s+(gun|bottle))|mak(e|es|ing)\s+love\b|pussy|cock\b|clit|grind(s|ing)?\s+(against|on|into)\s+(her|him|me|you)|dick\b|blow ?job|(ride|rides|riding)\s+(me|him|you)\b(?!\s+(home|to|there|back|over|out))|(make|makes|making|made)\s+(me|you|him|her)\s+come\b|come\s+(for|inside|in)\s+me\b)/,
  ],
  [
    UNDRESSING,
    // v2.3: filthy's plainer talk names bodies, not clothes, so these count too.
    /\b(tits\b|nipples?\b|undress|strip(s|ped|ping)?\b|unbutton|unzip|unbuckl|(takes?|pulls?|slips?|rips?|tugs?)\s+(off\s+)?(her|his|my|your)\s+(\w+\s+)?(shirt|blouse|dress|top|bra|pants|jeans|skirt|trousers|underwear|panties|clothes)\s*(off)?|(pants|shirt|blouse|dress|bra|clothes)\s+off|naked|topless|panties|underwear)/,
  ],
  [KISSING, /\bkiss(es|ed|ing)?\b/],
  [TOUCHES, /\b(touch(es|ed|ing)?|caress|strok(e|es|ed|ing)|(hand|hands|fingers)\s+(on|over|along|trace|brush|slide)|waist|thigh|nuzzl|embrac)/],
];

/** The stage a line plainly shows (STAGES index), or null when it shows none. */
export function stageShown(text: string): number | null {
  const t = text.toLowerCase();
  for (const [stage, sign] of SIGNS) if (sign.test(t)) return stage;
  return null;
}

/**
 * The stage on each new line and the scene's stage after them. A line keeps the furthest stage shown so far in the batch
 * (from where the scene stood), and the scene's stage is the model's claim, raised to that when the words went further.
 * The last line carries the scene's stage, so the theater's label ends where the scene does.
 */
export function stagesFor(lines: readonly { text: string }[], before: number, claimed: number): { perLine: number[]; stage: number } {
  let running = Math.min(before, claimed);
  const perLine = lines.map((l) => {
    const shown = stageShown(l.text);
    if (shown !== null && shown > running) running = shown;
    return running;
  });
  const stage = Math.min(STAGES.length - 1, Math.max(claimed, running));
  if (perLine.length) perLine[perLine.length - 1] = stage;
  return { perLine, stage };
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]+/gu, " ").split(/\s+/).filter(Boolean);

/** The longest run of words the two share, in order (how much of the steer a passage repeats word for word). */
function longestRun(a: string[], b: string[]): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = up;
    }
  }
  return best;
}

/** Whether a passage repeats the steer: most of it, three words or more in a row (or the whole of a shorter one). */
export function copiesSteer(passage: string, steer: string): boolean {
  const s = words(steer);
  if (!s.length) return false;
  const need = s.length < 3 ? s.length : Math.max(3, Math.ceil(s.length * 0.6));
  return longestRun(words(passage), s) >= need;
}

/**
 * A line, with the steer acted out rather than quoted: its *action* dropped when that copies the steer (the words stay),
 * or null when the words themselves copy it, or there are no words left without the action.
 */
export function withoutSteerCopy(text: string, steer: string | null): { text: string; repaired: boolean } | null {
  if (!steer) return { text, repaired: false };
  const m = text.match(/^\s*\*([^*]+)\*\s*([\s\S]*)$/);
  const action = m ? m[1] : "";
  const said = (m ? m[2] : text).trim();
  if (said && copiesSteer(said, steer)) return null;
  if (action && copiesSteer(action, steer)) return said ? { text: said, repaired: true } : null;
  return { text, repaired: false };
}
