/**
 * A call's transcript (docs/companions.md, P6): what's been said so far on this call, for the call screen's
 * 💬 Transcript panel (app/companion/[id]/CompanionCall.tsx). Client-safe and pure, so the tests drive it.
 *
 * Held only in the page while the call is on: nothing here is stored. The turns themselves are already kept as
 * messages marked 📞 (lib/companion.ts), and words still being heard never are.
 *
 *  - your words in progress (interim) sit at the end, muted, and are replaced by your line when the turn finishes;
 *  - their reply grows piece by piece, only from pieces the server passed and is saying (a live call's `say` events),
 *    or arrives whole (taking turns);
 *  - talked over (a barge-in, Interrupt, a pause, the call ending), an unfinished reply ends "(cut off)".
 */

export type TranscriptLine = {
  id: number;
  who: "you" | "them";
  text: string;
  /** Finished: your turn went in, or their reply was said to the end (or cut off). */
  done: boolean;
  /** Their reply stopped before its end because it was talked over. */
  cut: boolean;
};

export type Transcript = {
  lines: TranscriptLine[];
  /** Your words still being heard (shown muted, never kept). */
  interim: string;
  next: number;
};

export const TRANSCRIPT_START: Transcript = { lines: [], interim: "", next: 1 };

export type TranscriptEvent =
  /** What's heard of your turn so far (settled and still-coming words together); "" clears it. */
  | { kind: "heard"; text: string }
  /** Your turn finished and went in. */
  | { kind: "you"; text: string }
  /** A piece of their reply, passed by the server's checks and being said. */
  | { kind: "piece"; text: string }
  /** Their whole reply at once (taking turns), being said. */
  | { kind: "reply"; text: string }
  /** Their reply was said to its end. */
  | { kind: "done" }
  /** Their reply was talked over (or stopped): an unfinished one ends "(cut off)". */
  | { kind: "cut" };

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Their reply still being said, if the last line is one. */
function open(t: Transcript): TranscriptLine | null {
  const last = t.lines[t.lines.length - 1];
  return last && last.who === "them" && !last.done ? last : null;
}

function withLast(t: Transcript, line: TranscriptLine): TranscriptLine[] {
  return [...t.lines.slice(0, -1), line];
}

/** Ends their unfinished reply as cut off (nothing to do when there isn't one). */
function cutOff(t: Transcript): Transcript {
  const o = open(t);
  return o ? { ...t, lines: withLast(t, { ...o, done: true, cut: true }) } : t;
}

export function transcriptStep(t: Transcript, e: TranscriptEvent): Transcript {
  switch (e.kind) {
    case "heard": {
      const interim = tidy(e.text);
      return interim === t.interim ? t : { ...t, interim };
    }
    case "you": {
      const text = tidy(e.text);
      // A new turn of yours while their reply is still going: you talked over it.
      const base = cutOff(t);
      if (!text) return { ...base, interim: "" };
      return { lines: [...base.lines, { id: base.next, who: "you", text, done: true, cut: false }], interim: "", next: base.next + 1 };
    }
    case "piece": {
      const text = tidy(e.text);
      if (!text) return t;
      const o = open(t);
      if (o) return { ...t, lines: withLast(t, { ...o, text: `${o.text} ${text}` }) };
      return { ...t, lines: [...t.lines, { id: t.next, who: "them", text, done: false, cut: false }], next: t.next + 1 };
    }
    case "reply": {
      const text = tidy(e.text);
      const base = cutOff(t);
      if (!text) return base;
      return { ...base, lines: [...base.lines, { id: base.next, who: "them", text, done: false, cut: false }], next: base.next + 1 };
    }
    case "done": {
      const o = open(t);
      return o ? { ...t, lines: withLast(t, { ...o, done: true }) } : t;
    }
    case "cut":
      return cutOff(t);
  }
}

/** The newest finished line, for screen readers (announced once each, never word by word). */
export function lastFinished(t: Transcript): TranscriptLine | null {
  for (let i = t.lines.length - 1; i >= 0; i--) if (t.lines[i].done) return t.lines[i];
  return null;
}

/** How close to the bottom still counts as "at the newest line" (a fraction of a line). */
export const STICK_SLACK_PX = 24;

/**
 * Whether the panel follows the newest line: it does while the person is at (or near) the bottom, and stops once
 * they've scrolled up to read back, until they scroll down again.
 */
export function atBottom(scrollTop: number, scrollHeight: number, clientHeight: number, slack = STICK_SLACK_PX): boolean {
  return scrollHeight - clientHeight - scrollTop <= slack;
}
