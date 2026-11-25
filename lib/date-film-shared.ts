/**
 * A date on film (lib/date-film.ts, 2026-11-24): the pure half, safe for a page and for the clip scripts' tests.
 *
 * Two things are made for one featured date a day:
 *  - **scenes**: still pictures of both of them in the date's place, each at a moment the date's own lines describe
 *    (a line's `action`), drawn free;
 *  - **confessionals**: each one's diary-cam line said to camera, the confessional still's lips moving with a voice.
 *    The only part that costs money, so the words are kept short and the month has a ceiling (date-film.ts).
 */

/** At most this many scene pictures a date. */
export const FILM_SCENES = 3;

/** What the talking model bills a second of clip (Replicate's Wan 2.2 S2V, as lib/live-face/renderers.ts prices it). */
export const FILM_USD_PER_SECOND = 0.02;
/** The model's frames a second, and the most it makes in one take (4n+1): a confessional is one take, about 7.5 s. */
export const FILM_FPS = 16;
export const FILM_MAX_FRAMES = 121;
export const FILM_MIN_FRAMES = 81;
/** A breath before the first word and after the last. */
export const FILM_LEAD_S = 0.25;
export const FILM_TAIL_S = 0.3;
/** The longest a voice may run and still fit one take with its breaths. */
export const FILM_MAX_VOICE_S = FILM_MAX_FRAMES / FILM_FPS - FILM_LEAD_S - FILM_TAIL_S;
/**
 * The most characters said to camera. Aura speaks about 20 a second (a 102-character line ran 5.1 s, live 2026-11-24),
 * so this is about 6.5 s: inside one take with room to spare, and about 14¢.
 */
export const FILM_LINE_CHARS = 130;

export type FilmScene = {
  id: string;
  /** The picture, /api/date-film/<id>/scene.webp. */
  src: string;
  /** The transcript line whose moment it shows. */
  line_at: number;
  /** What's happening in it, for the alt text and the caption ("Juniper sets down a thermos"). */
  caption: string;
};

export type FilmConfessional = {
  id: string;
  character_id: string;
  /** The clip, /api/date-film/<id>/clip.mp4, and the still it starts on. */
  src: string;
  poster: string | null;
  seconds: number;
  /** The words said (the diary line, or its opening when the line ran long). */
  line: string;
};

/** A date's film as a page or a clip script reads it: only what's ready. */
export type DateFilm = { scenes: FilmScene[]; confessionals: FilmConfessional[] };

/** A line's sentences, each with its closing mark. */
function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+["'”’)]*|[^.!?…]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * The words said to camera: the diary line whole when it fits `max` characters; else its opening sentences that fit;
 * else its first sentence up to the last clause break that fits (a comma, a semicolon, a dash), closed with a full
 * stop. Never cut mid-clause: a line with no break inside `max` isn't filmed (null).
 */
export function filmLine(line: string, max: number = FILM_LINE_CHARS): string | null {
  const text = line.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const kept: string[] = [];
  for (const s of sentencesOf(text)) {
    if ([...kept, s].join(" ").length > max) break;
    kept.push(s);
  }
  if (kept.length) return kept.join(" ");
  const first = sentencesOf(text)[0] ?? text;
  let cut = -1;
  for (const m of first.matchAll(/[,;:]\s|\s[—–-]\s/g)) {
    if (m.index !== undefined && m.index <= max - 1 && m.index >= 24) cut = m.index;
  }
  if (cut < 0) return null;
  return `${first.slice(0, cut).trim()}.`;
}

/**
 * The cuts of a line to try saying, longest first: `filmLine` at FILM_LINE_CHARS, then shorter. Voices differ in speed
 * (Barnaby's 114 characters ran past one take, live 2026-11-24, where Sable's 108 took 5.5 s), so a cut that runs long
 * is said again shorter rather than not filmed. Each is a whole clause; none repeats.
 */
const FILM_LINE_STEPS = [FILM_LINE_CHARS, 95, 70] as const;
export function filmLines(line: string): string[] {
  const out: string[] = [];
  for (const max of FILM_LINE_STEPS) {
    const cut = filmLine(line, max);
    if (cut && !out.includes(cut)) out.push(cut);
  }
  return out;
}

/** The frames of one take that hold a voice of `voiceSeconds` with its breaths, or null when it can't fit one take. */
export function filmFrames(voiceSeconds: number): number | null {
  if (!(voiceSeconds > 0) || voiceSeconds > FILM_MAX_VOICE_S) return null;
  const needed = Math.ceil((voiceSeconds + FILM_LEAD_S + FILM_TAIL_S) * FILM_FPS);
  return Math.min(FILM_MAX_FRAMES, Math.max(FILM_MIN_FRAMES, 4 * Math.ceil((needed - 1) / 4) + 1));
}

/** What a take of `frames` costs, in dollars. */
export const filmCost = (frames: number): number => Math.round((frames / FILM_FPS) * FILM_USD_PER_SECOND * 1e4) / 1e4;
/** The most one confessional can cost (a full take), which is what's held of the budget before it's made. */
export const FILM_CLIP_MAX_USD = filmCost(FILM_MAX_FRAMES);

/* ------------------------------------------------- the scenes' moments ------------------------------------------------- */

export type FilmTurn = { side: "a" | "b"; act: number; action?: string | null; emotion?: string | null; dialogue?: string | null };
export type FilmMoment = { at: number; side: "a" | "b"; action: string; emotion: string };

const tidy = (s: string | null | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").replace(/^[\s*(["'“]+|[\s*)."'”]+$/g, "").trim().slice(0, max);

/**
 * The moments a date's scenes show, in the date's order: lines that say what someone is doing (`action`), spread over
 * the date, and never from its last act when it has more than one (the scenes go into the day's clip, which mustn't
 * show how the date ended). A date with too few such lines gives fewer moments, down to none.
 */
export function sceneMoments(transcript: readonly FilmTurn[], max: number = FILM_SCENES): FilmMoment[] {
  const lastAct = transcript.reduce((m, t) => Math.max(m, t.act ?? 0), 0);
  const firstAct = transcript.reduce((m, t) => Math.min(m, t.act ?? 0), Infinity);
  const open = transcript
    .map((t, at) => ({ at, side: t.side, act: t.act ?? 0, action: tidy(t.action, 120), emotion: tidy(t.emotion, 40) }))
    .filter((t) => t.action.length >= 4 && (lastAct === firstAct || t.act < lastAct) && (t.side === "a" || t.side === "b"));
  if (open.length <= max) return open.map(({ at, side, action, emotion }) => ({ at, side, action, emotion }));
  // Spread evenly: the first, the last, and what lies between.
  const picks = new Set<number>();
  for (let i = 0; i < max; i++) picks.add(Math.round((i * (open.length - 1)) / (max - 1 || 1)));
  return [...picks].sort((x, y) => x - y).map((i) => ({ at: open[i].at, side: open[i].side, action: open[i].action, emotion: open[i].emotion }));
}

/** A moment as a caption: "Juniper sets down a thermos". */
export function momentCaption(name: string, action: string): string {
  const first = name.trim().split(/\s+/)[0] || name.trim();
  const a = action.trim().replace(/[.\s]+$/, "");
  return a ? `${first} ${a.charAt(0).toLowerCase()}${a.slice(1)}` : first;
}
