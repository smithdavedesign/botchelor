/**
 * Voice notes (Companions P3, docs/companions.md): 🔊 on any of a companion's replies records it in the character's own
 * voice, the one their reels and nights use (lib/voice.ts voiceFor: Kokoro, one fixed stock voice per character, never
 * a cloned one), and the reply plays as a voice note from then on.
 *
 *  - Only what the reply says is voiced (a scene's stage direction is its own field, a texted *action* comes out).
 *  - A line goes to the voice only if it's still under the PG line and the crisis list (it was checked when drawn).
 *  - Kept by a hash of the voice and the words (companion_voice), so the same line is never paid for twice: a replay,
 *    asking again, or the same words in another reply cost nothing.
 *  - Paid as an extra (lib/companion-extras.ts): the plan's 30 a month, then credits from a bought token. Taken before
 *    it's made and given back if it isn't. Never into a paused (crisis) thread.
 *  - Bounded: 60 an hour and 300 a day per person, and COMPANION_VOICE_ALL across everyone a day.
 *  - The file goes where the show keeps its media (lib/object-store.ts, area companion/; Postgres without a bucket), and
 *    is played back only to the thread's owner (or by a short-lived signed link handed to an agent over MCP).
 *  - A thread or an account deleted takes its voice notes with it (forgetUnusedVoices).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { track } from "./analytics";
import { loadCharacter } from "./character";
import { giveBackExtra, takeExtra, type ExtraRefusal, type ExtraTicket } from "./companion-extras";
import { COMPANION_AGENT_VOICE_LIMITS } from "./companion-shared";
import { crisisIntent } from "./crisis";
import type { Db } from "./db";
import { overLimit } from "./limits";
import { keepBytes, objectStore, readBytes } from "./object-store";
import { checkFamilyTalk } from "./safety";
import { sayable, sayLine, voiceFor, voiceKey, voiceReady } from "./voice";

/** One person's voice notes made an hour and a day (abuse only: each is paid for). */
export const COMPANION_VOICE_LIMITS = { perHour: 60, perDay: 300 };
/** Every voice note made a day across everyone: about $6 of Kokoro at the most. */
export const COMPANION_VOICE_ALL = { perHour: 1000, perDay: 3000 };

export type VoiceNoteFail = { ok: false; status: number; error: string; message: string; price?: ExtraRefusal["price"] };
export type VoiceNote = { ok: true; message_id: string; url: string; cached: boolean; paid_with: "admin" | "included" | "credit" | "kept" };

const fail = (status: number, error: string, message: string): VoiceNoteFail => ({ ok: false, status, error, message });

/** Where a reply's voice note plays from (the owner's session). */
export const voiceUrl = (threadId: string, messageId: string) => `/api/companion/${encodeURIComponent(threadId)}/voice/${encodeURIComponent(messageId)}`;

/**
 * Records one of the character's replies as a voice note (or finds the one it has). `buy`: a token may be spent on a
 * bundle when nothing else pays for it (the button showed the price first).
 */
export async function voiceNote(
  db: Db,
  userId: string,
  threadId: string,
  messageId: string,
  opts: { buy?: boolean; now?: Date; /** An agent over MCP: free, under its own limit (no tokens to spend). */ agent?: boolean } = {},
): Promise<VoiceNote | VoiceNoteFail> {
  const now = opts.now ?? new Date();
  const m = (
    await db.query<{ id: string; text: string; role: string; replaced_by: string | null; voice_key: string | null; character_id: string; paused_at: string | null; kept: string | null }>(
      `select m.id, m.text, m.role, m.replaced_by, m.voice_key, t.character_id, t.paused_at, v.key as kept
         from companion_messages m join companion_threads t on t.id = m.thread_id
         left join companion_voice v on v.key = m.voice_key
        where m.id = $1 and t.id = $2 and t.user_id = $3`,
      [messageId, threadId, userId],
    )
  ).rows[0];
  if (!m || m.role !== "character" || m.replaced_by) return fail(404, "not_found", "Pick one of their replies.");
  const url = voiceUrl(threadId, messageId);
  if (m.kept) return { ok: true, message_id: m.id, url, cached: true, paid_with: "kept" };
  if (m.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  const character = await loadCharacter(db, m.character_id);
  if (!character) return fail(404, "not_found", "Pick one of their replies.");
  const words = sayable(m.text);
  if (!words) return fail(422, "silent", "There's nothing to say out loud in that one.");
  if (!checkFamilyTalk(words).ok || crisisIntent(words)) return fail(422, "refused", "That one can't be voiced.");
  const voice = voiceFor(character);
  const key = voiceKey("companion", voice, words);
  // The same words in this voice were said before: this reply points at them, free.
  if ((await db.query(`select 1 from companion_voice where key = $1`, [key])).rows.length) {
    await db.query(`update companion_messages set voice_key = $2 where id = $1`, [m.id, key]);
    return { ok: true, message_id: m.id, url, cached: true, paid_with: "kept" };
  }
  if (!(await voiceReady(db))) return fail(503, "not_set_up", "Voice notes aren't available right now.");
  if (await overLimit(db, opts.agent ? "companion_voice_agent" : "companion_voice", userId, opts.agent ? COMPANION_AGENT_VOICE_LIMITS : COMPANION_VOICE_LIMITS, now)) {
    return fail(429, "rate_limited", "That's a lot of voice notes for now. Come back in a bit.");
  }
  if (await overLimit(db, "companion_voice_all", "all", COMPANION_VOICE_ALL, now)) {
    return fail(503, "busy", "Voice notes are busy right now. Try again later: nothing was taken.");
  }
  const ticket: ExtraTicket | ExtraRefusal = opts.agent ? { ok: true, kind: "voice", source: "admin", month: "", bought: false } : await takeExtra(db, userId, "voice", { buy: opts.buy, now });
  if (!ticket.ok) return { ok: false, status: ticket.status, error: ticket.error, message: ticket.message, price: ticket.price };
  const started = Date.now();
  try {
    const said = await sayLine(db, { words, stock: voice });
    const id = randomUUID();
    const kept = await keepBytes("companion", id, said.value.bytes, said.value.mime);
    const won = await db.query(
      `insert into companion_voice (key, voice, chars, mime, data, object_key, provider) values ($1, $2, $3, $4, $5, $6, $7) on conflict (key) do nothing returning key`,
      [key, voice, words.length, said.value.mime, kept.data, kept.object_key, said.provider],
    );
    // Two asks for the same line at once: the first one kept wins, and this copy goes (and so does what it took).
    if (!won.rows.length) {
      if (kept.object_key) await objectStore()?.remove(kept.object_key).catch(() => {});
      await giveBackExtra(db, userId, ticket);
    }
    await db.query(`update companion_messages set voice_key = $2 where id = $1`, [m.id, key]);
    track("companion_voice", { ms: Date.now() - started, chars: words.length, paid_with: ticket.source, ...(ticket.bought ? { bought: true } : {}), ...(said.fell_back ? { fell_back: true } : {}) });
    return { ok: true, message_id: m.id, url, cached: !won.rows.length, paid_with: won.rows.length ? ticket.source : "kept" };
  } catch (err) {
    await giveBackExtra(db, userId, ticket);
    console.error(`[companion] voice note failed: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
    return fail(502, "failed", "Couldn't record that one. Nothing was taken: try again in a moment.");
  }
}

/** A reply's voice note file, for its thread's owner (or a signed link): its type, and its bytes or a store key. */
export async function voiceFile(db: Db, threadId: string, messageId: string, userId: string | null): Promise<{ mime: string; data: Buffer | null; object_key: string | null } | null> {
  const { rows } = await db.query<{ mime: string; data: Buffer | null; object_key: string | null }>(
    `select v.mime, v.data, v.object_key from companion_messages m join companion_threads t on t.id = m.thread_id join companion_voice v on v.key = m.voice_key
      where m.id = $1 and t.id = $2 and ($3::text is null or t.user_id = $3)`,
    [messageId, threadId, userId],
  );
  return rows[0] ?? null;
}

/** The bytes of a voice file kept in Postgres, or from the store when it's there (the route redirects instead). */
export const voiceBytes = (f: { data: Buffer | null; object_key: string | null }) => readBytes(f);

/** Voice notes no reply points at any more (a thread or an account deleted): gone, file and all. Never throws. */
export async function forgetUnusedVoices(db: Db): Promise<number> {
  try {
    const { rows } = await db.query<{ object_key: string | null }>(
      `delete from companion_voice v where not exists (select 1 from companion_messages m where m.voice_key = v.key) returning v.object_key`,
    );
    const store = rows.some((r) => r.object_key) ? objectStore() : null;
    for (const r of rows) if (r.object_key && store) await store.remove(r.object_key).catch(() => {});
    return rows.length;
  } catch (err) {
    console.error(`[companion] forgetting voice notes failed: ${err instanceof Error ? err.message : "error"}`);
    return 0;
  }
}

/* ------------------------------------------- a link an agent can play ------------------------------------------- */

/** How long a voice note's signed link works (handed to an agent over MCP, which has no session). */
export const VOICE_LINK_MS = 60 * 60 * 1000;
const mac = (threadId: string, messageId: string, until: number, secret: string) =>
  createHmac("sha256", secret).update(`companion-voice:${threadId}:${messageId}:${until}`).digest("base64url");

export function signedVoiceUrl(threadId: string, messageId: string, baseUrl: string, now = Date.now(), env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const until = now + VOICE_LINK_MS;
  return `${baseUrl.replace(/\/$/, "")}${voiceUrl(threadId, messageId)}?until=${until}&sig=${mac(threadId, messageId, until, secret)}`;
}

export function voiceLinkValid(threadId: string, messageId: string, until: string | null, sig: string | null, now = Date.now(), env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.SESSION_SECRET;
  const t = Number(until);
  if (!secret || !sig || !Number.isFinite(t) || t < now || t > now + VOICE_LINK_MS) return false;
  const want = Buffer.from(mac(threadId, messageId, t, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
