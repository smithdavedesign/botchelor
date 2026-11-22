/**
 * Launch guards: what stops one visitor, or a script, from spending the show's money.
 *
 *  - Starting dates is limited per visitor. Free dates are counted per anonymous cookie and a cookie costs
 *    nothing, so the visitor is keyed by an HMAC of the client IP (the IP itself is never stored) and the rows
 *    are pruned after two days. In-process calls (the MCP front door, tests) carry no IP and skip it: agent dates
 *    on our model have their own daily cap (lib/dating.ts).
 *  - Dates written by the paid default model (FRONTIER_DEFAULT, docs/frontier.md) are capped per UTC day. Past the
 *    cap a date still runs, on the free model, so a flood can spend at most a day's cap however it arrives.
 *  - One-sentence create drafts (POST /api/characters/draft) are limited per visitor, per address and across everyone:
 *    each is one call on the show's free model (EXPRESS_DRAFT_LIMITS and its siblings below).
 *  - Originality checks of a draft (POST /api/characters/originality) are limited per visitor and per session: each
 *    distinct bio can cost one embedding call (lib/originality-concept.ts, which also caps those calls per UTC day).
 */
import { createHmac } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { Db } from "./db";

export const DATE_START_LIMITS = { perHour: 10, perDay: 30 };
/** Draft originality checks: a person polishing a character runs a few dozen; a script running hundreds stops here. */
export const ORIGINALITY_CHECK_LIMITS = { perHour: 60, perDay: 300 };
/**
 * "Bring your character" reading free text (POST /api/characters/import): one call on the show's free model each, and
 * that quota is the live show's. Labelled fields and character cards are read in the browser and never count.
 */
export const IMPORT_READ_LIMITS = { perHour: 6, perDay: 20 };
/** And across everyone, as one-sentence create is (2026-11-22 audit): fresh cookies and addresses still stop here. */
export const IMPORT_READ_ALL_LIMITS = { perHour: 60, perDay: 300 };
/**
 * One-sentence create (POST /api/characters/draft, lib/express-create.ts): one call on the show's free model each, about
 * 330 tokens in and at most 700 out, so $0 on the free tier and under 0.2 cents at gemini-3.5-flash-lite's list price.
 * Capped three ways, guests included: per visitor (the session cookie), per address (several people can share one, so
 * it's looser) and across everyone (a flood of fresh cookies and addresses still stops at about 60 cents a day, and the
 * live show keeps its quota). Past any of them the builder opens its usual form.
 */
export const EXPRESS_DRAFT_LIMITS = { perHour: 5, perDay: 10 };
export const EXPRESS_DRAFT_IP_LIMITS = { perHour: 10, perDay: 30 };
export const EXPRESS_DRAFT_ALL_LIMITS = { perHour: 60, perDay: 300 };
/**
 * "Bring their history" (POST /api/characters/import/history, lib/import-history.ts): one call each on the show's PAID
 * model (a private chat log never goes to a free tier; lib/import-history-reader.ts), up to about 5,000 tokens in and 700
 * out: somewhere under a cent a reading. Capped the three ways one-sentence create is: per visitor, per address and
 * across everyone, and the across-everyone cap is what bounds the spend: 60 a day keeps a flood to roughly the 40 cents
 * a day the owner agreed to (2026-11-15); the key's own monthly cap at the provider is the hard limit. Past any of them
 * the character comes in without its history, as before.
 */
export const IMPORT_HISTORY_LIMITS = { perHour: 4, perDay: 10 };
export const IMPORT_HISTORY_IP_LIMITS = { perHour: 8, perDay: 24 };
export const IMPORT_HISTORY_ALL_LIMITS = { perHour: 15, perDay: 60 };
/**
 * Ties proposed to someone else's character (lib/social/declare.ts declareTie; the social network PRD section 6.2): 20
 * a day per person, each one a notification (and maybe an email) to another owner. A burst is a day's worth.
 */
export const SOCIAL_PROPOSE_LIMITS = { perHour: 20, perDay: 20 };
/**
 * Sign-ups (POST /api/auth/register) from one address: each runs scrypt on the server's one CPU. The busiest day so far
 * had 5 across the whole site; a person trying a few taken handles stays well under.
 */
export const REGISTER_LIMITS = { perHour: 10, perDay: 20 };
/** Paid-model dates a day unless FRONTIER_DAILY_DATE_CAP says otherwise: about $4–11 at Haiku's 4–11¢ a date. */
export const DEFAULT_PAID_DATES_PER_DAY = 100;
/** How long a rate-limit row is kept (the longest window plus a margin). */
const RATE_HIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Cloudflare's own addresses (https://www.cloudflare.com/ips/, 2026-11). DigitalOcean's edge is Cloudflare, and the
 * apex also passes through our own Cloudflare zone, so an address in here is a proxy (or a Worker), never a visitor.
 */
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];
const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [net, bits] = range.split("/") as [string, string];
  cloudflare.addSubnet(net, Number(bits), net.includes(":") ? "ipv6" : "ipv4");
}

/** Whether `ip` is one of Cloudflare's addresses. */
export function isCloudflareIp(ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && cloudflare.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/**
 * The address an edge header holds (a port or brackets dropped), or null. Of a list, the last entry: the one the
 * nearest proxy wrote, should it ever add to what the caller sent rather than replace it.
 */
function oneIp(value: string | null): string | null {
  const raw = value?.split(",").pop()?.trim() ?? "";
  const ip = /^\[([0-9a-f:.]+)\](?::\d+)?$/i.exec(raw)?.[1] ?? /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(raw)?.[1] ?? raw;
  return isIP(ip) ? ip : null;
}

/**
 * The address a request came from, as the platform saw it (2026-11-22 audit: this used to take the first
 * x-forwarded-for entry, which the client writes, so a made-up one opened a fresh bucket in every limit):
 *  1. `do-connecting-ip`: DigitalOcean's edge sets it to the caller's address on every host (the apex, ad, www and the
 *     ondigitalocean.app ones), whatever the caller sent.
 *  2. If that is a Cloudflare address (the apex's hop from our zone, a Worker), `cf-connecting-ip`, which Cloudflare
 *     sets on everything it proxies. With no `do-connecting-ip`, that too.
 *  3. With neither (a local server, the tests, harnesses that name a persona's address), the first x-forwarded-for
 *     entry, else x-real-ip. The platform always sets the first two, so a caller can't reach this step there.
 * Null when there is no address at all (the server's own in-process calls).
 */
export function clientIp(headers: Headers): string | null {
  const edge = oneIp(headers.get("do-connecting-ip"));
  if (edge && !isCloudflareIp(edge)) return edge;
  const cf = oneIp(headers.get("cf-connecting-ip"));
  if (cf) return cf;
  if (edge) return edge;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip")?.trim() || null;
}

/**
 * Which header clientIp read (`do-connecting-ip`, `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`), or null: for the
 * admin check of what the edge sends (app/api/admin/request-ip).
 */
export function clientIpSource(headers: Headers): string | null {
  const edge = oneIp(headers.get("do-connecting-ip"));
  if (edge && !isCloudflareIp(edge)) return "do-connecting-ip";
  if (oneIp(headers.get("cf-connecting-ip"))) return "cf-connecting-ip";
  if (edge) return "do-connecting-ip";
  if (headers.get("x-forwarded-for")?.split(",")[0]?.trim()) return "x-forwarded-for";
  return headers.get("x-real-ip")?.trim() ? "x-real-ip" : null;
}

/**
 * What a visitor is keyed by: an IPv6 address's /64 (one home, phone or server is handed a whole /64 and can use any
 * address in it), else the address as it is (an IPv4-mapped IPv6 one as plain IPv4).
 */
export function visitorAddress(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const halves = ip.toLowerCase().split("::");
  const groups = (s: string | undefined) => (s ? s.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : []);
  const left = groups(halves[0]);
  const right = groups(halves[1]);
  const all = halves.length > 1 ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${all.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** A stable, non-reversible key for the visitor behind a request (an HMAC of the address), or null without one. */
export function visitorKey(headers: Headers, secret = process.env.SESSION_SECRET || "botchelor-visitor"): string | null {
  const ip = clientIp(headers);
  return ip ? addressKey(ip, secret) : null;
}

/** visitorKey for an address given as text (an admin banning one: lib/bans.ts). */
export function addressKey(ip: string, secret = process.env.SESSION_SECRET || "botchelor-visitor"): string {
  return createHmac("sha256", secret).update(visitorAddress(ip)).digest("hex").slice(0, 32);
}

/**
 * Whether this visitor has used up `bucket` in the last hour or day. When it hasn't, this use is counted.
 * Count-then-insert isn't atomic, so two simultaneous requests can both pass at the edge: fine for an abuse limit.
 */
export async function overLimit(
  db: Db,
  bucket: string,
  key: string,
  limits: { perHour: number; perDay: number },
  now = new Date(),
): Promise<boolean> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.query<{ hour: number; day: number }>(
    `select count(*) filter (where at > $3)::int as hour, count(*)::int as day
       from rate_hits where bucket = $1 and key = $2 and at > $4`,
    [bucket, key, hourAgo, dayAgo],
  );
  const used = rows[0] ?? { hour: 0, day: 0 };
  if (used.hour >= limits.perHour || used.day >= limits.perDay) return true;
  await db.query("insert into rate_hits (bucket, key, at) values ($1, $2, $3)", [bucket, key, now.toISOString()]);
  return false;
}

/**
 * The show's ballots (tonight's situation, the dare, recoupling, the ceremony, next season's format, the weekly reveal;
 * casting has its own of the same size) from one address: enough to change your mind a few times, not enough to stuff a
 * ballot with fresh cookies (2026-11-22 audit; the address is the edge's, which a client can't write since then).
 */
export const VOTE_LIMITS = { perHour: 10, perDay: 30 };
export const TOO_MANY_VOTES = { error: "too_many_votes", message: "That's a lot of votes from one connection. Try again within the hour." } as const;

/** Whether this address is over VOTE_LIMITS on `bucket` (counting this vote when it isn't); never without an address. */
export async function voteLimited(db: Db, bucket: string, headers: Headers): Promise<boolean> {
  const visitor = visitorKey(headers);
  return visitor !== null && (await overLimit(db, bucket, visitor, VOTE_LIMITS));
}

/** Drops rate-limit rows older than the longest window (the daily job). */
export async function pruneRateHits(db: Db, now = new Date()): Promise<void> {
  await db.query("delete from rate_hits where at < $1", [new Date(now.getTime() - RATE_HIT_RETENTION_MS).toISOString()]);
}

/** Today's cap on paid-model dates: FRONTIER_DAILY_DATE_CAP (0 turns the paid default off), else the default. */
export function paidDatesPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FRONTIER_DAILY_DATE_CAP?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PAID_DATES_PER_DAY;
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Takes one of today's paid-model dates (UTC day). False once the cap is spent: run that date on the free model. */
export async function claimPaidDate(db: Db, cap = paidDatesPerDay(), now = new Date()): Promise<boolean> {
  if (cap <= 0) return false;
  const { rows } = await db.query<{ dates: number }>(
    `insert into paid_usage (day, dates) values ($1, 1)
       on conflict (day) do update set dates = paid_usage.dates + 1
     returning dates`,
    [utcDay(now)],
  );
  return (rows[0]?.dates ?? Number.POSITIVE_INFINITY) <= cap;
}

/** Paid-model dates claimed today (UTC), including any past the cap that fell back to free. */
export async function paidDatesToday(db: Db, now = new Date()): Promise<number> {
  const { rows } = await db.query<{ dates: number }>("select dates from paid_usage where day = $1", [utcDay(now)]);
  return rows[0]?.dates ?? 0;
}
