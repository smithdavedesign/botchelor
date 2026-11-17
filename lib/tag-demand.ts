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
 */
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
    const raw = total > 0 && supplyShare > 0 ? n / total / supplyShare : null;
    const census = t.census[side] ?? t.census[side === "sfw" ? "nsfw" : "sfw"] ?? 1;
    const blended = raw === null ? census : (n * Math.min(raw, RAW_CAP) + SHRINK * census) / (n + SHRINK);
    return { tag: t.id, label: t.label, icon: t.icon, facet: t.facet, picks: n, supply: having.length, raw, census, blended: Math.round(blended * 1000) / 1000 };
  });
  return { side, total, rows };
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
};
