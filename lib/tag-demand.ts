/**
 * Our own demand for each tag (David's goal item 5, 2026-11-17; docs/tags.md "Demand"): what people on Botchelor pick,
 * against what we offer, so the pickers stop leaning on someone else's census once we have numbers of our own.
 *
 * For a tag, demand = its share of the picks ÷ its share of what's on offer: 1.00× is picked exactly as often as it's
 * offered, 2.00× twice as often. Our numbers are small, so each is shrunk toward the census's (the prior): with n picks of
 * the tag, blended = (n × ours + SHRINK × census) ÷ (n + SHRINK), and ours is capped at RAW_CAP first. One pick moves a tag
 * by a few hundredths; a hundred picks mostly speak for themselves.
 *
 * Whose picks: real people's and agents' only. Admins, reviewers, our own MCP clients and test characters
 * (lib/our-traffic.ts loadOurIds) are left out, or our live checks would set the order.
 *
 * Two measures here, both PG (After Dark's is lib/adult/tag-demand.ts, which the show never imports):
 *  - roleplays: show dates (episodes.setup.roleplay) and companion scenes (companion_threads.roleplay) by the house
 *    roleplay's tags (lib/roleplays.ts). A date or a thread counts once, with the roleplay it has now; one written for
 *    the date ("custom") counts toward nothing.
 *  - character types: companion conversations (companion_threads) by the type tags of the character talked to, against
 *    the characters anyone may talk to (lib/character-tags.ts).
 *
 * And two facets that aren't tags (PRD styles-and-storylines phase 7), on /admin/tags with where their picks came from:
 *  - art style (artStyleDemand): characters made in each style, the style filter, conversations by style;
 *  - lineup (lineupDemand): the pronouns filter and conversations, by the pronouns of who people look for.
 */
import { ART_STYLE_LABEL, artStyleSql } from "./art-style";
import { showStyleSql } from "./portrait-sql";
import type { Db } from "./db";
import { loadOurIds } from "./our-traffic";
import { DATE_ROLEPLAYS } from "./roleplays";
import { TAGS, type TagDef } from "./tags";

/** How much the census weighs, in picks: our number takes over as a tag's picks pass this. */
export const SHRINK = 30;
/** Our raw index is capped here before blending: two picks of a rare tag aren't a 20× signal. */
export const RAW_CAP = 3;
/** How far back a pick counts. */
export const DEMAND_DAYS = 90;
/** Under this many picks a tag's own number is mostly noise: the admin tables grey the row (the blend leans on the census). */
export const FEW_PICKS = 10;

export type DemandRow = {
  tag: string;
  label: string;
  icon: string;
  facet: string;
  /** Picks of something with this tag (by real people and agents). */
  picks: number;
  /** How many of what's on offer carry it. */
  supply: number;
  /** Ours, unblended: share of picks ÷ share of supply. Null with no picks at all, or nothing on offer. */
  raw: number | null;
  /** The census's, on this side (1 where it had nothing). */
  census: number;
  /** What the pickers order by. */
  blended: number;
};

export type Demand = { side: "sfw" | "nsfw"; total: number; rows: DemandRow[] };

/**
 * Demand per tag, from picks per item (an item is a roleplay id or a character id) and what's on offer. Pure: the
 * sources above and the After Dark ones feed it, and tests call it directly.
 */
export function demandOf(
  picks: ReadonlyMap<string, number>,
  offer: readonly { id: string; tags?: readonly string[] }[],
  tags: readonly Pick<TagDef, "id" | "label" | "icon" | "facet" | "census">[],
  side: "sfw" | "nsfw",
): Demand {
  const total = offer.reduce((n, o) => n + (picks.get(o.id) ?? 0), 0);
  const rows = tags.map((t) => {
    const having = offer.filter((o) => o.tags?.includes(t.id));
    const n = having.reduce((sum, o) => sum + (picks.get(o.id) ?? 0), 0);
    const supplyShare = offer.length ? having.length / offer.length : 0;
    const census = t.census[side] ?? t.census[side === "sfw" ? "nsfw" : "sfw"] ?? 1;
    return { tag: t.id, label: t.label, icon: t.icon, facet: t.facet, picks: n, supply: having.length, ...blend(n, total, supplyShare, census) };
  });
  return { side, total, rows };
}

/** Ours (share of picks ÷ share of supply) and the blend toward the census: the one formula every measure here uses. */
function blend(n: number, total: number, supplyShare: number, census: number): { raw: number | null; census: number; blended: number } {
  const raw = total > 0 && supplyShare > 0 ? n / total / supplyShare : null;
  const blended = raw === null ? census : (n * Math.min(raw, RAW_CAP) + SHRINK * census) / (n + SHRINK);
  return { raw, census, blended: Math.round(blended * 1000) / 1000 };
}

/** One value of a facet that isn't a tag (an art style, a lineup), with the census's number for it (1 where it had none). */
export type FacetValue = { id: string; label: string; icon: string; census: number };

/**
 * Demand per value of a facet, from pick counts and supply counts per value (PRD styles-and-storylines phase 7): the
 * same index and blend as the tags. Pure.
 */
export function facetDemand(facet: string, picks: ReadonlyMap<string, number>, supply: ReadonlyMap<string, number>, values: readonly FacetValue[]): Demand {
  const total = values.reduce((n, v) => n + (picks.get(v.id) ?? 0), 0);
  const offered = values.reduce((n, v) => n + (supply.get(v.id) ?? 0), 0);
  const rows = values.map((v) => {
    const n = picks.get(v.id) ?? 0;
    const s = supply.get(v.id) ?? 0;
    return { tag: v.id, label: v.label, icon: v.icon, facet, picks: n, supply: s, ...blend(n, total, offered ? s / offered : 0, v.census) };
  });
  return { side: "sfw", total, rows };
}

/**
 * How they're drawn (lib/art-style.ts), with the census's rank by art style across platforms as the prior: anime
 * 1.08×, 2.5D 1.05×, photoreal 0.92× (docs/PRDs/styles-and-storylines.md).
 */
export const ART_STYLE_VALUES: readonly FacetValue[] = [
  { id: "realistic", label: ART_STYLE_LABEL.realistic, icon: "📷", census: 0.92 },
  { id: "anime", label: ART_STYLE_LABEL.anime, icon: "🎨", census: 1.08 },
  { id: "semi_real", label: ART_STYLE_LABEL.semi_real, icon: "✏️", census: 1.05 },
  // The newer drawn styles (2026-11-18): no census rank of their own yet, so an even prior.
  { id: "oil_painting", label: ART_STYLE_LABEL.oil_painting, icon: "🖼️", census: 1 },
  { id: "render_3d", label: ART_STYLE_LABEL.render_3d, icon: "🧊", census: 1 },
  { id: "comic", label: ART_STYLE_LABEL.comic, icon: "💥", census: 1 },
  { id: "ink", label: ART_STYLE_LABEL.ink, icon: "🖋️", census: 1 },
  { id: "pixel", label: ART_STYLE_LABEL.pixel, icon: "👾", census: 1 },
];

/** Who's in the lineup, by pronouns: the census has no number of its own for these, so the prior is even. */
export const LINEUP_VALUES: readonly FacetValue[] = [
  { id: "she/her", label: "She/her", icon: "♀️", census: 1 },
  { id: "he/him", label: "He/him", icon: "♂️", census: 1 },
  { id: "they/them", label: "They/them", icon: "⚧️", census: 1 },
];

/** Where a facet's picks came from, per value: what /admin/tags shows beside the index. */
export type FacetSources = Record<string, Record<string, number>>;

async function countBy(db: Db, sql: string, params: unknown[]): Promise<Map<string, number>> {
  const { rows } = await db.query<{ v: string | null; n: number }>(sql, params);
  const out = new Map<string, number>();
  for (const r of rows) if (r.v) out.set(r.v, (out.get(r.v) ?? 0) + Number(r.n));
  return out;
}

const sumOf = (...maps: ReadonlyMap<string, number>[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const m of maps) for (const [k, n] of m) out.set(k, (out.get(k) ?? 0) + n);
  return out;
};

const sourcesOf = (values: readonly FacetValue[], by: Record<string, ReadonlyMap<string, number>>): FacetSources =>
  Object.fromEntries(values.map((v) => [v.id, Object.fromEntries(Object.entries(by).map(([k, m]) => [k, m.get(v.id) ?? 0]))]));

/** The characters anyone may find (not private), counted by an expression over `c`: a facet's supply. */
const supplyBy = (db: Db, expr: string) => countBy(db, `select ${expr} as v, count(*)::int as n from characters c where c.visibility <> 'private' group by 1`, []);

/**
 * Art-style demand (PRD styles-and-storylines phase 7), the last DEMAND_DAYS, real people and agents only: characters
 * made in each style on /create, the style filter on /companion and /characters (the style_filter event), and
 * companion conversations started with a character drawn that way. Against the characters anyone may find, by style.
 */
export async function artStyleDemand(db: Db): Promise<Demand & { sources: FacetSources }> {
  const us = await loadOurIds(db);
  const [made, filtered, chats, supply] = await Promise.all([
    countBy(
      db,
      `select ${artStyleSql("c")} as v, count(*)::int as n from characters c
        where c.owner_id is not null and not (c.owner_id = any($1::text[])) and not c.is_house
          and c.created_at > now() - make_interval(days => $2::int)
        group by 1`,
      [us, DEMAND_DAYS],
    ),
    countBy(
      db,
      `select w.props->>'style' as v, count(*)::int as n from web_events w
        where w.event = 'style_filter' and (w.user_id is null or not (w.user_id = any($1::text[])))
          and w.at > now() - make_interval(days => $2::int)
        group by 1`,
      [us, DEMAND_DAYS],
    ),
    countBy(
      db,
      `select ${showStyleSql("c")} as v, count(*)::int as n from companion_threads t join characters c on c.id = t.character_id
        where not (t.user_id = any($1::text[])) and t.created_at > now() - make_interval(days => $2::int)
        group by 1`,
      [us, DEMAND_DAYS],
    ),
    supplyBy(db, showStyleSql("c")),
  ]);
  const d = facetDemand("art_style", sumOf(made, filtered, chats), supply, ART_STYLE_VALUES);
  return { ...d, sources: sourcesOf(ART_STYLE_VALUES, { made, filtered, chats }) };
}

/**
 * Lineup demand: who people look for and talk to, by pronouns. The pronouns filter on /companion (the
 * pronouns_filter event) and companion conversations started, against the characters anyone may find.
 */
export async function lineupDemand(db: Db): Promise<Demand & { sources: FacetSources }> {
  const us = await loadOurIds(db);
  const [filtered, chats, supply] = await Promise.all([
    countBy(
      db,
      `select w.props->>'pronouns' as v, count(*)::int as n from web_events w
        where w.event = 'pronouns_filter' and (w.user_id is null or not (w.user_id = any($1::text[])))
          and w.at > now() - make_interval(days => $2::int)
        group by 1`,
      [us, DEMAND_DAYS],
    ),
    countBy(
      db,
      `select c.pronouns as v, count(*)::int as n from companion_threads t join characters c on c.id = t.character_id
        where not (t.user_id = any($1::text[])) and t.created_at > now() - make_interval(days => $2::int)
        group by 1`,
      [us, DEMAND_DAYS],
    ),
    supplyBy(db, "c.pronouns"),
  ]);
  const d = facetDemand("lineup", sumOf(filtered, chats), supply, LINEUP_VALUES);
  return { ...d, sources: sourcesOf(LINEUP_VALUES, { filtered, chats }) };
}

/** A demand as the pickers take it: tag → blended. */
export const demandMap = (d: Demand): Record<string, number> => Object.fromEntries(d.rows.map((r) => [r.tag, r.blended]));

async function counted(db: Db, sql: string, ours: readonly string[]): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: string | null; n: number }>(sql, [ours, DEMAND_DAYS]);
  const out = new Map<string, number>();
  for (const r of rows) if (r.id) out.set(r.id, (out.get(r.id) ?? 0) + Number(r.n));
  return out;
}

/** Roleplay picks on the show and in companion scenes, by real people and agents, the last DEMAND_DAYS. */
export async function showRoleplayPicks(db: Db, ours?: readonly string[]): Promise<Map<string, number>> {
  const us = ours ?? (await loadOurIds(db));
  const [dates, scenes] = await Promise.all([
    counted(
      db,
      `select e.setup->'roleplay'->>'id' as id, count(*)::int as n from episodes e
        where e.setup->'roleplay'->>'id' is not null and not (e.creator_id = any($1::text[]))
          and e.created_at > now() - make_interval(days => $2::int)
        group by 1`,
      us,
    ),
    counted(
      db,
      `select t.roleplay->>'id' as id, count(*)::int as n from companion_threads t
        where t.roleplay->>'id' is not null and not (t.user_id = any($1::text[]))
          and coalesce(t.last_at, t.created_at) > now() - make_interval(days => $2::int)
        group by 1`,
      us,
    ),
  ]);
  for (const [id, n] of scenes) dates.set(id, (dates.get(id) ?? 0) + n);
  return dates;
}

/** The show's roleplay demand: what the show's picker orders its shelves by. */
export async function showRoleplayDemand(db: Db): Promise<Demand> {
  const shelfTags = TAGS.filter((t) => t.facet === "setup" || t.facet === "theme");
  return demandOf(await showRoleplayPicks(db), DATE_ROLEPLAYS, shelfTags, "sfw");
}

/** Companion conversations by the type tags of who they're with, against everyone anyone may talk to. */
export async function characterTypeDemand(db: Db): Promise<Demand> {
  const us = await loadOurIds(db);
  const [picks, offer] = await Promise.all([
    counted(
      db,
      `select t.character_id as id, count(*)::int as n from companion_threads t
        where not (t.user_id = any($1::text[])) and coalesce(t.last_at, t.created_at) > now() - make_interval(days => $2::int)
        group by 1`,
      us,
    ),
    db.query<{ id: string; tags: string[] | null }>(
      `select c.id, (select array_agg(t.tag) from character_tags t where t.character_id = c.id) as tags from characters c
        where c.visibility <> 'private' and ((c.is_house and c.premium_sku is null) or c.companion_open)`,
    ),
  ]);
  return demandOf(picks, offer.rows.map((r) => ({ id: r.id, tags: r.tags ?? [] })), TAGS.filter((t) => t.facet === "type"), "sfw");
}

/** What the show's pickers fetch (GET /api/tags/demand): the blended numbers only, cached a while. */
let cache: { at: number; value: { roleplays: Record<string, number>; types: Record<string, number> } } | null = null;
export const DEMAND_CACHE_MS = 60 * 60 * 1000;
export async function pickerDemand(db: Db, now = Date.now()): Promise<{ roleplays: Record<string, number>; types: Record<string, number> }> {
  if (cache && now - cache.at < DEMAND_CACHE_MS) return cache.value;
  const [roleplays, types] = await Promise.all([showRoleplayDemand(db), characterTypeDemand(db)]);
  cache = { at: now, value: { roleplays: demandMap(roleplays), types: demandMap(types) } };
  return cache.value;
}
export const forgetPickerDemandForTests = () => {
  cache = null;
  adminCache = null;
};

/** What /admin/tags shows: the show's roleplays, the character types talked to, art styles and the lineup. */
export type AdminTagDemand = { roleplays: Demand; types: Demand; styles: Demand & { sources: FacetSources }; lineup: Demand & { sources: FacetSources } };
/** How long /admin/tags keeps its tables: 90 days of picks took about 4 s to read on every load (UX audit 2026-11-22). */
export const ADMIN_DEMAND_CACHE_MS = 10 * 60 * 1000;
let adminCache: { at: number; value: Promise<AdminTagDemand> } | null = null;

/** The admin page's four demands, kept ADMIN_DEMAND_CACHE_MS; a read that fails isn't kept. `at` says when they were read. */
export async function adminTagDemand(db: Db, now = Date.now()): Promise<AdminTagDemand & { at: number }> {
  if (!adminCache || now - adminCache.at >= ADMIN_DEMAND_CACHE_MS || now < adminCache.at) {
    const value = Promise.all([showRoleplayDemand(db), characterTypeDemand(db), artStyleDemand(db), lineupDemand(db)]).then(([roleplays, types, styles, lineup]) => ({
      roleplays,
      types,
      styles,
      lineup,
    }));
    adminCache = { at: now, value };
    value.catch(() => {
      if (adminCache?.value === value) adminCache = null;
    });
  }
  const { at, value } = adminCache;
  return { ...(await value), at };
}
