/**
 * The voices an owner can pick for their character (2026-11-28, David: "make sure they are good voices and don't sound
 * fake"). Inworld TTS 1.5 Max on Venice: blind-vote naturalness around Elo 1,210–1,236 against Kokoro's 1,060 (the
 * stock voice every character has had, lib/voice.ts voiceFor), at $12.50 a million characters against Kokoro's $3.50,
 * so a voice note of 200 characters is about 0.25¢, made once and kept.
 *
 * Ten of Inworld's fourteen stock voices, by its own descriptions. Left out on purpose: Pixie (childlike; every character
 * is an adult), Hades (a theatrical narrator), Luna (made for meditations) and Elizabeth (made for voiceovers). Stock
 * voices only: never a cloned one, so nobody can make a character sound like a real person.
 *
 * Shared with the browser (the builder's picker), so no server imports here. Whether picking is open is the server's
 * (lib/voice.ts voicePickerOn).
 */
export type VoicePick = {
  id: string;
  /** Inworld's own name for it, which Venice takes as `voice`. */
  name: string;
  /** How it sounds, in the builder's words. */
  label: string;
  /** Who it suits by default: the builder lists these first for a character with those pronouns. Anyone may pick any. */
  sounds: "she" | "he";
};

export const VOICE_PICKS: readonly VoicePick[] = [
  { id: "ashley", name: "Ashley", label: "Warm and natural", sounds: "she" },
  { id: "olivia", name: "Olivia", label: "Bright and friendly, British", sounds: "she" },
  { id: "sarah", name: "Sarah", label: "Quick and curious", sounds: "she" },
  { id: "priya", name: "Priya", label: "Calm and even, Indian accent", sounds: "she" },
  { id: "alex", name: "Alex", label: "Upbeat and easygoing", sounds: "he" },
  { id: "edward", name: "Edward", label: "Confident and direct", sounds: "he" },
  { id: "mark", name: "Mark", label: "Lively, talks fast", sounds: "he" },
  { id: "theodore", name: "Theodore", label: "Gravelly and unhurried", sounds: "he" },
  { id: "ronald", name: "Ronald", label: "Deep and assured, British", sounds: "he" },
  { id: "craig", name: "Craig", label: "Polished and older, British", sounds: "he" },
];

export const VOICE_PICK_IDS = VOICE_PICKS.map((p) => p.id) as [string, ...string[]];

export const voicePick = (id: string | null | undefined): VoicePick | null => VOICE_PICKS.find((p) => p.id === id) ?? null;

/** The voice as lib/voice.ts says it: "inworld:Ashley". */
export const pickVoice = (p: VoicePick): string => `inworld:${p.name}`;

/** What every sample says: short, PG, and the same for each voice so they can be compared. */
export const VOICE_SAMPLE_LINE = "Hi. So, this is what I sound like. I'll be honest, I practised this in the mirror. Twice.";
