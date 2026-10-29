/**
 * Voiced nights (David, 2026-10-22, from the competitor analysis): every line of a night can be heard, as it plays, in
 * each character's stock voice: the same Kokoro voice their videos use (lib/adult/reels.ts voiceFor), never a cloned
 * one. Kokoro runs where After Dark's media does (`media_provider`): Venice's `tts-kokoro`, or Replicate's Kokoro by its
 * version (af_heart, which it lacks, becomes af_alloy).
 *
 *  - Only what a line says is voiced: its *actions* come out, and a line that's only an action stays silent.
 *  - Nothing goes to TTS before checkAdultText (the two lines): a line that crosses one is never voiced.
 *  - Each line's audio is made once and kept (an adult_images 'audio', found again through adult_voice_lines by a key of
 *    the owner, the voice and the words), so a replay costs nothing.
 *  - The page asks for a few lines at a time, as they're about to play (VOICE_BATCH_MAX), never a whole night up front,
 *    and only lines of the pair's own night, word for word as stored.
 *  - It's part of the subscription (about $0.0004 a line on Venice: $3.50 per million characters), with a monthly cap per
 *    subscriber (`cap_voice_lines`, lib/adult/usage.ts); admins aren't capped. A replay doesn't count.
 */
import { createHash } from "node:crypto";
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { keepBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { reelNight, replicateVoice, voiceFor, VENICE } from "./reels";
import { providerError, runMedia } from "./fallback";
import { runModel } from "./replicate";
import { logRequest } from "./request-log";
import { eligiblePair } from "./scenes";
import { adultKeys, getAdultSettings, type VoiceModel } from "./settings";
import { capOf, capSentence, countUse, usageLeft } from "./usage";

/** Lines a request may ask for: the next few to play. */
export const VOICE_BATCH_MAX = 3;
/** The most of a line that's said (Kokoro's input). */
export const VOICE_TEXT_MAX = 600;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/**
 * A line's voice not back by then is left silent: the theater has moved on (it waits 8 s), and a model starting cold can
 * take minutes (Orpheus took 297 s cold and 4 s warm, 2026-10-29), longer than the route's 60 s.
 */
const VOICE_TIMEOUT_MS = 25_000;

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setVoiceFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** What a line says out loud: every *action* out, the rest tidied. Empty for a line that's only an action. */
export function sayable(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_TEXT_MAX);
}

/** A line's audio is found again by this: whose night it's from, the voice, and the words. */
export const voiceKey = (ownerId: string, voice: string, words: string): string => createHash("sha256").update(`${ownerId}\n${voice}\n${words}`).digest("hex");

/** What's asked: the pair, a saved night (else the running scene), and the lines by place and words. */
export type VoiceAsk = { a: string; b: string; night_id?: string | null; lines: { i: number; text: string }[] };
/**
 * A line's voice: its audio's id (served by /api/admin/after-dark/media/<id>), or null and why: silent (only an action),
 * stale (not that night's line any more), lines (crosses one of the two lines), cap (the month's voiced lines are used
 * up), failed (Kokoro didn't answer).
 */
export type LineVoice = { i: number; id: string | null; reason?: "silent" | "stale" | "lines" | "cap" | "failed"; message?: string; provider?: string; fell_back?: boolean };

export type VoiceResult = { ok: true; voices: LineVoice[] } | { ok: false; status: number; error: string; message: string };

/** Venice's id for each voice model (lib/adult/settings.ts VOICE_MODELS). */
const VENICE_TTS: Record<VoiceModel, string> = { kokoro: "tts-kokoro", orpheus: "tts-orpheus", chatterbox: "tts-chatterbox-hd", inworld: "tts-inworld-1-5-max" };
/**
 * Each model's own voices, by how a character is referred to (Kokoro's are lib/adult/reels.ts voiceFor's), from Venice's
 * model list (2026-10-29). One is picked from a character's id, so it's theirs in every line.
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

/**
 * One line in a voice, on Venice: Kokoro's stock voice (MP3), or a "model:name" one (WAV, the only format Orpheus,
 * Chatterbox and Inworld give: their 400 said so, 2026-10-29).
 */
async function veniceVoice(key: string, words: string, voice: string): Promise<{ bytes: Buffer; mime: string }> {
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
 * The voices for the lines asked for, made where missing (and allowed) and kept. Lines come back in the order asked;
 * the month's cap stops new ones being made, never a replay.
 */
export async function voiceLines(db: Db, ownerId: string, ask: VoiceAsk): Promise<VoiceResult> {
  const pair = await eligiblePair(db, ownerId, ask.a, ask.b);
  const night = pair ? await reelNight(db, ownerId, ask.a, ask.b, ask.night_id ?? null) : null;
  if (!pair || !night) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  const settings = await getAdultSettings(db);
  const keys = await adultKeys(db);
  const onReplicate = settings.media_provider === "replicate";
  const key = onReplicate ? keys.replicate : keys.venice;
  if (!key) return { ok: false, status: 409, error: "not_set_up", message: `Voices need the ${onReplicate ? "Replicate" : "Venice"} key in After Dark's settings.` };
  const [ca, cb] = await Promise.all([loadCharacter(db, pair[0]), loadCharacter(db, pair[1])]);
  if (!ca || !cb) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  // The same stock voice per character as their videos; Replicate's Kokoro by its own names. On Venice, the voice model
  // the settings pick (a better voice than Kokoro's is "model:name", so a line kept in one isn't taken for another's).
  const stock = { a: voiceFor(ca), b: voiceFor(cb) };
  const model: VoiceModel = onReplicate ? "kokoro" : settings.voice_model;
  const chosen = { a: modelVoice(model, ca), b: modelVoice(model, cb) };
  const voiceOf = (who: "a" | "b") => (onReplicate ? replicateVoice(stock[who]) : chosen[who]);

  // The month's cap: what's left is asked once a request, and each new voice takes one of it before it's made, so lines
  // made at once can't go past it (one that fails gives its place back). Null: an admin, never capped.
  let leftCheck: Promise<number | null> | null = null;
  let taken = 0;
  const room = async (): Promise<string | null> => {
    const left = await (leftCheck ??= usageLeft(db, ownerId, "voice_lines"));
    if (left === null || taken < left) {
      taken++;
      return null;
    }
    return capSentence(await capOf(db, "voice_lines"), "voice_lines");
  };
  // One line's voice. The few asked for are made at once, not one after another: the theater waits only so long for the
  // line about to play (Listen.tsx), and the better models take seconds a line (2026-10-29).
  const one = async (asked: VoiceAsk["lines"][number]): Promise<LineVoice> => {
    const line = night.lines[asked.i];
    if (!line || line.text !== asked.text) {
      return { i: asked.i, id: null, reason: "stale" };
    }
    const words = sayable(line.text);
    if (!words) {
      return { i: asked.i, id: null, reason: "silent" };
    }
    if (!checkAdultText({ words }).ok) {
      return { i: asked.i, id: null, reason: "lines" };
    }
    const voice = voiceOf(line.who);
    const k = voiceKey(ownerId, voice, words);
    const kept = (
      await db.query<{ image_id: string }>(
        `select v.image_id from adult_voice_lines v join adult_images i on i.id = v.image_id and i.status = 'ready' where v.owner_id = $1 and v.key = $2`,
        [ownerId, k],
      )
    ).rows[0];
    if (kept) {
      return { i: asked.i, id: kept.image_id };
    }
    const capped = await room();
    if (capped) {
      return { i: asked.i, id: null, reason: "cap", message: capped };
    }
    try {
      // A voice line is one job: said on the other provider's Kokoro when the configured one is limited (lib/adult/fallback.ts).
      const said = await runMedia(db, "voice", (p) =>
        p === "replicate"
          ? runModel(keys.replicate!, settings.replicate_voice_model, { text: words, voice: replicateVoice(stock[line.who]), speed: 1 }, { maxBytes: MAX_AUDIO_BYTES, timeoutMs: 60_000 })
          : veniceVoice(keys.venice!, model === "orpheus" ? orpheusWords(line.text, words) : words, chosen[line.who]),
      );
      const audio = said.value;
      if (!audio.mime.startsWith("audio/")) throw new Error("no audio came back");
      const id = crypto.randomUUID();
      const bytes = await keepBytes("after-dark", id, audio.bytes, audio.mime);
      const [speaker, other] = line.who === "a" ? pair : [pair[1], pair[0]];
      await db.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back) values ($1, $2, $3, $4, 'audio', $5, $6, $7, $8, 'ready', $9, $10)`,
        [id, ownerId, speaker, other, `Voice line: ${words}`.slice(0, 500), audio.mime, bytes.data, bytes.object_key, said.provider, said.fell_back],
      );
      // Two plays of the same line at once: the first one kept wins, and the other's copy goes.
      const won = await db.query(`insert into adult_voice_lines (owner_id, key, image_id, voice, chars) values ($1, $2, $3, $4, $5) on conflict do nothing returning image_id`, [
        ownerId,
        k,
        id,
        voice,
        words.length,
      ]);
      if (!won.rows.length) {
        await db.query(`delete from adult_images where id = $1`, [id]).catch(() => {});
        const first = (await db.query<{ image_id: string }>(`select image_id from adult_voice_lines where owner_id = $1 and key = $2`, [ownerId, k])).rows[0];
        return { i: asked.i, id: first?.image_id ?? null, ...(first ? {} : { reason: "failed" as const }) };
      }
      await countUse(db, ownerId, "voice_lines");
      return { i: asked.i, id, ...(said.fell_back ? { provider: said.provider, fell_back: true } : {}) };
    } catch (err) {
      taken--;
      return { i: asked.i, id: null, reason: "failed", message: err instanceof Error ? err.message.slice(0, 160) : "error" };
    }
  };
  const voices = await Promise.all(ask.lines.slice(0, VOICE_BATCH_MAX).map(one));
  return { ok: true, voices };
}
