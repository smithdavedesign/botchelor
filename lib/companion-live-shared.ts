/**
 * Live calls' client-safe half (docs/companions.md, P6; the server's is lib/companion-live.ts): no DOM, no database,
 * so the browser's call and the tests share it.
 *
 *  - ClauseSplitter: a reply streaming from the model, cut into pieces that can be checked and said one at a time.
 *  - spokenClause: one piece made sayable (a texted *action*, a name in front or quotes around it come off).
 *  - liveStep: the call's turn-taking and barge-in, as a reducer: what Deepgram heard and what's playing in, what to
 *    do (send a turn, stop their voice, drop the reply in flight) out.
 *  - minutesDue: how many of a call's minutes have started.
 */

/** A first piece this long may end at a comma: the sooner the first words are said, the sooner the call feels live. */
export const FIRST_CLAUSE_MIN = 28;
/** Any piece longer than this is cut at a space (Aura takes up to 2,000 characters, but a long piece waits longer). */
export const CLAUSE_MAX = 240;

const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|e\.g|i\.e|Mt|No)\.$/i;

/**
 * Cuts streamed text into pieces at the end of a sentence (. ! ? … followed by a space), the first one also at a comma
 * or a dash once it's long enough, any one at a space past CLAUSE_MAX. "Dr." and "3.5" don't end a sentence.
 */
export class ClauseSplitter {
  private buffer = "";
  private count = 0;

  /** Adds what came and returns the pieces it finished. */
  push(piece: string): string[] {
    this.buffer += piece;
    const out: string[] = [];
    for (;;) {
      const cut = this.cutAt();
      if (cut < 0) break;
      const clause = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (clause) {
        out.push(clause);
        this.count++;
      }
    }
    return out;
  }

  /** What's left once the stream has ended. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    this.count++;
    return [rest];
  }

  private cutAt(): number {
    const b = this.buffer;
    const ends = /[.!?…]+["'”’)]*(?=\s)/g;
    for (let m = ends.exec(b); m; m = ends.exec(b)) {
      const upTo = b.slice(0, m.index + m[0].length);
      if (m[0] === "." && ABBREVIATIONS.test(upTo)) continue;
      if (m[0] === "." && /\d$/.test(b.slice(0, m.index)) && /^\.\d/.test(b.slice(m.index, m.index + 2))) continue;
      return m.index + m[0].length;
    }
    if (this.count === 0 && b.length >= FIRST_CLAUSE_MIN) {
      const soft = /[,;:]\s|\s[—–-]\s/g;
      for (let m = soft.exec(b); m; m = soft.exec(b)) {
        if (m.index + 1 >= FIRST_CLAUSE_MIN) return m.index + m[0].length;
      }
    }
    if (b.length > CLAUSE_MAX) {
      const space = b.lastIndexOf(" ", CLAUSE_MAX);
      return space > 0 ? space + 1 : CLAUSE_MAX;
    }
    return -1;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A piece of a live reply as it's said: a name in front ("Nell:"), a texted *action*, quotes around the whole of it,
 * markdown and emoji come off. Empty when nothing sayable is left.
 */
export function spokenClause(text: string, name: string, first = true): string {
  const firstName = name.trim().split(/\s+/)[0] || name;
  let s = text.replace(/\r/g, "").replace(/\n+/g, " ");
  if (first) s = s.replace(new RegExp(`^\\s*(${escape(name)}|${escape(firstName)})\\s*:\\s*`, "i"), "");
  s = s
    .replace(/\*[^*]{1,120}\*/g, " ")
    .replace(/[*_#`~]/g, " ")
    .replace(/\p{Extended_Pictographic}️?/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (first) s = s.replace(/^["“]\s*/, "");
  s = s.replace(/^["“](.*)["”]$/s, "$1").trim();
  // A quote that closes one opened in an earlier piece (or before the emoji that came off) isn't said.
  if (((s.match(/["“”]/g) ?? []).length % 2 === 1)) s = s.replace(/\s*["”]$/, "").trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : "";
}

/* ------------------------------------------------ turn-taking ------------------------------------------------ */

/** What Deepgram said it heard (its Results message), or that the person stopped (UtteranceEnd). */
export type Heard = { kind: "words"; text: string; isFinal: boolean; speechFinal: boolean } | { kind: "utterance_end" };

export type LiveState = {
  /** listening: the floor is theirs. thinking: their turn went in, no voice yet. speaking: the reply is playing. */
  phase: "listening" | "thinking" | "speaking";
  /** What they've said this turn and Deepgram has settled. */
  said: string;
  /** What it's still hearing. */
  interim: string;
  /** The reply now being said, to tell an echo of it from the person talking. */
  replying: string;
};

export type LiveEffect = { kind: "send"; text: string } | { kind: "barge_in" };

export const LIVE_START: LiveState = { phase: "listening", said: "", interim: "", replying: "" };

/** Words this many or more, heard while they talk, take the floor (one word is too often a cough or "mm"). */
export const BARGE_IN_WORDS = 2;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Whether what was heard is the companion's own voice coming back through the speaker (most browsers cancel the echo,
 * not all): most of its words are in what's being said.
 */
export function echoOf(heard: string, replying: string): boolean {
  const h = words(heard);
  if (!h.length || !replying) return false;
  const said = new Set(words(replying));
  return h.filter((w) => said.has(w)).length / h.length >= 0.7;
}

/**
 * One step of a live call. While it's theirs, Deepgram's settled words gather into `said`, and the end of their speech
 * (speech_final, or UtteranceEnd as the backstop) sends it as a turn. While the companion thinks or talks, words heard
 * (not an echo of the reply, BARGE_IN_WORDS or more) are a barge-in: their voice stops, the reply in flight is dropped,
 * and the floor is the person's, keeping what they've started saying.
 */
export function liveStep(s: LiveState, e: Heard | { kind: "reply_started"; text?: string } | { kind: "reply_text"; text: string } | { kind: "reply_done" } | { kind: "interrupt" }): { state: LiveState; effects: LiveEffect[] } {
  switch (e.kind) {
    case "reply_started":
      return { state: { ...s, phase: "speaking" }, effects: [] };
    case "reply_text":
      return { state: { ...s, replying: `${s.replying} ${e.text}`.trim() }, effects: [] };
    case "reply_done":
      return { state: { ...s, phase: "listening", replying: "" }, effects: [] };
    case "interrupt":
      return { state: { ...s, phase: "listening", replying: "" }, effects: s.phase === "listening" ? [] : [{ kind: "barge_in" }] };
    case "utterance_end": {
      const text = `${s.said} ${s.phase === "listening" ? s.interim : ""}`.replace(/\s+/g, " ").trim();
      if (s.phase !== "listening" || !text) return { state: { ...s, interim: "" }, effects: [] };
      return { state: { ...s, phase: "thinking", said: "", interim: "" }, effects: [{ kind: "send", text }] };
    }
    case "words": {
      const text = e.text.trim();
      if (s.phase !== "listening") {
        if (!text || echoOf(text, s.replying) || words(text).length < BARGE_IN_WORDS) return { state: s, effects: [] };
        // A barge-in: the floor is theirs, and what they've said so far is the start of their turn.
        const next: LiveState = { phase: "listening", said: e.isFinal ? text : "", interim: e.isFinal ? "" : text, replying: "" };
        if (e.isFinal && e.speechFinal) return { state: { ...next, phase: "thinking", said: "" }, effects: [{ kind: "barge_in" }, { kind: "send", text }] };
        return { state: next, effects: [{ kind: "barge_in" }] };
      }
      if (!e.isFinal) return { state: { ...s, interim: text }, effects: [] };
      const said = `${s.said} ${text}`.replace(/\s+/g, " ").trim();
      if (e.speechFinal && said) return { state: { ...s, phase: "thinking", said: "", interim: "" }, effects: [{ kind: "send", text: said }] };
      return { state: { ...s, said, interim: "" }, effects: [] };
    }
  }
}

/** What's on screen while they talk: the settled words and the ones still coming. */
export const heardSoFar = (s: LiveState): string => `${s.said} ${s.interim}`.replace(/\s+/g, " ").trim();

/* ---------------------------------------------------- minutes ---------------------------------------------------- */

/** A minute starts this long after the last one ended, so a turn that lands on the boundary isn't charged twice. */
export const MINUTE_GRACE_MS = 5_000;

/** The minutes of a call that have started by `now` (at least the first). */
export function minutesDue(startedAt: number, now: number): number {
  const elapsed = Math.max(0, now - startedAt - MINUTE_GRACE_MS);
  return Math.max(1, Math.ceil(elapsed / 60_000));
}

/* ------------------------------------------------- the reply stream ------------------------------------------------- */

/**
 * What a live turn's stream carries (text/event-stream, one JSON object a `data:` line):
 *  - say: a checked piece of the reply, in order (`i`), to show and say;
 *  - audio: a piece of its voice (Aura's 16-bit mono PCM at `rate`, base64); audio_end: that piece is all there;
 *  - voice_off: their voice failed, so the rest is said in the device's voice;
 *  - done: the reply is kept (its message id and the whole of what was said); fail: why there's no reply.
 */
export type LiveEvent =
  | { type: "say"; i: number; text: string }
  | { type: "audio"; i: number; pcm: string; rate: number }
  | { type: "audio_end"; i: number }
  // The character saying piece i, lips and all (lib/live-face/musetalk.ts): an MP4 with the voice in it, base64. Comes
  // after the piece's audio; the browser holds the voice for it (CLIP_HOLD_MS) and plays the clip instead.
  | { type: "video"; i: number; mp4: string; frames: number }
  // Piece i has no clip (the renderer failed or was slow): play the held voice the plain way.
  | { type: "video_fail"; i: number }
  | { type: "voice_off"; message: string }
  | { type: "done"; id: string | null; text: string; left: number | null }
  | { type: "fail"; status: number; error: string; message: string };

/** The rate Aura's voice comes at (lib/companion-live.ts asks for it). */
export const LIVE_AUDIO_RATE = 24_000;

/* ---------------------------------------------------- Deepgram ---------------------------------------------------- */

/** One message from Deepgram's listening socket as the call reads it: words (Results), the end of speech, or nothing. */
export function deepgramHeard(raw: string): Heard | null {
  let m: { type?: unknown; is_final?: unknown; speech_final?: unknown; channel?: { alternatives?: { transcript?: unknown }[] } } | null;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (m?.type === "UtteranceEnd") return { kind: "utterance_end" };
  if (m?.type !== "Results") return null;
  const text = m.channel?.alternatives?.[0]?.transcript;
  return { kind: "words", text: typeof text === "string" ? text : "", isFinal: m.is_final === true, speechFinal: m.speech_final === true };
}

/** The microphone's samples (-1..1 at the device's rate) as Deepgram takes them: 16-bit PCM at 16 kHz, averaged down. */
export function toPcm16(input: Float32Array, fromRate: number, toRate = 16_000): ArrayBuffer {
  const ratio = Math.max(1, fromRate / toRate);
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

/** A piece of their voice (base64 16-bit little-endian PCM) as samples to play (-1..1). */
export function pcmSamples(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}
