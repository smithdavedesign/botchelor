import type { Db } from "./db";
import { loadOurIds } from "./our-traffic";

/**
 * Marketing, in the open (/marketing; docs/marketing.md; David 2026-11-15: "full transparency to a visitor or investor").
 * The marketing loop (idea-factory: bin/idea-market.js, lib/market-sync.js) sends what it knows after every run: the
 * channels, every post with its link and how it did there, and the money planned or spent on marketing. It lands here
 * as one row (`marketing_feed`), checked field by field. What each post brought to the site is read live from
 * web_events: visitors whose first visit came through that channel's link, credited to the newest post on that
 * channel before they arrived, and what those visitors went on to do.
 */

export type ChannelStatus = "active" | "waiting" | "off" | "skipped";
export type MarketingChannel = {
  id: string;
  name: string;
  kind: string;
  status: ChannelStatus;
  /** Where on the web it lives (a subreddit, a profile, a directory page). */
  url: string | null;
  /** How often we may post there, in words ("once a week", "once ever"). */
  cadence: string | null;
  note: string | null;
};
export type PostStatus = "live" | "removed" | "scheduled";
export type PostType = "post" | "answer" | "video" | "listing" | "comment";
export type MarketingPost = {
  id: string;
  at: string;
  channel: string;
  channel_name: string;
  type: PostType;
  title: string;
  url: string | null;
  status: PostStatus;
  /** Upvotes or likes there, and replies, when the channel shows them and the loop read them. */
  score: number | null;
  comments: number | null;
  /** How visits from this post are recognised on the site: the source name (lib/engagement.ts sourceOf) and the
   *  link's utm_content, when the link was tagged. */
  source: string | null;
  content: string | null;
  note: string | null;
};
export type SpendStatus = "planned" | "paid";
export type MarketingSpend = { what: string; usd: number; status: SpendStatus; note: string | null };
export type MarketingFeed = { updated_at: string; channels: MarketingChannel[]; posts: MarketingPost[]; spend: MarketingSpend[] };

const LIMITS = { channels: 200, posts: 3000, spend: 100 } as const;
const CHANNEL_STATUS: readonly ChannelStatus[] = ["active", "waiting", "off", "skipped"];
const POST_STATUS: readonly PostStatus[] = ["live", "removed", "scheduled"];
const POST_TYPES: readonly PostType[] = ["post", "answer", "video", "listing", "comment"];

/** Text with any email address taken out: a public page never shows one, whoever sent it. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return t || null;
}
const slug = (v: unknown, max = 60): string | null => (typeof v === "string" && /^[\w.:-]{1,200}$/.test(v.trim()) ? v.trim().toLowerCase().slice(0, max) : null);
function link(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && !/[\w.+-]+@[\w-]+\./.test(u.href) ? u.href.slice(0, 500) : null;
  } catch {
    return null;
  }
}
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e9, Math.round(v))) : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
function when(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A feed as sent, checked and trimmed field by field, or null when it isn't one. Unknown fields are dropped. */
export function cleanFeed(raw: unknown, now = new Date()): MarketingFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.channels) || !Array.isArray(r.posts)) return null;
  const channels: MarketingChannel[] = [];
  const seen = new Set<string>();
  for (const c of r.channels.slice(0, LIMITS.channels) as Record<string, unknown>[]) {
    const id = slug(c?.id);
    const name = text(c?.name, 80);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    channels.push({
      id,
      name,
      kind: slug(c.kind, 30) ?? "other",
      status: oneOf(c.status, CHANNEL_STATUS, "off"),
      url: link(c.url),
      cadence: text(c.cadence, 60),
      note: text(c.note, 400),
    });
  }
  const posts: MarketingPost[] = [];
  const ids = new Set<string>();
  for (const p of r.posts.slice(0, LIMITS.posts) as Record<string, unknown>[]) {
    const id = slug(p?.id, 80);
    const at = when(p?.at);
    const channel = slug(p?.channel);
    if (!id || !at || !channel || ids.has(id)) continue;
    ids.add(id);
    posts.push({
      id,
      at,
      channel,
      channel_name: text(p.channel_name, 80) ?? channel,
      type: oneOf(p.type, POST_TYPES, "post"),
      title: text(p.title, 200) ?? "",
      url: link(p.url),
      status: oneOf(p.status, POST_STATUS, "live"),
      score: count(p.score),
      comments: count(p.comments),
      source: slug(p.source, 40),
      content: slug(p.content, 60),
      note: text(p.note, 300),
    });
  }
  posts.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const spend: MarketingSpend[] = [];
  for (const s of (Array.isArray(r.spend) ? r.spend : []).slice(0, LIMITS.spend) as Record<string, unknown>[]) {
    const what = text(s?.what, 120);
    const usd = typeof s?.usd === "number" && Number.isFinite(s.usd) && s.usd >= 0 ? Math.round(s.usd * 100) / 100 : null;
    if (!what || usd == null) continue;
    spend.push({ what, usd, status: oneOf(s.status, ["planned", "paid"] as const, "planned"), note: text(s.note, 300) });
  }
  return { updated_at: now.toISOString(), channels, posts, spend };
}

export async function saveFeed(db: Db, feed: MarketingFeed): Promise<void> {
  await db.query(
    `insert into marketing_feed (id, data, updated_at) values ('current', $1::jsonb, $2)
     on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`,
    [JSON.stringify(feed), feed.updated_at],
  );
  clearMarketingCache();
}

export async function loadFeed(db: Db): Promise<MarketingFeed | null> {
  const { rows } = await db.query<{ data: MarketingFeed }>(`select data from marketing_feed where id = 'current'`);
  return rows[0]?.data ?? null;
}

/** One visitor who arrived from somewhere: where, when they first came, and what they went on to do. */
export type Arrival = { source: string; content: string | null; first_at: string; created: boolean; started: boolean; watched: boolean; signed_up: boolean };
export type Leads = { visitors: number; created: number; started: number; watched: number; signed_up: number };
const NO_LEADS: Leads = { visitors: 0, created: 0, started: 0, watched: 0, signed_up: 0 };

/** How long after a post a first visit still counts as its doing. */
export const CREDIT_DAYS = 30;

/**
 * Each arrival credited to one post (pure): among the posts with the arrival's source (and its utm_content, when the
 * post's link carried one), the newest made before the visitor first came, at most CREDIT_DAYS earlier. An arrival
 * no post explains still counts for its source in `bySource`.
 */
export function creditPosts(posts: MarketingPost[], arrivals: Arrival[]): { byPost: Map<string, Leads>; bySource: Map<string, Leads> } {
  const byPost = new Map<string, Leads>();
  const bySource = new Map<string, Leads>();
  const add = (m: Map<string, Leads>, k: string, a: Arrival) => {
    const l = { ...(m.get(k) ?? NO_LEADS) };
    l.visitors++;
    if (a.created) l.created++;
    if (a.started) l.started++;
    if (a.watched) l.watched++;
    if (a.signed_up) l.signed_up++;
    m.set(k, l);
  };
  const oldest = (CREDIT_DAYS * 86_400_000) as number;
  const live = posts.filter((p) => p.source && p.status !== "scheduled");
  for (const a of arrivals) {
    add(bySource, a.source, a);
    const t = Date.parse(a.first_at);
    let best: MarketingPost | null = null;
    for (const p of live) {
      if (p.source !== a.source) continue;
      if (p.content && p.content !== a.content) continue;
      const pt = Date.parse(p.at);
      if (pt > t || t - pt > oldest) continue;
      if (!best || pt > Date.parse(best.at)) best = p;
    }
    if (best) add(byPost, best.id, a);
  }
  return { byPost, bySource };
}

/** Every outside visitor's arrival (their first visit's source), with what they did after. Our own browsers left out. */
export async function loadArrivals(db: Db): Promise<Arrival[]> {
  const ours = await loadOurIds(db);
  const { rows } = await db.query<{ source: string; content: string | null; first_at: Date | string; created: boolean; started: boolean; watched: boolean; signed_up: boolean }>(
    `with mine as (
       select * from web_events
       where not (coalesce(user_id, '') = any($1::text[]) or visitor in (select visitor from web_events where user_id = any($1::text[])))
     ), firsts as (
       select distinct on (visitor) visitor, coalesce(source, 'direct') as source, lower(utm_content) as content, at as first_at
       from mine order by visitor, at
     )
     select f.source, f.content, f.first_at,
            bool_or(m.event = 'character_created') as created, bool_or(m.event = 'date_started') as started,
            bool_or(m.event = 'date_watched') as watched, bool_or(m.event = 'sign_up') as signed_up
     from firsts f join mine m on m.visitor = f.visitor
     group by f.visitor, f.source, f.content, f.first_at`,
    [ours],
  );
  return rows.map((r) => ({
    source: r.source,
    content: r.content,
    first_at: new Date(r.first_at).toISOString(),
    created: !!r.created,
    started: !!r.started,
    watched: !!r.watched,
    signed_up: !!r.signed_up,
  }));
}

export type PublicMarketing = {
  feed: MarketingFeed | null;
  byPost: Record<string, Leads>;
  bySource: { source: string; leads: Leads }[];
  totals: Leads & { posts: number; channels: number; spent: number; planned: number };
  since: string | null;
};

/** The page reads every visit's first row, so its numbers are kept for ten minutes (a new feed clears them). */
const CACHE_MS = 10 * 60_000;
let cached: { at: number; value: PublicMarketing } | null = null;
export function clearMarketingCache(): void {
  cached = null;
}

/** Everything the page shows. Never throws for a missing feed: the page says the log hasn't arrived yet. */
export async function publicMarketing(db: Db, now = Date.now()): Promise<PublicMarketing> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await buildPublicMarketing(db);
  cached = { at: now, value };
  return value;
}

async function buildPublicMarketing(db: Db): Promise<PublicMarketing> {
  const [feed, arrivals] = await Promise.all([loadFeed(db), loadArrivals(db)]);
  const posts = feed?.posts ?? [];
  const { byPost, bySource } = creditPosts(posts, arrivals);
  const credited = [...byPost.values()].reduce<Leads>(
    (s, l) => ({ visitors: s.visitors + l.visitors, created: s.created + l.created, started: s.started + l.started, watched: s.watched + l.watched, signed_up: s.signed_up + l.signed_up }),
    { ...NO_LEADS },
  );
  const spend = feed?.spend ?? [];
  return {
    feed,
    byPost: Object.fromEntries(byPost),
    bySource: [...bySource.entries()].map(([source, leads]) => ({ source, leads })).sort((a, b) => b.leads.visitors - a.leads.visitors),
    totals: {
      ...credited,
      posts: posts.filter((p) => p.status !== "scheduled").length,
      channels: (feed?.channels ?? []).filter((c) => c.status === "active").length,
      spent: spend.filter((s) => s.status === "paid").reduce((s, x) => s + x.usd, 0),
      planned: spend.filter((s) => s.status === "planned").reduce((s, x) => s + x.usd, 0),
    },
    since: arrivals.reduce<string | null>((m, a) => (!m || a.first_at < m ? a.first_at : m), null),
  };
}
