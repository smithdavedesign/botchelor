/**
 * A story reply's text, taken apart (lib/narration.ts story mode: a scene reply written as prose in one go, what's
 * said out loud in double quotes inside it). Stored as its paragraphs joined by a blank line. These three read it
 * back for whoever shows or voices it: the paragraphs, the quoted speech, and each paragraph as runs of speech and
 * narration.
 *
 * Pure and client-safe (the chat renders with it), with no rating in it: After Dark's story replies read the same way.
 */

const QUOTED = /“[^”]*”|"[^"]*"/g;

/** A story reply's paragraphs (it's stored with a blank line between them). */
export function storyParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** One paragraph as runs: what's said out loud (with its quote marks) and the narration around it, in order. */
export function storySegments(paragraph: string): { said: boolean; text: string }[] {
  const out: { said: boolean; text: string }[] = [];
  let last = 0;
  for (const m of paragraph.matchAll(QUOTED)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ said: false, text: paragraph.slice(last, at) });
    out.push({ said: true, text: m[0] });
    last = at + m[0].length;
  }
  if (last < paragraph.length) out.push({ said: false, text: paragraph.slice(last) });
  return out.filter((s) => s.text.trim());
}

/**
 * What a story reply says out loud: each quoted line, without its quote marks, in order. The voice reads only these,
 * the stage shows the first, and the repeat check compares them; the narration is never spoken.
 */
export function storySpeech(text: string): string[] {
  return [...text.matchAll(QUOTED)].map((m) => m[0].slice(1, -1).replace(/\s+/g, " ").trim()).filter(Boolean);
}
