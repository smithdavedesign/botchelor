/**
 * Site engagement: every page view, click, scroll and conversion from the browser beacon (app/engagement.ts), stored in
 * `web_events` (lib/db.ts) so the admin page can read it (app/admin/analytics, the Engagement tab). David, 2026-10-31:
 * "track all engagements across the site, get us ready for first visitors and tracking".
 *
 * First-party and small: a random browser id, a per-visit session id, the path with its ids replaced, and props that
 * are enums, labels of our own buttons and counts. Never anything a person typed, never a full referrer URL (its host
 * becomes a source), never an IP. The browser sends nothing from automated browsers, the owner's own, previews, or when
 * analytics cookies are turned off (app/funnel.ts trackingAllowed); this file drops bots and malformed rows again.
 */
import { addDays, daysBetween } from "./chart";
import type { Db } from "./db";
import { loadOurIds } from "./our-traffic";

/** The most events one beacon may carry; the browser flushes every few seconds, so a real batch is far smaller. */
export const MAX_BATCH = 25;
/** Per browser per process: enough for a long, busy visit, not for a script. */
export const MAX_PER_WINDOW = 400;
const WINDOW_MS = 10 * 60_000;
const MAX_PROPS = 12;
const MAX_TEXT = 80;

const EVENT = /^[a-z][a-z0-9_]{1,39}$/;
const PROP_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const UTM = /^[A-Za-z0-9 _.+-]{1,60}$/;

/** One event as the browser sends it. */
export type BeaconEvent = { e: string; path: string; props?: Record<string, unknown>; t?: number };
/** Where this visit came from, the same on every event of the session. */
export type BeaconSource = { ref_host?: string | null; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null; ref?: string | null };
export type Beacon = { v: string; s: string; src?: BeaconSource; events: BeaconEvent[] };

export type CleanEvent = { event: string; path: string; props: Record<string, string | number | boolean>; at: Date };
export type CleanBeacon = {
  visitor: string;
  session: string;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  events: CleanEvent[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path as the dashboards count it: no query or hash, every id replaced by :id (so /characters/<uuid> is one page),
 * a ship-name page as /ship (its address holds the names someone typed), at most 120 characters.
 */
export function normalizePath(raw: string): string {
  let path = String(raw ?? "").split(/[?#]/)[0] || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/ship" || path.startsWith("/ship/")) return "/ship";
  const parts = path.split("/").map((seg) => {
    if (!seg) return seg;
    let s = seg;
    try {
      s = decodeURIComponent(seg);
    } catch {
      /* keep as sent */
    }
    // A uuid, a number, a long token, or a slug ending in an id (name-<6+ hex/digits>) is an id.
    if (UUID.test(s) || /^\d+$/.test(s) || /^[A-Za-z0-9_-]{20,}$/.test(s) || /-[0-9a-f]{6,}$/i.test(s)) return ":id";
    return s.toLowerCase().replace(/[^a-z0-9._~-]/g, "").slice(0, 40) || ":id";
  });
  const out = parts.join("/").replace(/\/+$/, "") || "/";
  return out.slice(0, 120);
}

/** The props kept: up to 12, lowercase keys, strings cut to 80 characters, finite numbers, booleans. */
export function cleanProps(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!PROP_KEY.test(k)) continue;
    if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === "string") {
      const s = v.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      if (s) out[k] = k === "to" ? normalizePath(s) : s;
    }
  }
  return out;
}

/** Referrer hosts we name; anything else is "other", and no referrer is "direct". */
const SOURCES: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)(yahoo|yandex|ecosia|brave)\./, "search_other"],
  [/(^|\.)reddit\.com$|^redd\.it$/, "reddit"],
  [/(^|\.)(x|twitter)\.com$|^t\.co$/, "x"],
  [/(^|\.)bsky\.(app|social)$/, "bluesky"],
  [/(^|\.)discord(app)?\.(com|gg)$/, "discord"],
  [/(^|\.)(facebook|fb)\.com$|^l\.facebook\.com$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tumblr\.com$/, "tumblr"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "chatgpt"],
  [/(^|\.)perplexity\.ai$/, "perplexity"],
  [/(^|\.)claude\.ai$/, "claude"],
  [/(^|\.)news\.ycombinator\.com$/, "hacker_news"],
  [/(^|\.)producthunt\.com$/, "product_hunt"],
  [/(^|\.)github\.com$/, "github"],
];

/**
 * Where a visit came from, in one word: utm_source when the link was tagged, a share link's ref, our name for the
 * referring site, "other" for a site we don't name, "direct" for none. Our own hosts are never a source.
 */
export function sourceOf(src: BeaconSource | undefined): string {
  const utm = clean(src?.utm_source, UTM)?.toLowerCase();
  if (utm) return utm.replace(/\s+/g, "_").slice(0, 40);
  if (src?.ref === "share") return "share_link";
  const host = String(src?.ref_host ?? "").toLowerCase().replace(/^www\./, "").slice(0, 100);
  if (!host || /(^|\.)botchelor\.com$/.test(host) || host === "localhost") return "direct";
  if (/(^|\.)google\./.test(host) && host.startsWith("gemini.")) return "gemini";
  for (const [re, name] of SOURCES) if (re.test(host)) return name;
  return "other";
}

const clean = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v.trim()) ? v.trim() : null);

/** A beacon as stored, or null when it isn't one (no ids, no events). Bad events are dropped one by one. */
export function cleanBeacon(raw: unknown, now = new Date()): CleanBeacon | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<Beacon>;
  const visitor = clean(b.v, ID);
  const session = clean(b.s, ID);
  if (!visitor || !session || !Array.isArray(b.events)) return null;
  const events: CleanEvent[] = [];
  for (const e of b.events.slice(0, MAX_BATCH)) {
    if (!e || typeof e !== "object" || typeof e.e !== "string" || !EVENT.test(e.e) || typeof e.path !== "string") continue;
    // The browser's own clock, held to the last hour (a tab asleep for longer counts as now).
    const t = typeof e.t === "number" && Number.isFinite(e.t) ? e.t : now.getTime();
    const at = new Date(Math.min(now.getTime(), Math.max(now.getTime() - 3_600_000, t)));
    events.push({ event: e.e, path: normalizePath(e.path), props: cleanProps(e.props), at });
  }
  if (!events.length) return null;
  return {
    visitor,
    session,
    source: sourceOf(b.src),
    utm_source: clean(b.src?.utm_source, UTM),
    utm_medium: clean(b.src?.utm_medium, UTM),
    utm_campaign: clean(b.src?.utm_campaign, UTM),
    utm_content: clean(b.src?.utm_content, UTM),
    events,
  };
}

/** phone, tablet or desktop, from the user agent. */
export function deviceOf(userAgent: string | null | undefined): "phone" | "tablet" | "desktop" {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "phone";
  return "desktop";
}

const windows = new Map<string, { n: number; until: number }>();

/** Whether this browser has sent more than its share in the last ten minutes; counts these events when it hasn't. */
export function overBudget(visitor: string, n: number, now = Date.now()): boolean {
  const w = windows.get(visitor);
  if (!w || w.until <= now) {
    if (windows.size > 50_000) windows.clear();
    windows.set(visitor, { n, until: now + WINDOW_MS });
    return n > MAX_PER_WINDOW;
  }
  w.n += n;
  return w.n > MAX_PER_WINDOW;
}

export function resetBudgetsForTests(): void {
  windows.clear();
}

/** Stores one cleaned beacon, all its events in one statement. */
export async function recordBeacon(
  db: Db,
  b: CleanBeacon,
  ctx: { userId: string | null; country: string | null; device: string; host: "show" | "after_dark" },
): Promise<number> {
  const cols = b.events;
  await db.query(
    `insert into web_events (at, visitor, session, user_id, event, path, props, source, utm_source, utm_medium, utm_campaign, utm_content, country, device, host)
     select e.at, $1, $2, $3, e.event, e.path, e.props, $4, $5, $6, $7, $8, $9, $10, $11
     from unnest($12::timestamptz[], $13::text[], $14::text[], $15::jsonb[]) as e(at, event, path, props)`,
    [
      b.visitor,
      b.session,
      ctx.userId,
      b.source,
      b.utm_source,
      b.utm_medium,
      b.utm_campaign,
      b.utm_content,
      ctx.country,
      ctx.device,
      ctx.host,
      cols.map((e) => e.at.toISOString()),
      cols.map((e) => e.event),
      cols.map((e) => e.path),
      cols.map((e) => JSON.stringify(e.props)),
    ],
  );
  return cols.length;
}

/* ------------------------------------------------------ the dashboard ------------------------------------------------------ */

/**
 * The funnel a first visitor walks, each step a share of the visitors who began a session in the range. A step counts
 * a visitor who did it any time in the range, in any order (most visits are one sitting).
 */
export const ENGAGEMENT_FUNNEL = [
  { key: "visited", label: "Visited", events: ["page_view"] },
  { key: "engaged", label: "Clicked something", events: ["link_click", "button_click", "outbound_click"] },
  { key: "create_opened", label: "Opened Make your character", events: ["create_opened"] },
  { key: "character_created", label: "Made a character", events: ["character_created"] },
  { key: "date_started", label: "Started a date", events: ["date_started"] },
  { key: "sign_up", label: "Made an account", events: ["sign_up"] },
  { key: "begin_checkout", label: "Clicked Buy", events: ["begin_checkout"] },
  { key: "purchase", label: "Bought", events: ["purchase"] },
] as const;

export type EngagementQuery = { from: string; to: string; includeOurs: boolean; host: "all" | "show" | "after_dark" };
export type CountRow = { key: string; count: number; visitors: number };
export type PageRow = { path: string; views: number; visitors: number; avg_seconds: number | null; avg_scroll: number | null };
export type SourceRow = { source: string; sessions: number; visitors: number; engaged: number; signups: number; created: number };
export type Engagement = {
  query: EngagementQuery;
  generated_at: string;
  totals: {
    visitors: number;
    new_visitors: number;
    sessions: number;
    page_views: number;
    events: number;
    pages_per_session: number | null;
    avg_session_seconds: number | null;
    bounce_rate: number | null;
  };
  previous: { visitors: number; sessions: number; page_views: number };
  days: string[];
  daily: { day: string; visitors: number; sessions: number; page_views: number }[];
  pages: PageRow[];
  landing: CountRow[];
  events: CountRow[];
  clicks: CountRow[];
  outbound: CountRow[];
  sources: SourceRow[];
  campaigns: CountRow[];
  devices: CountRow[];
  countries: CountRow[];
  funnel: { key: string; label: string; visitors: number; of_first: number | null }[];
};

/** Rows from our own browsers and accounts: admins, reviewers and every visitor id ever seen with one of their accounts. */
const OURS_FILTER = `not (coalesce(user_id, '') = any($3::text[]) or visitor in (select visitor from web_events where user_id = any($3::text[])))`;

export async function loadEngagement(db: Db, q: EngagementQuery, now = new Date()): Promise<Engagement> {
  const ours = q.includeOurs ? [] : await loadOurIds(db);
  const start = `${q.from}T00:00:00.000Z`;
  const end = `${addDays(q.to, 1)}T00:00:00.000Z`;
  const span = daysBetween(q.from, q.to).length;
  const prevStart = `${addDays(q.from, -span)}T00:00:00.000Z`;
  const hostFilter = q.host === "all" ? "" : ` and host = '${q.host === "show" ? "show" : "after_dark"}'`;
  // Every query reads the same rows: the range, our own traffic out unless asked for, the host if one was picked.
  const scope = `at >= $1 and at < $2 and ${OURS_FILTER}${hostFilter}`;
  const args = [start, end, ours];
  const rows = async <T,>(sql: string, extra: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, [...args, ...extra])).rows as T[];
  const n = (v: unknown) => Number(v ?? 0);

  const [totals] = await rows<{ visitors: number; sessions: number; page_views: number; events: number }>(
    `select count(distinct visitor)::int as visitors, count(distinct session)::int as sessions,
            count(*) filter (where event = 'page_view')::int as page_views, count(*)::int as events
     from web_events where ${scope}`,
  );
  const [prev] = (
    await db.query<{ visitors: number; sessions: number; page_views: number }>(
      `select count(distinct visitor)::int as visitors, count(distinct session)::int as sessions,
              count(*) filter (where event = 'page_view')::int as page_views
       from web_events where at >= $1 and at < $2 and ${OURS_FILTER}${hostFilter}`,
      [prevStart, start, ours],
    )
  ).rows;
  // A visitor is new when their first row ever falls in the range.
  const [fresh] = await rows<{ n: number }>(
    `select count(*)::int as n from (select visitor, min(at) as first from web_events where ${OURS_FILTER}${hostFilter} group by visitor) f
     where f.first >= $1 and f.first < $2`,
  );
  // Per session: pages seen, seconds engaged (the page_leave beats), whether anything was clicked.
  const [sess] = await rows<{ pages: number | null; seconds: number | null; bounced: number | null }>(
    `select avg(pages)::float as pages, avg(seconds)::float as seconds,
            avg(case when pages <= 1 and clicks = 0 then 1 else 0 end)::float as bounced
     from (
       select session,
              count(*) filter (where event = 'page_view') as pages,
              coalesce(sum((props->>'seconds')::float) filter (where event = 'page_leave'), 0) as seconds,
              count(*) filter (where event not in ('page_view', 'page_leave')) as clicks
       from web_events where ${scope} group by session
     ) s where pages > 0`,
  );
  const daily = await rows<{ day: string; visitors: number; sessions: number; page_views: number }>(
    `select to_char(at at time zone 'UTC', 'YYYY-MM-DD') as day, count(distinct visitor)::int as visitors,
            count(distinct session)::int as sessions, count(*) filter (where event = 'page_view')::int as page_views
     from web_events where ${scope} group by 1 order by 1`,
  );
  const pages = await rows<PageRow>(
    `select path, count(*) filter (where event = 'page_view')::int as views,
            count(distinct visitor) filter (where event = 'page_view')::int as visitors,
            -- A page sends its time in beats (each time the tab is hidden, then when it's left): add them up per view.
            round(coalesce(sum((props->>'seconds')::float) filter (where event = 'page_leave'), 0)
                  / nullif(count(*) filter (where event = 'page_view'), 0))::int as avg_seconds,
            round(avg((props->>'scroll')::float) filter (where event = 'page_leave'))::int as avg_scroll
     from web_events where ${scope} group by path having count(*) filter (where event = 'page_view') > 0
     order by views desc limit 50`,
  );
  const landing = await rows<CountRow>(
    `select path as key, count(*)::int as count, count(distinct visitor)::int as visitors from (
       select distinct on (session) session, visitor, path from web_events where ${scope} and event = 'page_view' order by session, at
     ) l group by path order by count desc limit 25`,
  );
  const events = await rows<CountRow>(
    `select event as key, count(*)::int as count, count(distinct visitor)::int as visitors
     from web_events where ${scope} and event not in ('page_view', 'page_leave') group by event order by count desc limit 60`,
  );
  // What was clicked: a named control's own name, else the link's page or the button's label, with where it sat.
  const clicks = await rows<CountRow>(
    `select concat_ws(' · ', coalesce(props->>'label', props->>'to', event), props->>'area') as key, count(*)::int as count,
            count(distinct visitor)::int as visitors
     from web_events where ${scope} and event in ('link_click', 'button_click') group by 1 order by count desc limit 60`,
  );
  const outbound = await rows<CountRow>(
    `select coalesce(props->>'host', '?') as key, count(*)::int as count, count(distinct visitor)::int as visitors
     from web_events where ${scope} and event = 'outbound_click' group by 1 order by count desc limit 25`,
  );
  const sources = await rows<SourceRow>(
    `select coalesce(source, 'direct') as source, count(distinct session)::int as sessions, count(distinct visitor)::int as visitors,
            count(distinct visitor) filter (where event in ('link_click', 'button_click', 'outbound_click'))::int as engaged,
            count(distinct visitor) filter (where event = 'sign_up')::int as signups,
            count(distinct visitor) filter (where event = 'character_created')::int as created
     from web_events where ${scope} group by 1 order by sessions desc limit 40`,
  );
  const campaigns = await rows<CountRow>(
    `select concat_ws(' / ', utm_source, utm_medium, utm_campaign, utm_content) as key, count(distinct session)::int as count, count(distinct visitor)::int as visitors
     from web_events where ${scope} and utm_source is not null group by 1 order by count desc limit 25`,
  );
  const devices = await rows<CountRow>(
    `select coalesce(device, '?') as key, count(distinct session)::int as count, count(distinct visitor)::int as visitors
     from web_events where ${scope} group by 1 order by count desc`,
  );
  const countries = await rows<CountRow>(
    `select coalesce(country, '?') as key, count(distinct session)::int as count, count(distinct visitor)::int as visitors
     from web_events where ${scope} group by 1 order by visitors desc limit 30`,
  );
  const stepCounts = await rows<Record<string, number>>(
    `select ${ENGAGEMENT_FUNNEL.map(
      (s) => `count(distinct visitor) filter (where event in (${s.events.map((e) => `'${e}'`).join(", ")}))::int as ${s.key}`,
    ).join(", ")}
     from web_events where ${scope}`,
  );
  const first = n(stepCounts[0]?.visited);
  const days = daysBetween(q.from, q.to);
  const byDay = new Map(daily.map((d) => [d.day, d]));
  return {
    query: q,
    generated_at: now.toISOString(),
    totals: {
      visitors: n(totals?.visitors),
      new_visitors: n(fresh?.n),
      sessions: n(totals?.sessions),
      page_views: n(totals?.page_views),
      events: n(totals?.events),
      pages_per_session: sess?.pages == null ? null : Math.round(sess.pages * 10) / 10,
      avg_session_seconds: sess?.seconds == null ? null : Math.round(sess.seconds),
      bounce_rate: sess?.bounced == null ? null : Math.round(sess.bounced * 1000) / 10,
    },
    previous: { visitors: n(prev?.visitors), sessions: n(prev?.sessions), page_views: n(prev?.page_views) },
    days,
    daily: days.map((day) => ({ day, visitors: n(byDay.get(day)?.visitors), sessions: n(byDay.get(day)?.sessions), page_views: n(byDay.get(day)?.page_views) })),
    pages: pages.map((p) => ({ ...p, avg_seconds: p.avg_seconds ?? null, avg_scroll: p.avg_scroll ?? null })),
    landing,
    events,
    clicks,
    outbound,
    sources,
    campaigns,
    devices,
    countries,
    funnel: ENGAGEMENT_FUNNEL.map((s) => {
      const visitors = n(stepCounts[0]?.[s.key]);
      return { key: s.key, label: s.label, visitors, of_first: first ? Math.round((visitors / first) * 1000) / 10 : null };
    }),
  };
}
