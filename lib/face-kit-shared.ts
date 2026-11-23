/**
 * A character's face kit, as the browser sees it (lib/face-kit.ts makes it; app/companion/[id]/LiveFace.tsx plays it;
 * docs/PRDs/digital-human.md, Tier 0): their portrait and a short living loop of them, still and natural. On a call the
 * loop plays the whole time, listening and talking alike, and a ring around the face swells with their voice. Nothing
 * here costs anything per minute: the kit is drawn once per portrait and served as files.
 *
 * Until 2026-11-22 a kit also held six more stills (three mouth shapes, a blink, a smile, a gasp) and the call swapped
 * them with the voice's loudness while the loop stopped. Whenever the lip-sync renderer wasn't warm that was the face
 * people saw, and it read as a choppy mouth (David: "back to looking very choppy … let's just have a loop of the
 * character like a gif"). Kits drawn before then still hold those stills; nothing shows them.
 */

/** The still the page shows: the portrait, under the loop and whenever the loop can't play. */
export const FACE_STILLS = ["portrait"] as const;
export type FaceStill = (typeof FACE_STILLS)[number];
/** Stills only older kits hold (the mouth that swapped pictures, drawn until 2026-11-22): kept as rows, never shown or drawn again. */
export const RETIRED_STILLS = ["mouth_small", "mouth_open", "mouth_round", "blink", "smile", "surprised"] as const;
export type RetiredStill = (typeof RETIRED_STILLS)[number];
/**
 * A still the page never shows: the portrait with the mouth at rest (lips together, not smiling), what Ditto animates
 * on a call. From a smiling still it talks through a grin (the 2026-11-15 compare: the smile holds while the jaw opens,
 * so every word shows teeth and the lips never close); from a mouth at rest the lips close between words. Drawn only
 * while Ditto is the renderer that's set (lib/face-kit.ts kitParts).
 */
export const TALK_STILL = "talk" as const;
export type KitStill = FaceStill | RetiredStill | typeof TALK_STILL;
export type FacePart = KitStill | "loop";
/** Every part a kit's row can be (the table's own list): what's drawn now, Ditto's still, and what older kits hold. */
export const FACE_PARTS: readonly FacePart[] = [...FACE_STILLS, ...RETIRED_STILLS, TALK_STILL, "loop"];

/** What the page gets: a URL per part that's ready, whether more is on its way, and why a part failed if one did. */
export type FaceKit = {
  stills: Partial<Record<KitStill, string>>;
  loop: string | null;
  making: boolean;
  failed: string | null;
};

/** A kit with a face to show: its portrait. The loop plays over it once it's there. */
export function hasFace(kit: FaceKit | null): kit is FaceKit {
  return Boolean(kit?.stills.portrait);
}

/** The still a renderer that moves the whole face works from: the talking still once it's drawn, else the portrait. */
export function talkingStill(kit: FaceKit | null): { still: KitStill; url: string } | null {
  if (kit?.stills.talk) return { still: TALK_STILL, url: kit.stills.talk };
  return kit?.stills.portrait ? { still: "portrait", url: kit.stills.portrait } : null;
}

/** Everything the page plays is there: the portrait and the loop, and nothing left to wait for (the talking still isn't the page's, so not waited on). */
export const kitComplete = (kit: FaceKit | null): boolean => Boolean(kit && !kit.making && kit.loop && kit.stills.portrait);

/**
 * How far the ring around their face swells for a voice this loud (`level`, 0..1, the voice's RMS; under 0: it can't be
 * measured, the device's own speech synthesis gives no stream): 0 to 1, eased towards the last value so it breathes
 * rather than flickers. Speech sits around 0.05 to 0.3, so that range is spread over most of the ring.
 */
export function voiceRing(level: number, prev: number): number {
  if (level < 0) return prev;
  const want = Math.min(1, Math.max(0, level) / 0.3);
  // Up fast (a syllable lands), down slowly (it trails off).
  const k = want > prev ? 0.5 : 0.12;
  const next = prev + (want - prev) * k;
  return next < 0.005 ? 0 : Math.round(next * 1000) / 1000;
}
