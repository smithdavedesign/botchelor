/**
 * A taking-turns call's voice (docs/companions.md, Calls): the reply said in the character's own Aura-2 voice (the one
 * their live calls use, lib/companion-live.ts auraVoiceFor) instead of the device's speechSynthesis, which sounds
 * robotic on many phones. For everyone on a v1 call, guests included.
 *
 *  - Voiced on the server, only from the stored reply: one of the character's messages in this person's own thread,
 *    marked as said on the call (on_call), already checked when it was drawn (and checked again here).
 *  - Bounded: each reply is voiced at most twice (a replay), each person only so much, a guest's address as much as
 *    its replies (COMPANION_GUEST_IP_LIMITS), and everyone together CALL_VOICE_ALL a day. A guest's replies are few in
 *    all (takeReply), so their voice is too: 5 replies of about 200 characters is about 3¢ of Aura.
 *  - On with the Deepgram key, unless COMPANION_LIVE is 0 or off. Off, down or over a limit: the device's voice.
 *  - Nothing is kept and no audio is logged; the characters voiced are counted (companion_call, stage "voice").
 */
import { track } from "./analytics";
import { loadCharacter } from "./character";
import { COMPANION_GUEST_IP_LIMITS } from "./companion";
import { auraVoiceFor, speakAura } from "./companion-live";
import { spokenClause } from "./companion-live-shared";
import { crisisIntent } from "./crisis";
import type { Db } from "./db";
import { overLimit } from "./limits";
import { checkFamilyTalk } from "./safety";

type Env = Record<string, string | undefined>;

/** Each reply voiced at most this many times (once, and a replay). */
export const CALL_VOICE_PER_REPLY = { perHour: 2, perDay: 2 };
/** One person's (or one guest's) call voice an hour and a day: abuse only, a call says far less. */
export const CALL_VOICE_LIMITS = { perHour: 60, perDay: 200 };
/** Every call voice a day across everyone: at about 200 characters each, about $6 of Aura at the most. */
export const CALL_VOICE_ALL = { perHour: 300, perDay: 1000 };
/** The most of a reply that's voiced (a call's replies are short; a long one is cut, never paid for in full). */
export const CALL_VOICE_MAX_CHARS = 600;
/** How many of a turn's messages are voiced together (a reply can come as two or three). */
export const CALL_VOICE_MAX_MESSAGES = 4;

/** Whether a call's replies are said in the character's Aura voice: the Deepgram key, and the live switch not off. */
export function callVoiceOn(env: Env = process.env): boolean {
  if (!env.DEEPGRAM_API_KEY?.trim()) return false;
  const mode = (env.COMPANION_LIVE ?? "").trim().toLowerCase();
  return mode !== "0" && mode !== "off";
}

export type CallVoiceFail = { ok: false; status: number; error: string; message: string };
export type CallVoice = { ok: true; audio: ArrayBuffer; chars: number; voice: string };

const fail = (status: number, error: string, message: string): CallVoiceFail => ({ ok: false, status, error, message });

/**
 * One turn's reply (its messages, in order) in the character's Aura voice, as a WAV. Refused unless every message is
 * the character's, on the call, in this person's own thread; `guestKey` (a guest's address) holds a guest's address to its limit.
 */
export async function callVoice(
  db: Db,
  userId: string,
  threadId: string,
  messageIds: string[],
  opts: { guest?: boolean; guestKey?: string | null; now?: Date; env?: Env; signal?: AbortSignal } = {},
): Promise<CallVoice | CallVoiceFail> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  if (!callVoiceOn(env)) return fail(404, "voice_off", "Their voice isn't on right now.");
  const ids = [...new Set(messageIds)];
  if (!ids.length || ids.length > CALL_VOICE_MAX_MESSAGES) return fail(400, "invalid_request", "Pick one of their replies.");
  const { rows } = await db.query<{ id: string; text: string; role: string; on_call: boolean; replaced_by: string | null; character_id: string; paused_at: string | null; created_at: string }>(
    `select m.id, m.text, m.role, m.on_call, m.replaced_by, t.character_id, t.paused_at, m.created_at
       from companion_messages m join companion_threads t on t.id = m.thread_id
      where m.id = any($1::text[]) and t.id = $2 and t.user_id = $3
      order by m.created_at asc, m.id asc`,
    [ids, threadId, userId],
  );
  if (rows.length !== ids.length || rows.some((m) => m.role !== "character" || m.replaced_by)) return fail(404, "not_found", "Pick one of their replies.");
  if (rows.some((m) => !m.on_call)) return fail(409, "not_on_call", "Only a reply said on a call is voiced here.");
  if (rows[0].paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  const character = await loadCharacter(db, rows[0].character_id);
  if (!character) return fail(404, "not_found", "Pick one of their replies.");
  const words = rows
    .map((m, i) => spokenClause(m.text, character.name, i === 0))
    .filter(Boolean)
    .join(" ")
    .slice(0, CALL_VOICE_MAX_CHARS)
    .trim();
  if (!words) return fail(422, "silent", "There's nothing to say out loud in that one.");
  // Checked when it was drawn; checked again before it's voiced, as voice notes are.
  if (!checkFamilyTalk(words).ok || crisisIntent(words)) return fail(422, "refused", "That one can't be voiced.");
  for (const m of rows) {
    if (await overLimit(db, "companion_call_voice_reply", m.id, CALL_VOICE_PER_REPLY, now)) return fail(429, "said", "That one's been said already.");
  }
  if (await overLimit(db, "companion_call_voice", userId, CALL_VOICE_LIMITS, now)) return fail(429, "rate_limited", "That's a lot of talking for now.");
  if (opts.guestKey && (await overLimit(db, "companion_call_voice_guest", opts.guestKey, COMPANION_GUEST_IP_LIMITS, now))) {
    return fail(429, "rate_limited", "That's a lot of talking from here for now.");
  }
  if (await overLimit(db, "companion_call_voice_all", "all", CALL_VOICE_ALL, now)) return fail(503, "busy", "Their voice is busy right now.");
  const voice = auraVoiceFor(character);
  const started = Date.now();
  try {
    const body = await speakAura(words, voice, { env, signal: opts.signal, container: "wav" });
    const audio = await new Response(body).arrayBuffer();
    if (!audio.byteLength) throw new Error("no audio");
    track("companion_call", { stage: "voice", aura_chars: words.length, ms: Date.now() - started, guest: opts.guest || undefined });
    return { ok: true, audio, chars: words.length, voice };
  } catch (err) {
    // Never the words or the audio: what failed, and that the device's voice took over.
    console.error(`[companion-call-voice] Aura failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`);
    track("companion_call", { stage: "voice", failed: true, guest: opts.guest || undefined });
    return fail(503, "voice_down", "Their voice isn't working right now.");
  }
}
