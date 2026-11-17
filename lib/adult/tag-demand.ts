/**
 * After Dark's own demand for each tag (lib/tag-demand.ts has the method; docs/tags.md "Demand"): which roleplays people
 * pick in Set the scene (adult_scenes.roleplay, the chapter's) and in Step in (adult_step_in_scenes.roleplay), by real
 * members only (lib/our-traffic.ts loadOurIds leaves out admins, reviewers and our tests), the last DEMAND_DAYS,
 * against the house roleplays on offer, shrunk toward the census's adult column. A scene counts once, with the roleplay
 * it has now. Read by the admin view and After Dark's pickers; the show never imports it.
 */
import type { Db } from "../db";
import { loadOurIds } from "../our-traffic";
import { DEMAND_CACHE_MS, DEMAND_DAYS, demandMap, demandOf, type Demand } from "../tag-demand";
import { ROLEPLAYS } from "./roleplays";
import { ADULT_TAGS } from "./tags";

/** Roleplay picks in After Dark's scenes and Step in, by real members, the last DEMAND_DAYS. */
export async function adultRoleplayPicks(db: Db, ours?: readonly string[]): Promise<Map<string, number>> {
  const us = ours ?? (await loadOurIds(db));
  const { rows } = await db.query<{ id: string | null; n: number }>(
    `select id, sum(n)::int as n from (
       select s.roleplay->>'id' as id, count(*) as n from adult_scenes s
        where s.roleplay->>'id' is not null and not (s.owner_id = any($1::text[])) and s.updated_at > now() - make_interval(days => $2::int)
        group by 1
       union all
       select s.roleplay->>'id' as id, count(*) as n from adult_step_in_scenes s
        where s.roleplay->>'id' is not null and not (s.owner_id = any($1::text[])) and s.last_at > now() - make_interval(days => $2::int)
        group by 1
     ) x group by id`,
    [us, DEMAND_DAYS],
  );
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, Number(r.n)]));
}

/** After Dark's roleplay demand, by setup, theme and heat. */
export async function adultRoleplayDemand(db: Db): Promise<Demand> {
  return demandOf(await adultRoleplayPicks(db), ROLEPLAYS, ADULT_TAGS.filter((t) => t.facet !== "type"), "nsfw");
}

let cache: { at: number; value: Record<string, number> } | null = null;
/** What After Dark's pickers order by: the blended numbers only, cached a while. */
export async function adultPickerDemand(db: Db, now = Date.now()): Promise<Record<string, number>> {
  if (cache && now - cache.at < DEMAND_CACHE_MS) return cache.value;
  cache = { at: now, value: demandMap(await adultRoleplayDemand(db)) };
  return cache.value;
}
export const forgetAdultPickerDemandForTests = () => {
  cache = null;
};
