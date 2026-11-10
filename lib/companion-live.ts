/**
 * Live calls with a companion (docs/companions.md, P6), the server's half. No new server: the browser streams the
 * person's voice straight to Deepgram's speech to text with a short-lived token this mints from the server's key, and
 * sends each finished phrase to POST /api/companion/:id/live (a turn), which streams the reply back as it's written
 * (lib/companion.ts liveReply) with each checked piece voiced by Deepgram's Aura here (speakAura), never in the browser.
 *
 *  - On only with DEEPGRAM_API_KEY in the server's env; COMPANION_LIVE=0 turns it off, COMPANION_LIVE=admins keeps it
 *    to admins. Accounts only (a guest's call is v1's). Off, a call is exactly v1 (turn-taking, the browser's speech).
 *  - The key never leaves the server. The browser gets a token that's good for 30 seconds, only to open its socket.
 *  - No audio is kept or logged: the person's goes from their browser to Deepgram; the companion's passes through
 *    here in memory. Both ask Deepgram to keep nothing for training (mip_opt_out).
 *  - Charged by the minute (the `minute` extra, lib/companion-extras.ts): each minute is taken as it starts, from the
 *    plan's included ones, then credits, then (only when the price was shown: `buy`) a token for a bundle. Admins free.
 */
import { randomUUID } from "node:crypto";
import type { Character } from "./character";
import { minutesDue } from "./companion-live-shared";
import { extraState, giveBackExtra, takeExtra, type ExtraRefusal, type ExtraTicket } from "./companion-extras";
import type { Db } from "./db";
import { LIVE_AUDIO_RATE } from "./companion-live-shared";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export const DEEPGRAM_API = "https://api.deepgram.com";
/** Deepgram's speech to text for a live call (DEEPGRAM_STT_MODEL overrides). */
export const DEFAULT_STT_MODEL = "nova-3";
/** How long a token is good for: only to open the socket, which then stays open. */
export const TOKEN_TTL_SECONDS = 30;
/** A live call ends after this many minutes (COMPANION_LIVE_MAX_MINUTES overrides). */
export const LIVE_MAX_MINUTES = 60;
/** Live calls started an hour and a day per person (each mints a token). */
export const LIVE_START_LIMITS = { perHour: 20, perDay: 60 };
/** A call that ends this soon with nothing said gives its first minute back. */
export const LIVE_REFUND_WITHIN_MS = 20_000;

let fetchForTests: Fetch | null = null;
/** Tests stand in for Deepgram (no key, no network). */
export function setDeepgramFetchForTests(f: Fetch | null): void {
  fetchForTests = f;
}
const doFetch = (): Fetch => fetchForTests ?? fetch;

const deepgramKey = (env: Env): string | null => env.DEEPGRAM_API_KEY?.trim() || null;
const apiBase = (env: Env): string => (env.DEEPGRAM_API_URL?.trim() || DEEPGRAM_API).replace(/\/+$/, "");

/** Whether live calls are on for this person: the key is there, the switch isn't off, and they're signed in. */
export function liveCallsOn(env: Env, who: { admin: boolean; guest: boolean }): boolean {
  if (!deepgramKey(env) || who.guest) return false;
  const mode = (env.COMPANION_LIVE ?? "").trim().toLowerCase();
  if (mode === "0" || mode === "off") return false;
  if (mode === "admins") return who.admin;
  return true;
}

export function liveMaxMinutes(env: Env = process.env): number {
  const n = Number.parseInt((env.COMPANION_LIVE_MAX_MINUTES ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : LIVE_MAX_MINUTES;
}

/**
 * Where the browser opens its socket to Deepgram, and how it listens: 16 kHz mono PCM, words as they come (interim),
 * the end of a phrase after 300 ms of quiet (endpointing) with UtteranceEnd a second later as the backstop.
 */
export function sttUrl(env: Env, lang: string | null | undefined): string {
  const base = apiBase(env).replace(/^http/, "ws");
  const english = !lang || /^en\b/i.test(lang);
  const q = new URLSearchParams({
    model: env.DEEPGRAM_STT_MODEL?.trim() || DEFAULT_STT_MODEL,
    language: english ? "en" : "multi",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    endpointing: "300",
    utterance_end_ms: "1000",
    vad_events: "true",
    smart_format: "true",
    mip_opt_out: "true",
  });
  return `${base}/v1/listen?${q}`;
}

export type LiveToken = { token: string; expires_in: number };

/** A token for the browser's socket, from the server's key (Deepgram's grant API). Null when Deepgram won't give one. */
export async function mintSttToken(env: Env = process.env): Promise<LiveToken | null> {
  const key = deepgramKey(env);
  if (!key) return null;
  try {
    const res = await doFetch()(`${apiBase(env)}/v1/auth/grant`, {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error(`[companion-live] token refused: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (typeof body?.access_token !== "string" || !body.access_token) return null;
    return { token: body.access_token, expires_in: typeof body.expires_in === "number" ? body.expires_in : TOKEN_TTL_SECONDS };
  } catch (err) {
    console.error(`[companion-live] token failed: ${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
}

/** Aura-2's English voices we use, by the character's pronouns (lib/voice.ts picks Kokoro's the same way). */
const AURA_VOICES = {
  she: ["aura-2-thalia-en", "aura-2-andromeda-en", "aura-2-helena-en", "aura-2-luna-en", "aura-2-asteria-en", "aura-2-athena-en", "aura-2-cora-en", "aura-2-aurora-en"],
  he: ["aura-2-apollo-en", "aura-2-arcas-en", "aura-2-orion-en", "aura-2-zeus-en", "aura-2-hermes-en", "aura-2-atlas-en", "aura-2-orpheus-en", "aura-2-jupiter-en"],
} as const;

/** A character's live voice: one Aura voice, picked once from their pronouns and id, the same every call. */
export function auraVoiceFor(c: Pick<Character, "id" | "pronouns">): string {
  const p = c.pronouns?.toLowerCase() ?? "";
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const list = p.startsWith("she") ? AURA_VOICES.she : p.startsWith("he") ? AURA_VOICES.he : h % 2 ? AURA_VOICES.she : AURA_VOICES.he;
  return list[(h >>> 1) % list.length];
}

/**
 * A checked piece of a reply in the character's voice: Aura's 16-bit mono PCM at LIVE_AUDIO_RATE, as it's made (Deepgram
 * streams the body). Throws when Deepgram refuses; `signal` stops it (a barge-in).
 */
export async function speakAura(text: string, voice: string, opts: { signal?: AbortSignal; env?: Env } = {}): Promise<ReadableStream<Uint8Array>> {
  const env = opts.env ?? process.env;
  const key = deepgramKey(env);
  if (!key) throw new Error("no Deepgram key");
  const q = new URLSearchParams({ model: voice, encoding: "linear16", sample_rate: String(LIVE_AUDIO_RATE), container: "none", mip_opt_out: "true" });
  const timeout = AbortSignal.timeout(15_000);
  const res = await doFetch()(`${apiBase(env)}/v1/speak?${q}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Aura returned HTTP ${res.status}`);
  }
  return res.body;
}

/* ------------------------------------------------------ calls ------------------------------------------------------ */

export type LiveCallRow = {
  id: string;
  user_id: string;
  thread_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  turns: number;
  first_ticket: ExtraTicket | null;
};

export type LiveRefusal = ExtraRefusal | { ok: false; status: number; error: "too_long" | "ended" | "not_found"; message: string };

export async function liveCall(db: Db, userId: string, callId: string, threadId: string): Promise<LiveCallRow | null> {
  const { rows } = await db.query<LiveCallRow>(
    `select id, user_id, thread_id, started_at, ended_at, minutes, turns, first_ticket from companion_live_calls where id = $1 and user_id = $2 and thread_id = $3`,
    [callId, userId, threadId],
  );
  return rows[0] ?? null;
}

/**
 * Starts a live call: its first minute is taken now (refused, nothing kept, when nothing pays for it and the price wasn't
 * shown). Any other call of theirs still open ends: one at a time.
 */
export async function startLiveCall(db: Db, userId: string, threadId: string, opts: { buy?: boolean; now?: Date; env?: Env } = {}): Promise<{ ok: true; call: LiveCallRow } | ExtraRefusal> {
  const now = opts.now ?? new Date();
  await db.query(`update companion_live_calls set ended_at = $2 where user_id = $1 and ended_at is null`, [userId, now.toISOString()]);
  const ticket = await takeExtra(db, userId, "minute", { buy: opts.buy, now, env: opts.env });
  if (!ticket.ok) return ticket;
  const id = randomUUID();
  await db.query(
    `insert into companion_live_calls (id, user_id, thread_id, started_at, last_at, minutes, first_ticket) values ($1, $2, $3, $4, $4, 1, $5)`,
    [id, userId, threadId, now.toISOString(), JSON.stringify(ticket)],
  );
  return { ok: true, call: { id, user_id: userId, thread_id: threadId, started_at: now.toISOString(), ended_at: null, minutes: 1, turns: 0, first_ticket: ticket } };
}

/**
 * Takes the minutes that have started since the last charge. Refused when the call has ended, has run past its
 * longest, or nothing pays for the next minute and the price wasn't shown (`buy`): the call then pauses and asks.
 */
export async function chargeLiveCall(db: Db, call: LiveCallRow, opts: { buy?: boolean; now?: Date; env?: Env } = {}): Promise<{ ok: true; minutes: number } | LiveRefusal> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  if (call.ended_at) return { ok: false, status: 409, error: "ended", message: "This call has ended." };
  const due = minutesDue(new Date(call.started_at).getTime(), now.getTime());
  const max = liveMaxMinutes(env);
  if (due > max) {
    await endLiveCall(db, call, now);
    return { ok: false, status: 409, error: "too_long", message: `That's ${max} minutes on the call, the longest one goes. Call again any time.` };
  }
  let minutes = call.minutes;
  while (minutes < due) {
    const t = await takeExtra(db, call.user_id, "minute", { buy: opts.buy, now, env });
    if (!t.ok) break;
    minutes++;
    // A bundle bought once covers what's due; the next one's price is shown again before it's bought.
    if (t.bought) opts = { ...opts, buy: false };
  }
  if (minutes !== call.minutes) {
    await db.query(`update companion_live_calls set minutes = $2, last_at = $3 where id = $1`, [call.id, minutes, now.toISOString()]);
    call.minutes = minutes;
  }
  if (minutes < due) {
    const s = await extraState(db, call.user_id, "minute", now, env);
    const price = { tokens: s.tokens, bundle: s.bundle };
    return {
      ok: false,
      status: 402,
      error: s.tokens_left >= s.tokens ? "price" : "needs_tokens",
      price,
      message:
        s.tokens_left >= s.tokens
          ? `Your call minutes are used up. ${s.tokens} token${s.tokens === 1 ? "" : "s"} buys ${s.bundle} more.`
          : `Your call minutes are used up, and you're out of tokens. Get more on the shop page, or call the free way, taking turns.`,
    };
  }
  return { ok: true, minutes };
}

export async function countLiveTurn(db: Db, callId: string, chars: number): Promise<void> {
  await db.query(`update companion_live_calls set turns = turns + 1, tts_chars = tts_chars + $2 where id = $1`, [callId, chars]);
}

/** Ends a call. One that ends this soon with nothing said gives its first minute back. */
export async function endLiveCall(db: Db, call: LiveCallRow, now: Date = new Date(), env: Env = process.env): Promise<{ minutes: number; refunded: boolean }> {
  if (call.ended_at) return { minutes: call.minutes, refunded: false };
  const done = await db.query(`update companion_live_calls set ended_at = $2 where id = $1 and ended_at is null returning id`, [call.id, now.toISOString()]);
  call.ended_at = now.toISOString();
  if (!done.rows.length) return { minutes: call.minutes, refunded: false };
  const quick = now.getTime() - new Date(call.started_at).getTime() < LIVE_REFUND_WITHIN_MS;
  if (quick && call.turns === 0 && call.minutes === 1 && call.first_ticket) {
    await giveBackExtra(db, call.user_id, call.first_ticket, env);
    await db.query(`update companion_live_calls set minutes = 0 where id = $1`, [call.id]);
    return { minutes: 0, refunded: true };
  }
  return { minutes: call.minutes, refunded: false };
}

/** Finished calls matter for the spend view a while: kept 90 days, then they go (the daily job). */
export async function pruneLiveCalls(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(`delete from companion_live_calls where started_at < $1`, [new Date(now.getTime() - 90 * 86_400_000).toISOString()]);
}
