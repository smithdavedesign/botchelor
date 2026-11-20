/**
 * What /admin/social reads (docs/PRDs/social-network.md §10): the network's numbers over time, the most central
 * characters, how much of the graph a dataset could hold (the consent gate, lib/ml-consent.ts), and how often a "Might
 * know" suggestion turns into a tie. Admin only: the page checks before it calls any of these.
 */
import type { Db } from "../db";
import { consentedCharacterSql } from "../ml-consent";
import { DELETED_OWNER } from "../rules";
import { ALL_LAYERS } from "./analytics";
import type { Balance } from "./metrics";

export type NetworkDay = {
  day: string;
  nodes: number;
  ties: Record<string, number>;
  density: number | null;
  clustering: number | null;
  modularity: number | null;
  communities: number | null;
  giant_component: number | null;
  reciprocity: number | null;
  balance: Balance | null;
  complete: boolean;
};

/** The last `days` days of social_network_daily, newest first. */
export async function networkHistory(db: Db, days = 30): Promise<NetworkDay[]> {
  const { rows } = await db.query<NetworkDay & { day: string | Date }>(
    `select day, nodes, ties, density, clustering, modularity, communities, giant_component, reciprocity, balance, complete
       from social_network_daily
      order by day desc
      limit $1`,
    [days],
  );
  return rows.map((r) => ({ ...r, day: typeof r.day === "string" ? r.day.slice(0, 10) : r.day.toISOString().slice(0, 10) }));
}

export type CentralCharacter = {
  id: string;
  name: string;
  degree: number;
  pagerank: number;
  betweenness: number;
  kcore: number;
  community: number | null;
  burt_constraint: number | null;
};

/** The most central characters on the latest day with numbers, across every layer, by PageRank. */
export async function mostCentral(db: Db, limit = 12): Promise<{ day: string | null; characters: CentralCharacter[] }> {
  const latest = (await db.query<{ day: string | Date }>(`select max(day) as day from social_metrics where layer = $1`, [ALL_LAYERS])).rows[0]?.day;
  if (!latest) return { day: null, characters: [] };
  const day = typeof latest === "string" ? latest.slice(0, 10) : latest.toISOString().slice(0, 10);
  const { rows } = await db.query<CentralCharacter>(
    `select c.id, c.name, m.degree, m.pagerank, m.betweenness, m.kcore, m.community, m.burt_constraint
       from social_metrics m
       join characters c on c.id = m.character_id
      where m.day = $1::date and m.layer = $2 and c.owner_id is distinct from $3
      order by m.pagerank desc nulls last, c.id
      limit $4`,
    [day, ALL_LAYERS, DELETED_OWNER, limit],
  );
  return { day, characters: rows };
}

export type LicensableCount = { key: string; ties: number; licensable: number };

/**
 * The public, active ties between public characters (a tie to a public off-screen person counts with its holder), and
 * how many a dataset could hold today: every character on the tie is the show's or its owner had opted in when the tie
 * was made (the consent gate, the PRD's §8). By who made them (source), and by the model that wrote any part of them.
 */
export async function licensableTies(db: Db): Promise<{ total: LicensableCount; by_source: LicensableCount[]; by_model: LicensableCount[] }> {
  const { rows } = await db.query<{ source: string; model: string; ties: number; licensable: number }>(
    `select t.source, coalesce(t.origin_model, '') as model, count(*)::int as ties,
            count(*) filter (where ${consentedCharacterSql("a", "t.created_at")}
                               and (b.id is null or ${consentedCharacterSql("b", "t.created_at")}))::int as licensable
       from social_ties t
       join characters a on a.id = t.from_id
       left join characters b on b.id = t.to_id
       left join social_people p on p.id = t.to_person_id
      where t.status = 'active' and t.visibility = 'public'
        and a.visibility = 'public' and a.owner_id is distinct from $1
        and (case when t.to_id is not null then b.visibility = 'public' and b.owner_id is distinct from $1
                  else p.visibility = 'public' end)
      group by 1, 2`,
    [DELETED_OWNER],
  );
  const sum = (key: string, list: typeof rows): LicensableCount => ({
    key,
    ties: list.reduce((s, r) => s + r.ties, 0),
    licensable: list.reduce((s, r) => s + r.licensable, 0),
  });
  const group = (by: (r: (typeof rows)[number]) => string) => {
    const keys = [...new Set(rows.map(by))];
    return keys.map((k) => sum(k, rows.filter((r) => by(r) === k))).sort((a, b) => b.ties - a.ties || (a.key < b.key ? -1 : 1));
  };
  return { total: sum("all", rows), by_source: group((r) => r.source), by_model: group((r) => r.model || "none") };
}

export type SuggestionHits = {
  days: number;
  shown: number;
  accepted: number;
  dismissed: number;
  ignored: number;
  /** Shown and not yet answered either way. */
  open: number;
  /** Accepted over shown; null when nothing was shown. */
  hit_rate: number | null;
  by_reason: { reason: string; shown: number; accepted: number; hit_rate: number | null }[];
};

/** How often a suggestion shown in the last `days` days became a tie (social_suggestion_log). */
export async function suggestionHits(db: Db, days = 30): Promise<SuggestionHits> {
  const { rows } = await db.query<{ reason: string; shown: number; accepted: number; dismissed: number; ignored: number }>(
    `select reason, count(*)::int as shown,
            count(*) filter (where outcome = 'accepted')::int as accepted,
            count(*) filter (where outcome = 'dismissed')::int as dismissed,
            count(*) filter (where outcome = 'ignored')::int as ignored
       from social_suggestion_log
      where shown_at > now() - make_interval(days => $1)
      group by reason`,
    [days],
  );
  const rate = (accepted: number, shown: number) => (shown ? accepted / shown : null);
  const total = (k: "shown" | "accepted" | "dismissed" | "ignored") => rows.reduce((s, r) => s + r[k], 0);
  const [shown, accepted, dismissed, ignored] = [total("shown"), total("accepted"), total("dismissed"), total("ignored")];
  return {
    days,
    shown,
    accepted,
    dismissed,
    ignored,
    open: shown - accepted - dismissed - ignored,
    hit_rate: rate(accepted, shown),
    by_reason: rows
      .map((r) => ({ reason: r.reason, shown: r.shown, accepted: r.accepted, hit_rate: rate(r.accepted, r.shown) }))
      .sort((a, b) => b.shown - a.shown || (a.reason < b.reason ? -1 : 1)),
  };
}
