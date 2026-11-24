/**
 * A call's caption keeps time with the voice (David, 2026-11-24, on a Step in call: the words showed a few seconds
 * before she said them; "ideally we should [show] the text as she speaks it"). Both calls use it: Step in
 * (app/after-dark/step-in/[id]/StepInCall.tsx) and the show's companion call (app/companion/[id]/CompanionCall.tsx).
 */

/** About how many letters a voice says a second: the pace when the audio doesn't say how long it is. */
const LETTERS_A_SECOND = 14;

/**
 * The words of `text` said by `fraction` (0 to 1) of its voice, cut after a word. Paced by letters, which follows a
 * voice closely enough for a caption; a word shows as it starts.
 */
export function saidSoFar(text: string, fraction: number): string {
  const t = text.trim();
  if (fraction >= 1) return t;
  const at = Math.max(0, fraction || 0) * t.length;
  let end = 0;
  for (const m of t.matchAll(/\S+/g)) {
    if (m.index > at) break;
    end = m.index + m[0].length;
  }
  return t.slice(0, end);
}

/**
 * Shows `text` through `show` as `el` says it, word by word, from its first sound (nothing before it starts), until the
 * returned stop is called. Start it in the same task that sets the element's source: it first looks on the next frame,
 * so the last line's end isn't read as this one's.
 */
export function followVoice(el: HTMLMediaElement, text: string, show: (said: string) => void): () => void {
  let last: string | null = null;
  let frame = 0;
  const tick = () => {
    const long = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : text.length / LETTERS_A_SECOND;
    const said = el.currentTime > 0 ? saidSoFar(text, el.currentTime / long) : "";
    if (said !== last) {
      last = said;
      show(said);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
