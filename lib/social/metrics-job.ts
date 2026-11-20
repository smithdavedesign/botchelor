/**
 * The daily social metrics (docs/PRDs/social-network.md §5.5, §10, §13; SOCIAL_METRICS): reads the public, active ties
 * between public characters page by page, measures the network (./metrics.ts), and writes the day's social_metrics rows
 * and its social_network_daily row. The daily job runs it (app/api/jobs/daily, the growth part).
 *
 * - **A time budget.** It stops between pages of ties and between batches of rows. A run that stops while writing leaves
 *   the day's row incomplete with the last character it wrote (`progress`), and the hourly job's passes that day pick up
 *   after it (resumeSocialMetrics, app/api/jobs/lobby); one that stops while reading leaves the day started with nothing
 *   in it. Once measured, a run always writes one batch, so a day too big for one budget still finishes over a few passes.
 * - **Idempotent per day.** The day seeds every random choice, rows are keyed by day, and a finished day does nothing.
 * - **Public only.** A tie counts when it's active and public and both its characters are public and their owners'
 *   accounts still exist: no private character's tie, nothing After Dark (no social tie comes from there), so the
 *   numbers are safe to show an admin and to license through the consent gate.
 * - **Never in the way.** It runs on the show's own instance, so it yields to the event loop before each measure, and
 *   betweenness (the one measure that grows with nodes times ties) is exact only up to BETWEENNESS_EXACT_UP_TO characters
 *   a layer and sampled from BETWEENNESS_PIVOTS above that: no single step holds the instance for more than about a second
 *   at the show's size.
 */
import type { Db } from "../db";
import { originSql } from "../origin";
import { DELETED_OWNER } from "../rules";
import { byLayer, measureLayer, metricRows, networkRow, type CharacterMetricRow, type MetricNode, type MetricTie } from "./metrics";
import { socialTiesOn } from "./switch";

type Env = Record<string, string | undefined>;

/** The daily analytics. Off whenever SOCIAL_TIES is. */
export const socialMetricsOn = (env: Env = process.env): boolean => socialTiesOn(env) && env.SOCIAL_METRICS?.trim() !== "0";

/** Ties read a page at a time, and metric rows written a batch at a time. */
export const TIE_PAGE = 5000;
export const ROW_BATCH = 500;
/** The default budget for one run (the daily job's growth part leaves the rest of its time to the lessons). */
export const METRICS_BUDGET_MS = 45_000;
/** Betweenness per layer: exact (every character a pivot) up to this many characters, then this many sampled pivots. */
export const BETWEENNESS_EXACT_UP_TO = 1000;
export const BETWEENNESS_PIVOTS = 256;

export type SocialMetricsRun = {
  day: string;
  /**
   * Why it did nothing, or stopped short: switched off, the day was already done, nothing to pick up (a resume before the
   * daily run started the day), or the budget ran out.
   */
  stopped: "off" | "done" | "not_started" | "budget" | null;
  ties: number;
  nodes: number;
  rows: number;
  complete: boolean;
  ms: number;
};

/** The UTC day a run counts for. */
export const metricsDay = (now: Date): string => now.toISOString().slice(0, 10);

/** Lets the event loop answer whatever is waiting before the next measure. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The public, active ties between public characters, one page after `after` (by id). */
async function tiePage(db: Db, after: string): Promise<(MetricTie & { id: string })[]> {
  const { rows } = await db.query<MetricTie & { id: string }>(
    `select t.id, t.from_id, t.to_id, t.kind, t.layer, t.directed, t.valence, t.closeness
       from social_ties t
       join characters a on a.id = t.from_id
       join characters b on b.id = t.to_id
      where t.id > $1 and t.to_id is not null and t.status = 'active' and t.visibility = 'public'
        and a.visibility = 'public' and b.visibility = 'public'
        and a.owner_id is distinct from $2 and b.owner_id is distinct from $2
      order by t.id
      limit $3`,
    [after, DELETED_OWNER, TIE_PAGE],
  );
  return rows.map((r) => ({ ...r, valence: Number(r.valence), closeness: Number(r.closeness) }));
}

/** What each character is, who made it and its tags: what the network's mixing is measured by. */
async function nodeAttributes(db: Db, ids: readonly string[]): Promise<MetricNode[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<{ id: string; kind: string | null; origin: string | null; tags: string[] | null }>(
    `select c.id, c.extras->>'kind' as kind, ${originSql("c")} as origin,
            (select array_agg(ct.tag order by ct.tag) from character_tags ct where ct.character_id = c.id) as tags
       from characters c
      where c.id = any($1::text[])`,
    [ids],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, origin: r.origin, tags: r.tags ?? [] }));
}

const ROW_COLUMNS = [
  ["character_id", "text"],
  ["layer", "text"],
  ["degree", "integer"],
  ["weighted_degree", "real"],
  ["in_valence", "real"],
  ["out_valence", "real"],
  ["reciprocity", "real"],
  ["clustering", "real"],
  ["pagerank", "real"],
  ["betweenness", "real"],
  ["kcore", "integer"],
  ["community", "integer"],
  ["burt_constraint", "real"],
  ["triads_balanced", "integer"],
  ["triads_unbalanced", "integer"],
  ["ring_inner", "integer"],
  ["ring_close", "integer"],
  ["ring_friends", "integer"],
  ["ring_acquaintances", "integer"],
] as const;

/** Upserts a batch of rows for the day in one statement (a JSON array, so a batch is one parameter). */
async function writeRows(db: Db, day: string, rows: readonly CharacterMetricRow[]): Promise<void> {
  const names = ROW_COLUMNS.map(([name]) => name);
  await db.query(
    `insert into social_metrics (day, ${names.join(", ")}, computed_at)
     select $1::date, ${names.map((n) => `r.${n}`).join(", ")}, now()
       from jsonb_to_recordset($2::jsonb) as r(${ROW_COLUMNS.map(([n, type]) => `${n} ${type}`).join(", ")})
     on conflict (character_id, day, layer) do update set
       ${names
         .filter((n) => n !== "character_id" && n !== "layer")
         .map((n) => `${n} = excluded.${n}`)
         .join(", ")}, computed_at = now()`,
    [day, JSON.stringify(rows)],
  );
}

export type SocialMetricsOptions = {
  now?: Date;
  budgetMs?: number;
  env?: Env;
  /** Only finish a day an earlier run started and left short; never start one (the hourly job's passes). */
  resumeOnly?: boolean;
};

/** Measures the public network and writes the day's rows, within `budgetMs`. */
export async function computeSocialMetrics(db: Db, options: SocialMetricsOptions = {}): Promise<SocialMetricsRun> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const day = metricsDay(now);
  const deadline = started + (options.budgetMs ?? METRICS_BUDGET_MS);
  const result = (stopped: SocialMetricsRun["stopped"], rest: Partial<SocialMetricsRun> = {}): SocialMetricsRun => ({
    day,
    stopped,
    ties: 0,
    nodes: 0,
    rows: 0,
    complete: false,
    ms: Date.now() - started,
    ...rest,
  });
  if (!socialMetricsOn(options.env)) return result("off");

  const today = (await db.query<{ complete: boolean; progress: { written_through?: string } | null }>(`select complete, progress from social_network_daily where day = $1::date`, [day]))
    .rows[0];
  if (today?.complete) return result("done", { complete: true });
  if (options.resumeOnly && !today) return result("not_started");
  const writtenThrough = today?.progress?.written_through ?? "";

  // Read every tie first: half a network measured is a wrong network, so a run that can't finish reading writes nothing.
  const ties: MetricTie[] = [];
  for (let after = ""; ; ) {
    if (Date.now() > deadline) {
      // The day stays started (incomplete, nothing written yet), so the hourly passes pick it up.
      if (!today) await db.query(`insert into social_network_daily (day) values ($1::date) on conflict (day) do nothing`, [day]);
      return result("budget", { ties: ties.length });
    }
    const page = await tiePage(db, after);
    for (const { id: _id, ...t } of page) ties.push(t);
    if (page.length < TIE_PAGE) break;
    after = page[page.length - 1].id;
  }

  const layers = [];
  for (const [layer, list] of byLayer(ties)) {
    layers.push(await measureLayer(layer, list, { seed: day, exactUpTo: BETWEENNESS_EXACT_UP_TO, samples: BETWEENNESS_PIVOTS, pause: tick }));
  }
  const all = layers[0];
  const network = networkRow(all, layers, await nodeAttributes(db, all.graph.ids));
  const rows = layers
    .flatMap(metricRows)
    .sort((a, b) => (a.character_id < b.character_id ? -1 : a.character_id > b.character_id ? 1 : a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));

  await db.query(
    `insert into social_network_daily (day, nodes, ties, density, avg_degree, clustering, modularity, communities, giant_component,
                                       assortativity, balance, reciprocity, stats, complete, progress, computed_at)
     values ($1::date, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb, false, $14::jsonb, now())
     on conflict (day) do update set nodes = excluded.nodes, ties = excluded.ties, density = excluded.density,
       avg_degree = excluded.avg_degree, clustering = excluded.clustering, modularity = excluded.modularity,
       communities = excluded.communities, giant_component = excluded.giant_component, assortativity = excluded.assortativity,
       balance = excluded.balance, reciprocity = excluded.reciprocity, stats = excluded.stats, computed_at = now()`,
    [
      day,
      network.nodes,
      JSON.stringify(network.ties),
      network.density,
      network.avg_degree,
      network.clustering,
      network.modularity,
      network.communities,
      network.giant_component,
      JSON.stringify(network.assortativity),
      network.balance === null ? null : JSON.stringify(network.balance),
      network.reciprocity,
      JSON.stringify(network.stats),
      JSON.stringify({ written_through: writtenThrough }),
    ],
  );

  // Then the characters' rows in batches, after wherever an earlier run today stopped. The first batch always goes, so
  // every run that gets this far moves the day on.
  const todo = rows.filter((r) => r.character_id > writtenThrough);
  let written = 0;
  for (let i = 0; i < todo.length; ) {
    if (i > 0 && Date.now() > deadline) return result("budget", { ties: ties.length, nodes: network.nodes, rows: written });
    // A batch ends on a character's last row, so `written_through` never splits one character's layers.
    let end = Math.min(i + ROW_BATCH, todo.length);
    while (end < todo.length && todo[end].character_id === todo[end - 1].character_id) end++;
    const batch = todo.slice(i, end);
    await writeRows(db, day, batch);
    written += batch.length;
    i = end;
    await db.query(`update social_network_daily set progress = $2::jsonb where day = $1::date`, [
      day,
      JSON.stringify({ written_through: batch[batch.length - 1].character_id }),
    ]);
  }
  await db.query(`update social_network_daily set complete = true, computed_at = now() where day = $1::date`, [day]);
  return result(null, { ties: ties.length, nodes: network.nodes, rows: written, complete: true });
}

/**
 * The hourly job's part (app/api/jobs/lobby): finishes the day's rows when the daily run stopped at its budget. One
 * cheap select when there's nothing to pick up, which is nearly always.
 */
export const resumeSocialMetrics = (db: Db, options: Omit<SocialMetricsOptions, "resumeOnly"> = {}): Promise<SocialMetricsRun> =>
  computeSocialMetrics(db, { ...options, resumeOnly: true });
