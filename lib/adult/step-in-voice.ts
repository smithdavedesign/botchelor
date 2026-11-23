/**
 * Step in, heard (docs/after-dark.md "Step in": voice and calls; David, 2026-11-22: "make the companion features in sfw
 * available in nsfw step in … we should have the ability to live call in after dark"). What a character says in a
 * Step in scene, out loud, in the same stock voice their voiced nights and videos use (lib/voice.ts: never a cloned
 * one), made where After Dark's media is made (Venice, or Replicate's Kokoro). It serves two things:
 *
 *  - **Hear it:** a written reply's spoken lines (what's inside its quotes; never the narration), a piece at a time;
 *  - **a call:** the character's answer to a line the viewer said out loud, which is all speech (lib/adult/step-in.ts
 *    `form: "call"`), voiced piece by piece as the call plays it.
 *
 * The rules are voiced nights' own (lib/adult/voice-lines.ts), for one character:
 *  - only a piece of a reply that's stored in the viewer's own scene, word for word (the page asks by message and piece
 *    number, never by words): a browser can't have a voice say anything it likes;
 *  - nothing goes to the voice before the lines that never move are read again (checkAdultText, and Step in's own net);
 *  - each piece's audio is made once and kept (an adult_images 'audio', found again through adult_voice_lines by the
 *    owner, the voice and the words), so hearing it again costs nothing;
 *  - it's part of the subscription, inside the month's voiced lines (`cap_voice_lines`); admins aren't capped, and a
 *    replay never counts;
 *  - nothing more is made of a character who has left the viewer's After Dark.
 */
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { keepBytes, readBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { modelVoice, orpheusWords, replicateVoice, sayable, sayLine, voiceFor, voiceKey } from "../voice";
import { eligibleIds } from "./characters";
import { adultKeys, getAdultSettings, type VoiceModel } from "./settings";
import { stepInNever } from "./step-in-lines";
import { spokenPieces } from "./step-in-shared";
import { capOf, capSentence, countUse, usageLeft } from "./usage";

export type StepInVoiceFail = { ok: false; status: number; error: string; message: string };
/** A piece's voice: its audio and type, how many pieces the reply has, and whether it was made now (false: a replay). */
export type StepInVoice = { ok: true; id: string; bytes: Buffer; mime: string; pieces: number; made: boolean } | StepInVoiceFail;

const fail = (status: number, error: string, message: string): StepInVoiceFail => ({ ok: false, status, error, message });

type Row = { id: string; role: string; kind: string | null; text: string; character_id: string };

/**
 * Piece `piece` of a character's reply in the viewer's own scene, out loud: the kept audio when it was made before,
 * else made now (one of the month's voiced lines), kept, and returned.
 */
export async function stepInVoice(db: Db, viewer: string, sceneId: string, messageId: string, piece: number): Promise<StepInVoice> {
  const m = (
    await db.query<Row>(
      `select m.id, m.role, m.kind, m.text, s.character_id
         from adult_step_in_messages m join adult_step_in_scenes s on s.id = m.scene_id
        where m.id = $1 and m.scene_id = $2 and s.owner_id = $3`,
      [messageId, sceneId, viewer],
    )
  ).rows[0];
  // The viewer's own lines are never voiced, and the narrator's stand-in says nothing out loud.
  if (!m || m.role !== "character" || m.kind === "aside") return fail(404, "not_found", "There's nothing to hear there.");
  const pieces = spokenPieces(m.text);
  const words = sayable(pieces[piece] ?? "");
  if (!Number.isInteger(piece) || piece < 0 || !words) return fail(404, "not_found", "There's nothing to hear there.");
  if (!(await eligibleIds(db, viewer)).has(m.character_id)) return fail(409, "character_out", "They aren't in your After Dark any more, so nothing new of them is made.");
  // Read again as it's used: a reply kept before a check got stricter is never voiced.
  if (!checkAdultText({ words }).ok || stepInNever(words)) return fail(422, "lines", "That line can't be voiced.");
  const [settings, keys, character] = await Promise.all([getAdultSettings(db), adultKeys(db), loadCharacter(db, m.character_id)]);
  if (!character) return fail(404, "not_found", "There's nothing to hear there.");
  const onReplicate = settings.media_provider === "replicate";
  if (!(onReplicate ? keys.replicate : keys.venice)) return fail(409, "not_set_up", `Voices need the ${onReplicate ? "Replicate" : "Venice"} key in After Dark's settings.`);
  // Their one stock voice (lib/voice.ts): Kokoro's on Replicate, the settings' voice model's on Venice.
  const stock = voiceFor(character);
  const model: VoiceModel = onReplicate ? "kokoro" : settings.voice_model;
  const chosen = modelVoice(model, character);
  const voice = onReplicate ? replicateVoice(stock) : chosen;
  const key = voiceKey(viewer, voice, words);
  const keptRow = async () =>
    (
      await db.query<{ id: string; mime: string; data: Buffer | null; object_key: string | null }>(
        `select i.id, i.mime, i.data, i.object_key from adult_voice_lines v join adult_images i on i.id = v.image_id and i.status = 'ready' where v.owner_id = $1 and v.key = $2`,
        [viewer, key],
      )
    ).rows[0];
  const kept = await keptRow();
  if (kept) {
    const bytes = await readBytes(kept);
    if (bytes) return { ok: true, id: kept.id, bytes, mime: kept.mime, pieces: pieces.length, made: false };
  }
  const left = await usageLeft(db, viewer, "voice_lines");
  if (left !== null && left <= 0) return fail(429, "capped", capSentence(await capOf(db, "voice_lines"), "voice_lines"));
  let said: Awaited<ReturnType<typeof sayLine>>;
  try {
    said = await sayLine(db, { words, stock, chosen, spoken: model === "orpheus" ? orpheusWords(pieces[piece], words) : undefined });
  } catch (err) {
    return fail(502, "voice_down", err instanceof Error && /limit|quota|429/i.test(err.message) ? "The voice is busy right now. Try again in a moment." : "The voice didn't answer. Try again in a moment.");
  }
  const audio = said.value;
  const id = crypto.randomUUID();
  const stored = await keepBytes("after-dark", id, audio.bytes, audio.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back) values ($1, $2, $3, null, 'audio', $4, $5, $6, $7, 'ready', $8, $9)`,
    [id, viewer, m.character_id, `Voice line: ${words}`.slice(0, 500), audio.mime, stored.data, stored.object_key, said.provider, said.fell_back],
  );
  // Two asks for the same piece at once: the first one kept wins, and the other's copy goes.
  const won = await db.query(`insert into adult_voice_lines (owner_id, key, image_id, voice, chars) values ($1, $2, $3, $4, $5) on conflict do nothing returning image_id`, [viewer, key, id, voice, words.length]);
  if (!won.rows.length) {
    await db.query(`delete from adult_images where id = $1`, [id]).catch(() => {});
    const first = await keptRow();
    const bytes = first ? await readBytes(first) : null;
    return first && bytes ? { ok: true, id: first.id, bytes, mime: first.mime, pieces: pieces.length, made: false } : { ok: true, id, bytes: audio.bytes, mime: audio.mime, pieces: pieces.length, made: false };
  }
  await countUse(db, viewer, "voice_lines");
  return { ok: true, id, bytes: audio.bytes, mime: audio.mime, pieces: pieces.length, made: true };
}
