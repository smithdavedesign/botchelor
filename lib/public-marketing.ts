import type { Db } from "./db";

/**
 * Marketing, in the open (/marketing; docs/marketing.md; David 2026-11-15: "full transparency to a visitor or investor").
 * The marketing loop (idea-factory: bin/idea-market.js, lib/market-sync.js) sends what it knows after every run: the
 * channels, every post with its link and how it did there, and the money planned or spent on marketing. It lands here
 * as one row (`marketing_feed`), checked field by field, and the page reads that row alone. What the posts brought to
 * the site (visitors by source and tagged link) is in admin analytics, no longer on the public page (2026-11-22 audit).
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
}

export async function loadFeed(db: Db): Promise<MarketingFeed | null> {
  const { rows } = await db.query<{ data: MarketingFeed }>(`select data from marketing_feed where id = 'current'`);
  return rows[0]?.data ?? null;
}
