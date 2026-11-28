import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { keepBytes, objectStore } from "./object-store";
import { sayOnVenice, voiceKey } from "./voice";
import { pickVoice, VOICE_SAMPLE_LINE, voicePick } from "./voice-picks";

/**
 * The builder's sample of each pickable voice (lib/voice-picks.ts): the same line in each, said once on Venice and kept
 * in companion_voice under a "sample:" key, which the unused-voice sweep leaves alone (lib/companion-voice.ts). Ten
 * voices, one line: about 0.14¢ each, once. Said on Venice only, never the fallback's Kokoro, so a sample always sounds
 * like the voice it's named for.
 */
export type VoiceSampleFile = { mime: string; data: Buffer | null; object_key: string | null };

export const sampleKey = (voice: string): string => `sample:${voiceKey("sample", voice, VOICE_SAMPLE_LINE)}`;

export async function voiceSample(db: Db, id: string): Promise<VoiceSampleFile | null> {
  const pick = voicePick(id);
  if (!pick) return null;
  const voice = pickVoice(pick);
  const key = sampleKey(voice);
  const kept = await readKept(db, key);
  if (kept) return kept;
  const said = await sayOnVenice(db, VOICE_SAMPLE_LINE, voice);
  if (!said) return null;
  const stored = await keepBytes("companion", randomUUID(), said.bytes, said.mime);
  const won = await db.query(
    `insert into companion_voice (key, voice, chars, mime, data, object_key, provider) values ($1, $2, $3, $4, $5, $6, 'venice') on conflict (key) do nothing returning key`,
    [key, voice, VOICE_SAMPLE_LINE.length, said.mime, stored.data, stored.object_key],
  );
  // Two first plays at once: the first one kept wins, this copy goes.
  if (!won.rows.length) {
    if (stored.object_key) await objectStore()?.remove(stored.object_key).catch(() => {});
    return readKept(db, key);
  }
  return { mime: said.mime, data: stored.data, object_key: stored.object_key };
}

async function readKept(db: Db, key: string): Promise<VoiceSampleFile | null> {
  return (await db.query<VoiceSampleFile>(`select mime, data, object_key from companion_voice where key = $1`, [key])).rows[0] ?? null;
}
