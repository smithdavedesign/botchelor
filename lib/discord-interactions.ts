/**
 * The /date bot's side of Discord (docs/discord.md "The /date bot"): its settings, the check that a request really came
 * from Discord, and the one small client for the only calls it ever makes. What the bot does is lib/discord-bot.ts.
 *
 * Built and off: with DISCORD_APP_ID and DISCORD_PUBLIC_KEY unset (or CHANGE_ME), or on After Dark's own host, the
 * interactions route answers 404 and nothing here runs.
 *
 *  - Interactions only: Discord sends the bot a slash command or a button press, signed with the app's Ed25519 key, and
 *    the bot answers it. No gateway, no message-content intent, no reading of any channel: no server message is ever
 *    seen, so none is stored, logged or trained on.
 *  - The bot token is never read here. Answering an interaction (and editing or following up on it through its own
 *    interaction webhook, POST/PATCH /webhooks/<app id>/<interaction token>) needs no token; only registering the two
 *    commands does, and that is Dave's script (scripts/discord/register-commands.mjs), run by hand.
 *  - Never a ping: every body the bot sends, answers included, carries allowed_mentions: { parse: [] }, set last so
 *    nothing can override it, and the show's words in it are escaped (lib/discord.ts escapeDiscord).
 *  - An interaction token is a credential for fifteen minutes: it is never stored and never logged. A failed call logs
 *    one line, what it was and the HTTP status.
 */
import { afterDarkOnly } from "./after-dark-host";
import { DISCORD_LIMITS, fitEmbed, type DiscordEmbed } from "./discord";

type Env = Record<string, string | undefined>;

export const DISCORD_API = "https://discord.com/api/v10";
/** Interaction response types (Discord's numbers). */
export const RESPONSE = { pong: 1, message: 4, deferred: 5, update: 7 } as const;
/** Interaction types. */
export const INTERACTION = { ping: 1, command: 2, component: 3 } as const;
/** The message flag that shows a message only to the person who used the command or pressed the button. */
export const EPHEMERAL = 64;
/** How far a request's signed timestamp may be from our clock before it's refused (a replayed old request). */
export const SIGNATURE_MAX_AGE_SECONDS = 300;
/** How long Discord honours an interaction token (15 minutes): the bot stops using one well before. */
export const TOKEN_LIFETIME_MS = 15 * 60 * 1000;
export const DISCORD_CALL_TIMEOUT_MS = 5_000;

const SNOWFLAKE = /^\d{5,30}$/;
const HEX_KEY = /^[0-9a-f]{64}$/i;
const HEX_SIG = /^[0-9a-f]{128}$/i;
const TOKEN = /^[A-Za-z0-9._-]{1,500}$/;

export type BotConfig = { appId: string; publicKey: string };

/** The bot's settings, or null when it's off: either unset, a placeholder or malformed, or on After Dark's host. */
export function discordBotConfig(env: Env = process.env): BotConfig | null {
  if (afterDarkOnly(env)) return null;
  const appId = env.DISCORD_APP_ID?.trim() ?? "";
  const publicKey = env.DISCORD_PUBLIC_KEY?.trim() ?? "";
  if (!SNOWFLAKE.test(appId) || !HEX_KEY.test(publicKey)) return null;
  return { appId, publicKey: publicKey.toLowerCase() };
}

const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Whether a request is Discord's: X-Signature-Ed25519 over X-Signature-Timestamp + the raw body, with the app's public
 * key (Node's own Web Crypto, no package). False for anything missing, malformed, stale or wrong. Never throws.
 */
export async function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!signatureHex || !timestamp || !HEX_SIG.test(signatureHex) || !HEX_KEY.test(publicKeyHex) || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > SIGNATURE_MAX_AGE_SECONDS) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(publicKeyHex) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromHex(signatureHex) as BufferSource, new TextEncoder().encode(timestamp + body) as BufferSource);
  } catch {
    return false;
  }
}

/** A button (style 1 primary, 2 secondary, 5 a link); type 2. */
export type BotButton = { type: 2; style: 1 | 2 | 3 | 4 | 5; label: string; custom_id?: string; url?: string; disabled?: boolean };
export type BotRow = { type: 1; components: BotButton[] };
export type BotMessage = { content?: string; embeds?: DiscordEmbed[]; components?: BotRow[]; ephemeral?: boolean };

/**
 * What the bot sends, in every case: the message held to Discord's limits, its buttons, and never a ping. components is
 * always sent (an empty list takes old buttons off when a message is edited). allowed_mentions goes last.
 */
export function botBody(message: BotMessage): Record<string, unknown> {
  return {
    ...(message.content ? { content: message.content.slice(0, DISCORD_LIMITS.content) } : {}),
    embeds: (message.embeds ?? []).slice(0, DISCORD_LIMITS.embeds).map(fitEmbed),
    components: (message.components ?? []).slice(0, 5).map((row) => ({ type: 1, components: row.components.slice(0, 5).map((b) => ({ ...b, label: b.label.slice(0, 80) })) })),
    ...(message.ephemeral ? { flags: EPHEMERAL } : {}),
    allowed_mentions: { parse: [] },
  };
}

/** An interaction's answer: a message (type 4), or the message the pressed button is on, changed (type 7). */
export const replyWith = (message: BotMessage) => ({ type: RESPONSE.message, data: botBody(message) });
export const updateWith = (message: BotMessage) => ({ type: RESPONSE.update, data: botBody(message) });
/** "Thinking…", seen only by the person who asked: the bot edits it once the work is done. */
export const deferredEphemeral = () => ({ type: RESPONSE.deferred, data: { flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

export type CallResult = { ok: boolean; status: number | null; id: string | null };

/** The bot's only calls to Discord: on an interaction's own webhook. Mockable (fetchImpl); never throws, never logs a token. */
export type InteractionClient = {
  editOriginal(token: string, message: BotMessage): Promise<CallResult>;
  editMessage(token: string, messageId: string, message: BotMessage): Promise<CallResult>;
  followUp(token: string, message: BotMessage): Promise<CallResult>;
};

export function interactionClient(appId: string, fetchImpl: typeof fetch = fetch): InteractionClient {
  const call = async (what: string, method: "PATCH" | "POST", token: string, tail: string, message: BotMessage): Promise<CallResult> => {
    if (!SNOWFLAKE.test(appId) || !TOKEN.test(token)) return { ok: false, status: null, id: null };
    try {
      const res = await fetchImpl(`${DISCORD_API}/webhooks/${appId}/${token}${tail}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(botBody(message)),
        redirect: "manual",
        signal: AbortSignal.timeout(DISCORD_CALL_TIMEOUT_MS),
      });
      let id: string | null = null;
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
        id = typeof data?.id === "string" && SNOWFLAKE.test(data.id) ? data.id : null;
      } else {
        // What it was and the status: never the address, which holds the interaction token.
        console.error(`[discord-bot] ${what} failed: HTTP ${res.status}`);
      }
      return { ok: res.ok, status: res.status, id };
    } catch {
      console.error(`[discord-bot] ${what} failed: no answer`);
      return { ok: false, status: null, id: null };
    }
  };
  return {
    editOriginal: (token, message) => call("edit", "PATCH", token, "/messages/@original", message),
    editMessage: (token, messageId, message) =>
      SNOWFLAKE.test(messageId) ? call("edit", "PATCH", token, `/messages/${messageId}`, message) : Promise.resolve({ ok: false, status: null, id: null }),
    followUp: (token, message) => call("follow-up", "POST", token, "", message),
  };
}
