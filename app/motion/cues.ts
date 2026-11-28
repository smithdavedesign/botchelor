/**
 * The show's sound cues (2026-11-28, Dave: sound, off by default): an envelope tearing, a chime as a rose is handed
 * over, a limo door, a ballot going in. Drawn by the Web Audio API, so there are no files to load, and only after a
 * viewer turns sound on (app/motion/SoundToggle.tsx): it stays off until they do, on this browser only. The same switch
 * gives a short buzz on a phone that can (navigator.vibrate). Every cue fails silently: sound is a garnish, never a step.
 */
export type Cue = "chime" | "tear" | "door" | "vote";

const KEY = "bz-sound";
export const SOUND_EVENT = "bz-sound";

export function soundOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSound(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, "on");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private window: on for this page only */
  }
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: on }));
  if (on) cue("vote");
}

type Ctx = AudioContext;
let ctx: Ctx | null = null;
/** The page's one audio context (created on first use, resumed if the browser suspended it), or null where there's none. */
export function audio(): Ctx | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A tone with a quick attack and an exponential fall. */
function tone(c: Ctx, at: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", to?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur * 0.6);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A burst of noise through a band-pass filter, swept from one centre to another. */
function noise(c: Ctx, at: number, dur: number, gain: number, from: number, to: number) {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at);
}

const BUZZ: Record<Cue, number[]> = { chime: [28], tear: [8, 30, 8], door: [40, 70, 30], vote: [14] };

export function cue(name: Cue): void {
  if (typeof window === "undefined" || !soundOn()) return;
  try {
    navigator.vibrate?.(BUZZ[name]);
  } catch {
    /* no buzz here */
  }
  try {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + 0.01;
    switch (name) {
      case "chime":
        // A small bell: a fundamental and two partials, the higher ones falling faster.
        tone(c, t, 1046.5, 1.6, 0.09);
        tone(c, t, 2093, 0.9, 0.035);
        tone(c, t, 3140, 0.5, 0.018);
        break;
      case "tear":
        noise(c, t, 0.32, 0.22, 900, 3800);
        noise(c, t + 0.1, 0.22, 0.12, 2400, 5200);
        break;
      case "door":
        tone(c, t, 95, 0.32, 0.3, "sine", 48);
        noise(c, t, 0.06, 0.16, 2500, 1200);
        break;
      case "vote":
        tone(c, t, 523.25, 0.16, 0.08, "triangle", 784);
        break;
    }
  } catch {
    /* sound is a garnish */
  }
}
