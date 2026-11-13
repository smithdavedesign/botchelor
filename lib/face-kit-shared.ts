/**
 * A character's face kit, as the browser sees it (lib/face-kit.ts makes it; app/companion/[id]/LiveFace.tsx plays it;
 * docs/PRDs/digital-human.md, Tier 0): a handful of stills of the same portrait, each with one thing changed, and a
 * short living loop. On a call the voice's loudness picks the mouth, the loop plays while they listen, a blink lands
 * now and then, and a line that laughs or gasps shows its look. Nothing here costs anything per minute: the kit is
 * drawn once per portrait and served as files.
 */

/** The stills, each an edit of the portrait: the mouth shapes, the eyes closed, and two looks. */
export const FACE_STILLS = ["portrait", "mouth_small", "mouth_open", "mouth_round", "blink", "smile", "surprised"] as const;
export type FaceStill = (typeof FACE_STILLS)[number];
export type FacePart = FaceStill | "loop";
export const FACE_PARTS: readonly FacePart[] = [...FACE_STILLS, "loop"];

/** What the page gets: a URL per part that's ready, whether more is on its way, and why a part failed if one did. */
export type FaceKit = {
  stills: Partial<Record<FaceStill, string>>;
  loop: string | null;
  making: boolean;
  failed: string | null;
};

/** The mouth, by how loud the voice is right now. */
export type Mouth = "closed" | "small" | "open" | "round";
export const MOUTH_STILL: Record<Mouth, FaceStill> = { closed: "portrait", small: "mouth_small", open: "mouth_open", round: "mouth_round" };

/** A face that can talk: the portrait and all three mouths; the rest is a bonus. */
export function canTalk(kit: FaceKit | null): kit is FaceKit {
  return Boolean(kit?.stills.portrait && kit.stills.mouth_small && kit.stills.mouth_open && kit.stills.mouth_round);
}

/** Everything's there: nothing left to wait for. */
export const kitComplete = (kit: FaceKit | null): boolean => Boolean(kit && !kit.making && kit.loop && FACE_STILLS.every((p) => kit.stills[p]));

/** Loudness (0..1, the voice's RMS) above which the mouth opens, and above which it's wide. */
export const MOUTH_SMALL_FROM = 0.07;
export const MOUTH_OPEN_FROM = 0.2;
/** How far below a threshold the voice must fall before the mouth closes a step (so it doesn't flutter). */
const STICK = 0.025;
/** A wide mouth alternates open and round on this beat, so a long vowel doesn't freeze in one shape. */
const ROUND_BEAT_MS = 170;

/** The mouth for the voice's loudness now (`level`, 0..1), given the mouth it had and the time (ms) for the beat. */
export function mouthFor(level: number, prev: Mouth, t: number): Mouth {
  const wide = prev === "open" || prev === "round";
  if (level >= MOUTH_OPEN_FROM || (wide && level >= MOUTH_OPEN_FROM - STICK)) return Math.floor(t / ROUND_BEAT_MS) % 3 === 2 ? "round" : "open";
  if (level >= MOUTH_SMALL_FROM || (prev !== "closed" && level >= MOUTH_SMALL_FROM - STICK)) return "small";
  return "closed";
}

/** The look a line calls for while it's said: a laugh, a gasp, or none. */
export type Look = "smile" | "surprised";
const LAUGH = /\b(?:ha(?:ha)+|hehe|lol|lmao)\b|😂|😄|😁|🤣|😊|🙂|\bhaha/i;
const GASP = /\b(?:wow|whoa|woah|no way|oh my|seriously|really)\b[!?]|!\?|\?!|😮|😲|😯|\bwow\b/i;
export function lookFor(text: string): Look | null {
  if (LAUGH.test(text)) return "smile";
  if (GASP.test(text)) return "surprised";
  return null;
}

/**
 * A loudness for a voice that can't be measured (the device's own speech synthesis gives no stream): made-up syllables,
 * four or five a second, in phrases that swell and fall. 0 to about 0.45, so the mouth moves without shouting.
 */
export function syntheticLevel(t: number): number {
  const syllable = Math.sin(t / 95) * 0.5 + 0.5;
  const phrase = Math.sin(t / 610) * 0.5 + 0.5;
  return syllable * (0.12 + 0.33 * phrase);
}

/** When the next blink lands: every 2.5 to 6 seconds, by a seed (0..1) so a test can pin it. */
export function nextBlinkIn(seed: number): number {
  return 2500 + Math.min(Math.max(seed, 0), 1) * 3500;
}
export const BLINK_MS = 130;
/** How long a look stays once a line calls for it. */
export const LOOK_MS = 1800;
