/**
 * The show's Discord (docs/discord.md; docs/audits/2026-11-07-audit-and-benchmark.md, item 13: "A Discord as the community
 * home, with a bot posting episode drops, the weekly vote and the board"). This file is the posting side: which webhook a
 * kind of post goes to, the post itself, and its once-only claim. What posts when is lib/discord-posts.ts.
 *
 * Built and off: with no webhook set nothing is sent and nothing is stored, and with no invite set the site shows none.
 *  - DISCORD_WEBHOOK_URL is the channel for everything; DISCORD_WEBHOOK_DROPS, DISCORD_WEBHOOK_VOTES and
 *    DISCORD_WEBHOOK_BOARD send their kind to a channel of its own. Only an https address on discord.com or
 *    discordapp.com under /api/webhooks/ is used: any other address (a typo) turns that kind off, so a post never goes
 *    somewhere unexpected. A placeholder (CHANGE_ME, as in .do/show.yaml) counts as not set.
 *  - Never a ping: every post sends allowed_mentions: { parse: [] }, so a character called "@everyone" pings nobody. Names
 *    and lines from the show are escaped too, so nothing in them becomes a link, a spoiler or formatting.
 *  - Once each: a post's key is claimed in discord_posts before it's sent (insert … on conflict … returning), so two runs
 *    of the hourly job never both send it. A failed send gives the claim back for a later pass, at most DISCORD_TRIES
 *    sends in all, so a dead webhook doesn't retry forever.
 *  - Never in the way: a 5-second timeout, and it never throws. A failure logs one line, the kind and the HTTP status,
 *    never the address: it holds the webhook's secret token.
 *  - Never After Dark: on After Dark's own host nothing posts and no invite shows.
 */
import { afterDarkOnly } from "./after-dark-host";
import type { Db } from "./db";
import { APP_NAME, APPLE_TOUCH_ICON } from "./pwa";
import { siteUrl } from "./site";

type Env = Record<string, string | undefined>;

/** The three kinds of post, each with a channel of its own or the default one. */
export const DISCORD_KINDS = ["drops", "votes", "board"] as const;
export type DiscordKind = (typeof DISCORD_KINDS)[number];

/** The variable that sends a kind to a channel of its own; without it the kind goes to DISCORD_WEBHOOK_URL. */
export const DISCORD_KIND_ENV: Record<DiscordKind, string> = {
  drops: "DISCORD_WEBHOOK_DROPS",
  votes: "DISCORD_WEBHOOK_VOTES",
  board: "DISCORD_WEBHOOK_BOARD",
};

/** How many times one post is sent before it's given up (one send a pass, so about three hours). */
export const DISCORD_TRIES = 3;
/** How long a send may take before it counts as failed. */
export const DISCORD_TIMEOUT_MS = 5_000;
/** A claim this old with nothing sent died with its pass (a deploy swapped the container): a later pass takes it over. */
export const DISCORD_CLAIM_STALE_MS = 10 * 60 * 1000;
/** The visit source on every link in a post (lib/engagement.ts sourceOf reads utm_source). */
export const DISCORD_SOURCE = "discord";
/** The show's pink (the share card's accent), down the side of every embed. */
export const DISCORD_COLOR = 0xd6336c;

const WEBHOOK_HOSTS: ReadonlySet<string> = new Set(["discord.com", "discordapp.com"]);
const WEBHOOK_PATH = /^\/api\/webhooks\/\d{1,30}\/[A-Za-z0-9_-]{1,200}\/?$/;
const INVITE = /^https:\/\/(?:discord\.gg\/|(?:www\.)?discord(?:app)?\.com\/invite\/)[A-Za-z0-9-]{2,40}\/?$/;

/** An address a post may go to: https on discord.com or discordapp.com, under /api/webhooks/<id>/<token>. */
export function isDiscordWebhookUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  return url.protocol === "https:" && WEBHOOK_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password && WEBHOOK_PATH.test(url.pathname);
}

/** The webhook a kind posts to: its own when set, else DISCORD_WEBHOOK_URL. Null when it's off, or on After Dark's host. */
export function discordWebhook(kind: DiscordKind, env: Env = process.env): string | null {
  if (afterDarkOnly(env)) return null;
  // A kind's own address, when it has one, is the only one it uses: a typo there turns it off rather than posting
  // elsewhere. A placeholder isn't an address (.do/show.yaml's CHANGE_ME): that kind goes to DISCORD_WEBHOOK_URL.
  const own = env[DISCORD_KIND_ENV[kind]]?.trim();
  const url = own?.includes("://") ? own : env.DISCORD_WEBHOOK_URL?.trim();
  return url && isDiscordWebhookUrl(url) ? url : null;
}

/** The kinds that have somewhere to post (none until a webhook is set). */
export const discordKindsOn = (env: Env = process.env): DiscordKind[] => DISCORD_KINDS.filter((k) => discordWebhook(k, env) !== null);

/** The invite the site shows (DISCORD_INVITE_URL: discord.gg/<code> or discord.com/invite/<code>), or null: none shows. */
export function discordInviteUrl(env: Env = process.env): string | null {
  if (afterDarkOnly(env)) return null;
  const raw = env.DISCORD_INVITE_URL?.trim();
  return raw && INVITE.test(raw) ? raw.replace(/\/$/, "") : null;
}

/**
 * A link to the site from a post: absolute, from the site's address, and tagged utm_source=discord, utm_medium=<kind>,
 * utm_campaign=<which post>, so the engagement log (lib/engagement.ts) counts the visits Discord brings. A #hash stays.
 */
export function discordLink(path: string, kind: DiscordKind, campaign: string, base: string = siteUrl()): string {
  const url = new URL(path, base);
  url.searchParams.set("utm_source", DISCORD_SOURCE);
  url.searchParams.set("utm_medium", kind);
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

/**
 * Text from the show (a name, a setting, a secret), safe in a post: every character Discord reads as formatting is
 * escaped, so "[free](link)" stays words, "@everyone" stays a name, "https://…" isn't a link and "||x||" isn't a spoiler,
 * and a line can't start a list. Only for titles, descriptions and fields: footers aren't formatted, so they carry only
 * the show's own words.
 */
export const escapeDiscord = (text: string): string =>
  text
    .replace(/[\\*_~`|>#[\]<:@]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([-+])/gm, "$1\\$2")
    .replace(/^(\s*\d+)\./gm, "$1\\.");

/** Cut to `max` characters, with an ellipsis when it was longer. */
export const clipText = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…` : t;
};

/** A Discord timestamp: each reader sees it in their own time zone. "F": Sunday, 15 November 2026 19:20; "R": in 3 hours. */
export const discordTime = (iso: string | Date, style: "F" | "R" | "t" = "F"): string => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;

export type DiscordEmbed = {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  image?: { url: string };
  thumbnail?: { url: string };
  timestamp?: string;
};
export type DiscordMessage = { content?: string; embeds?: DiscordEmbed[] };

/** Discord's own limits (a longer post is refused): kept to here, so a long name never costs a post. */
const LIMITS = { content: 2000, embeds: 10, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048 };

const fitEmbed = (e: DiscordEmbed): DiscordEmbed => ({
  ...e,
  color: e.color ?? DISCORD_COLOR,
  ...(e.title ? { title: clipText(e.title, LIMITS.title) } : {}),
  ...(e.description ? { description: e.description.slice(0, LIMITS.description) } : {}),
  ...(e.fields ? { fields: e.fields.slice(0, LIMITS.fields).map((f) => ({ ...f, name: clipText(f.name, LIMITS.fieldName), value: clipText(f.value, LIMITS.fieldValue) })) } : {}),
  ...(e.footer ? { footer: { text: clipText(e.footer.text, LIMITS.footer) } } : {}),
});

/** What a webhook is sent: the message under the show's name and icon, and never a ping. */
export function webhookBody(message: DiscordMessage, base: string = siteUrl()): Record<string, unknown> {
  return {
    username: APP_NAME,
    // Discord fetches the avatar itself, so only from a public address (not a local server's).
    ...(base.startsWith("https://") ? { avatar_url: `${base}${APPLE_TOUCH_ICON}` } : {}),
    ...(message.content ? { content: message.content.slice(0, LIMITS.content) } : {}),
    ...(message.embeds?.length ? { embeds: message.embeds.slice(0, LIMITS.embeds).map(fitEmbed) } : {}),
    allowed_mentions: { parse: [] },
  };
}

/** One send: the HTTP status, or null when nothing answered in time. Never throws, never follows a redirect. */
export async function sendToWebhook(url: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

export type DiscordPost = {
  /** One post's identity: the same post a later pass would make has the same key ("drops:2026-11-09T12"). */
  key: string;
  kind: DiscordKind;
  message: DiscordMessage;
  /** What it featured (the episode digest's dates and nights), so the next digest doesn't repeat them. */
  items?: string[];
};
export type DiscordOpts = { env?: Env; fetchImpl?: typeof fetch; now?: Date; base?: string };
/** posted; failed (its claim given back for a later pass, or given up); taken (sent already, sending, or out of tries); off. */
export type PostResult = "posted" | "failed" | "taken" | "off";

/**
 * Sends one post, once. Claims its key (a new row, or one a failed or dead pass gave back while it has tries left), sends
 * it, and marks it sent; a failed send gives the claim back, so the next pass tries again until DISCORD_TRIES.
 */
export async function postOnce(db: Db, post: DiscordPost, opts: DiscordOpts = {}): Promise<PostResult> {
  const env = opts.env ?? process.env;
  const url = discordWebhook(post.kind, env);
  if (!url) return "off";
  const now = opts.now ?? new Date();
  const claim = await db.query<{ tries: number }>(
    `insert into discord_posts (key, kind, claimed_at) values ($1, $2, $3)
     on conflict (key) do update set tries = discord_posts.tries + 1, claimed_at = excluded.claimed_at
      where discord_posts.posted_at is null and discord_posts.tries < $4
        and (discord_posts.claimed_at is null or discord_posts.claimed_at < $5)
     returning tries`,
    [post.key, post.kind, now.toISOString(), DISCORD_TRIES, new Date(now.getTime() - DISCORD_CLAIM_STALE_MS).toISOString()],
  );
  const tries = claim.rows[0]?.tries;
  if (tries === undefined) return "taken";
  const sent = await sendToWebhook(url, webhookBody(post.message, opts.base ?? siteUrl(env)), opts.fetchImpl ?? fetch);
  if (sent.ok) {
    await db.query(`update discord_posts set posted_at = $2, claimed_at = null, last_status = $3, items = $4::jsonb where key = $1`, [
      post.key,
      now.toISOString(),
      sent.status,
      JSON.stringify(post.items ?? []),
    ]);
    return "posted";
  }
  // The kind and the status, never the address (it holds the webhook's token).
  console.error(`[discord] ${post.kind} post failed: ${sent.status === null ? "no answer" : `HTTP ${sent.status}`}${tries >= DISCORD_TRIES ? ", giving up" : ""}`);
  await db.query(`update discord_posts set claimed_at = null, last_status = $2 where key = $1 and posted_at is null`, [post.key, sent.status]);
  return "failed";
}

/** The keys of these that may still be sent: not sent, not out of tries, and not being sent by another pass right now. */
export async function unsentKeys(db: Db, keys: readonly string[], now: Date = new Date()): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { rows } = await db.query<{ key: string; posted: boolean; tries: number; claimed_at: string | Date | null }>(
    `select key, posted_at is not null as posted, tries, claimed_at from discord_posts where key = any($1::text[])`,
    [[...keys]],
  );
  const done = new Set(
    rows
      .filter((r) => r.posted || r.tries >= DISCORD_TRIES || (r.claimed_at !== null && now.getTime() - new Date(r.claimed_at).getTime() < DISCORD_CLAIM_STALE_MS))
      .map((r) => r.key),
  );
  return new Set(keys.filter((k) => !done.has(k)));
}
