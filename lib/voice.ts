/**
 * Voices (shared): a character's lines said out loud in a stock voice of their own, never a cloned one. After Dark's
 * voiced nights (lib/adult/voice-lines.ts) and companions' voice notes (lib/companion-voice.ts) both say lines here.
 *
 *  - One voice per character: Kokoro's, picked once from their pronouns and id (voiceFor), the same in every reel, night
 *    and voice note. On Replicate's Kokoro by its own names (replicateVoice). After Dark's nights can use a better model
 *    on Venice ("model:name", modelVoice); a companion's voice note is always Kokoro.
 *  - Said where After Dark's media is made (`media_provider`: Venice's `tts-kokoro`, or Replicate's Kokoro by its
 *    version), on the other when that one is limited (lib/adult/fallback.ts runMedia).
 *  - Only what a line says is voiced: its *actions* come out (sayable).
 *  - Callers keep what's said by a hash of the voice and the words (voiceKey), so a line is never paid for twice.
 */
import { createHash } from "node:crypto";
import type { Character } from "./character";
import type { Db } from "./db";
import { providerError, runMedia, type Ran } from "./adult/fallback";
import { runModel } from "./adult/replicate";
import { logRequest } from "./adult/request-log";
import { adultKeys, getAdultSettings, type VoiceModel } from "./adult/settings";

const VENICE = "https://api.venice.ai/api/v1";

/** The most of a line that's said (Kokoro's input). */
export const VOICE_TEXT_MAX = 600;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/**
 * A line's voice not back by then is left silent: the theater has moved on (it waits 8 s), and a model starting cold can
 * take minutes (Orpheus took 297 s cold and 4 s warm, 2026-10-29), longer than the route's 60 s.
 */
const VOICE_TIMEOUT_MS = 25_000;

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
/** Tests stub Venice's speech endpoint. */
export function setVoiceFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** Kokoro's stock voices, by how a character is referred to. */
const VOICES = {
  she: ["af_bella", "af_nicole", "af_sarah", "af_heart", "af_nova", "af_jessica", "af_kore", "af_aoede"],
  he: ["am_onyx", "am_michael", "am_adam", "am_eric", "am_liam", "am_fenrir", "am_echo", "am_puck"],
  they: ["af_river", "am_echo", "af_sky", "am_liam"],
} as const;

/** A character's voice: picked once from their pronouns and id, so it's the same in every reel, night and voice note. */
export function voiceFor(c: Pick<Character, "id" | "pronouns">): string {
  const p = c.pronouns?.toLowerCase() ?? "";
  const list = p.startsWith("she") ? VOICES.she : p.startsWith("he") ? VOICES.he : VOICES.they;
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** Kokoro's voices on Replicate (jaaari/kokoro-82m's list, 2026-10-22): all of ours but af_heart, which it lacks. */
const REPLICATE_VOICES = new Set([
  "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck",
]);
/** A character's voice as Replicate's Kokoro has it: af_heart becomes af_alloy, a voice no one else of ours has. */
export function replicateVoice(voice: string): string {
  if (REPLICATE_VOICES.has(voice)) return voice;
  return voice === "af_heart" ? "af_alloy" : voice.startsWith("am_") ? "am_adam" : "af_bella";
}

/** What a line says out loud: every *action* out, the rest tidied. Empty for a line that's only an action. */
export function sayable(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_TEXT_MAX);
}

/** A line's audio is found again by this: whose it is (an owner, or a scope like "companion"), the voice, and the words. */
export const voiceKey = (ownerId: string, voice: string, words: string): string => createHash("sha256").update(`${ownerId}\n${voice}\n${words}`).digest("hex");

/** Venice's id for each voice model (lib/adult/settings.ts VOICE_MODELS). */
const VENICE_TTS: Record<VoiceModel, string> = { kokoro: "tts-kokoro", orpheus: "tts-orpheus", chatterbox: "tts-chatterbox-hd", inworld: "tts-inworld-1-5-max" };
/**
 * Each model's own voices, by how a character is referred to (Kokoro's are voiceFor's), from Venice's model list
 * (2026-10-29). One is picked from a character's id, so it's theirs in every line.
 */
const MODEL_VOICES: Record<Exclude<VoiceModel, "kokoro">, { she: readonly string[]; he: readonly string[]; they: readonly string[] }> = {
  orpheus: { she: ["tara", "leah", "jess", "mia", "zoe"], he: ["leo", "dan", "zac"], they: ["tara", "leo"] },
  chatterbox: { she: ["Aurora", "Britney", "Siobhan", "Vicky"], he: ["Blade", "Carl", "Cliff", "Richard", "Rico"], they: ["Aurora", "Rico"] },
  inworld: { she: ["Ashley", "Elizabeth", "Luna", "Olivia", "Pixie", "Priya", "Sarah"], he: ["Alex", "Craig", "Edward", "Hades", "Mark", "Ronald", "Theodore"], they: ["Luna", "Alex"] },
};

/** A character's voice in a model: Kokoro's as always (voiceFor), else one of that model's, "orpheus:tara". */
export function modelVoice(model: VoiceModel, c: { id: string; pronouns: string | null }): string {
  if (model === "kokoro") return voiceFor(c);
  const p = c.pronouns?.toLowerCase() ?? "";
  const set = MODEL_VOICES[model];
  const list = p.startsWith("she") ? set.she : p.startsWith("he") ? set.he : set.they;
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${model}:${list[h % list.length]}`;
}

/**
 * The sounds Orpheus makes when its line asks for them, from what the line's action shows: "*laughs*" is heard as a laugh
 * (docs/PRDs/theater-immersion.md #3). At most one, before the words.
 */
const ORPHEUS_SOUNDS: readonly (readonly [RegExp, string])[] = [
  [/\blaugh(?:s|ing|ed)?\b/i, "<laugh>"],
  [/\bchuckl(?:es|ing|ed|e)\b/i, "<chuckle>"],
  [/\bgasp(?:s|ing|ed)?\b/i, "<gasp>"],
  [/\bsigh(?:s|ing|ed)?\b/i, "<sigh>"],
  [/\b(?:groan|moan)(?:s|ing|ed)?\b/i, "<groan>"],
  [/\byawn(?:s|ing|ed)?\b/i, "<yawn>"],
];
export function orpheusWords(text: string, words: string): string {
  const action = (text.match(/\*[^*]+\*/g) ?? []).join(" ");
  const sound = ORPHEUS_SOUNDS.find(([re]) => re.test(action))?.[1];
  return sound ? `${sound} ${words}` : words;
}

export type Audio = { bytes: Buffer; mime: string };

/**
 * One line in a voice, on Venice: Kokoro's stock voice (MP3), or a "model:name" one (WAV, the only format Orpheus,
 * Chatterbox and Inworld give: their 400 said so, 2026-10-29).
 */
export async function veniceVoice(key: string, words: string, voice: string): Promise<Audio> {
  const [model, name] = voice.includes(":") ? (voice.split(":") as [VoiceModel, string]) : (["kokoro", voice] as const);
  const format = model === "kokoro" ? "mp3" : "wav";
  const body = { model: VENICE_TTS[model] ?? "tts-kokoro", input: words, voice: name, response_format: format };
  logRequest(`${VENICE}/audio/speech`, body);
  const res = await doFetch(`${VENICE}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
  });
  if (!res.ok) throw await providerError(res, (status, text) => `Venice ${status}: ${text.slice(0, 120)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("Venice returned no usable audio");
  return { bytes, mime: format === "mp3" ? "audio/mpeg" : "audio/wav" };
}

/**
 * Says one line where After Dark's media is made, or on the other provider when that one is limited (runMedia):
 * Replicate's Kokoro in `stock` (its own names), or Venice in `chosen` (Kokoro's `stock` unless a better model's
 * "model:name"). `spoken`: what Venice is handed when it differs from the words (Orpheus's sounds).
 */
export async function sayLine(db: Db, line: { words: string; stock: string; chosen?: string; spoken?: string }): Promise<Ran<Audio>> {
  const [settings, keys] = await Promise.all([getAdultSettings(db), adultKeys(db)]);
  const said = await runMedia(db, "voice", (p) =>
    p === "replicate"
      ? runModel(keys.replicate!, settings.replicate_voice_model, { text: line.words, voice: replicateVoice(line.stock), speed: 1 }, { maxBytes: MAX_AUDIO_BYTES, timeoutMs: 60_000 })
      : veniceVoice(keys.venice!, line.spoken ?? line.words, line.chosen ?? line.stock),
  );
  if (!said.value.mime.startsWith("audio/")) throw new Error("no audio came back");
  return said;
}

/** Whether voices can be made at all: the key of the provider After Dark's media is made on. */
export async function voiceReady(db: Db): Promise<boolean> {
  const [settings, keys] = await Promise.all([getAdultSettings(db), adultKeys(db).catch(() => ({ venice: null, replicate: null }))]);
  return Boolean(settings.media_provider === "replicate" ? keys.replicate : keys.venice);
}
