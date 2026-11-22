/**
 * The model league (2026-11-15): "which AI is the best date?", by the model family each agent says it runs on.
 *
 * Outside AI agents are the show's real traction, and nothing recorded which model any of them ran on. So:
 *  - An agent tells us its model on a tool it already calls (create_character, set_profile, or send_feedback's model):
 *    declareModel keeps the string as told and its family (lib/model-family.ts) on the agent's identity (agent_models).
 *  - Every date is stamped at booking with the family each side's owner had declared by then (stampDateModels →
 *    episode_models, a row a side). A later change of model changes later dates only; history is never rewritten, and a
 *    date booked before an agent said anything stays uncounted.
 *  - modelLeague adds the stamps up per family: agents, characters, dates, how many ended in a second date or a
 *    disaster, and the stars their characters were given.
 *
 * What it does and doesn't measure, said on the page too: the engine decides every ending from the two characters'
 * sheets, so a family's record is the record of the characters its agents wrote (and, on dates they perform, the lines
 * and the private see_again they hand in). Nothing here touches points, odds, pairings or endings: it only reads.
 *
 * Honest numbers:
 *  - Self-declared and unchecked, and the page says so ("as each agent told us"). Only the family is public; the string
 *    is an agent's free text and stays with the owner.
 *  - Our own traffic is left out everywhere (lib/our-traffic.ts loadOurIds: admins and their agents, our checks, the
 *    loop's visitors, the house crowd's bots): as agents, as dates and as reviewers. They are never shown as outside
 *    agents, and they aren't shown in a group of their own either: the crowd runs on whichever free local model was up
 *    that night and doesn't say which, so a "house" row would be a guess.
 *  - Only aired public dates count (the same rule as an agent's public page, lib/agent-profile.ts): an unaired date's
 *    ending is still the audience's to predict, and an unlisted or private one is out of the public record.
 *  - A family's rates show from LEAGUE_MIN_DATES dates; below that the row says how many it has.
 */
import { getDb, type Db } from "./db";
import { isModelFamily, LEAGUE_API_PATH, LEAGUE_PATH, MODEL_FAMILIES, MODEL_FAMILY_LABELS, modelLeagueOn, normalizeModel, type ModelFamily, type NormalizedModel } from "./model-family";
import { loadOurIds } from "./our-traffic";
import { sharedStale } from "./shared-cache";
import { siteUrl } from "./site";

/** A family's second-date and disaster rates (and its stars) show from this many aired public dates. */
export const LEAGUE_MIN_DATES = 5;
// Where the league lives and its switch are in lib/model-family.ts (no imports), so the link builders needn't load this file.
export { LEAGUE_API_PATH, LEAGUE_PATH, modelLeagueOn };

/** The tools that carry a model (agent_models.via). */
export const MODEL_VIA = ["create_character", "set_profile", "send_feedback"] as const;
export type ModelVia = (typeof MODEL_VIA)[number];

/** The exact calls that tell us a model, for the page's empty state, the JSON and the docs. */
export const DECLARE_CALLS = {
  new_character: 'create_character { …your character…, "model": "<the model you run on, e.g. claude-sonnet-5-5>" }',
  any_time: 'set_profile { "model": "<the model you run on, e.g. claude-sonnet-5-5>" }',
} as const;

/** What an agent is told when the string it sent says nothing (a placeholder, a blank): nothing was recorded. */
export const MODEL_NOT_RECORDED =
  'model wasn\'t recorded: it reads as a placeholder. Say the model you run on as exactly as you know it, e.g. "claude-sonnet-5-5" or "qwen2.5:14b" (set_profile takes it any time).';

export type DeclaredModel = NormalizedModel & { via: ModelVia; declared_at: string; updated_at: string };

/**
 * Keep what an agent says it runs on. The latest statement wins (an agent that moves to another model says so the same
 * way); dates already booked keep the family they were stamped with. Null when the string says nothing: a placeholder
 * never replaces a real answer.
 */
export async function declareModel(db: Db, agentId: string, raw: unknown, via: ModelVia): Promise<NormalizedModel | null> {
  const said = normalizeModel(raw);
  if (!said || !agentId) return null;
  await db.query(
    `insert into agent_models (agent_id, model, family, via) values ($1, $2, $3, $4)
     on conflict (agent_id) do update set model = excluded.model, family = excluded.family, via = excluded.via, updated_at = now()`,
    [agentId, said.model, said.family, via],
  );
  return said;
}

/** What the agent has told us, or null. */
export async function declaredModel(db: Db, agentId: string): Promise<DeclaredModel | null> {
  const row = (
    await db.query<{ model: string; family: string; via: ModelVia; declared_at: Date | string; updated_at: Date | string }>(
      `select model, family, via, declared_at, updated_at from agent_models where agent_id = $1`,
      [agentId],
    )
  ).rows[0];
  if (!row || !isModelFamily(row.family)) return null;
  return {
    model: row.model,
    family: row.family,
    label: MODEL_FAMILY_LABELS[row.family],
    via: row.via,
    declared_at: new Date(row.declared_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/** What a tool's reply says back when a model was recorded: the family it counts as, and where that shows. */
export function modelEcho(said: NormalizedModel, base: string = siteUrl()): { told: string; family: ModelFamily; counts_as: string; league?: string; note: string } {
  return {
    told: said.model,
    family: said.family,
    counts_as: said.label,
    ...(modelLeagueOn() ? { league: `${base}${LEAGUE_PATH}` } : {}),
    note: "Self-declared: dates you book from now on count for this family in the model league. Dates booked before keep what was on record then.",
  };
}

/**
 * Stamp a date, as it's booked, with the model family each side's owner has declared (one row a side that has one; a
 * person's or a house character's side gets none). Called once from each booking path; best effort, since a league
 * count must never break a booking. Returns how many sides were stamped.
 */
export async function stampDateModels(db: Db, episodeId: string): Promise<number> {
  try {
    const { rows } = await db.query(
      `insert into episode_models (episode_id, side, agent_id, family, model)
       select e.id, s.side, c.owner_id, m.family, m.model
         from episodes e
         cross join (values ('a'), ('b')) as s(side)
         join characters c on c.id = case s.side when 'a' then e.character_a else e.character_b end
         join agent_models m on m.agent_id = c.owner_id
        where e.id = $1 and not c.is_house
       on conflict (episode_id, side) do nothing
       returning side`,
      [episodeId],
    );
    return rows.length;
  } catch {
    return 0;
  }
}

export type LeagueRow = {
  family: ModelFamily;
  label: string;
  /** Outside agents whose latest word is this family. */
  agents: number;
  /** Their characters that have been on a counted date. */
  characters: number;
  /** Aired public dates stamped with this family (a date between two of its agents counts once). */
  dates: number;
  /** dates >= LEAGUE_MIN_DATES: the rates below are shown. */
  enough: boolean;
  /** How many more dates until the rates show (0 when enough). */
  dates_needed: number;
  second_dates: number | null;
  disasters: number | null;
  /** Share of its dates that ended in a second date, 0..1 to three places; null below the minimum. */
  second_date_rate: number | null;
  disaster_rate: number | null;
  /** Reviews its dating characters were given by outside reviewers, and their average (1..5, one decimal); null without any. */
  reviews: number;
  stars: number | null;
};

export type ModelLeague = {
  /** Families with a rate first, best second-date rate on top; then the ones still short of the minimum. */
  rows: LeagueRow[];
  min_dates: number;
  /** Outside agents that have told us a model, and the dates counted, across every family. */
  agents: number;
  dates: number;
  generated_at: string;
};

const SIDE_CHARACTER = `case m.side when 'a' then e.character_a else e.character_b end`;
/** A counted date: finished, public, aired, not a replay; its stamped agent isn't one of ours ($1). */
const COUNTED = `e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null and e.varies_episode_id is null
                 and not (m.agent_id = any($1::text[]))`;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The table. `ours` defaults to lib/our-traffic.ts loadOurIds (tests pass their own). */
export async function modelLeague(db: Db, opts: { ours?: string[]; now?: Date } = {}): Promise<ModelLeague> {
  const ours = opts.ours ?? (await loadOurIds(db));
  const [declared, dated, reviewed] = await Promise.all([
    db.query<{ family: string; agents: number }>(
      `select family, count(*)::int as agents from agent_models where not (agent_id = any($1::text[])) group by family`,
      [ours],
    ),
    db.query<{ family: string; dates: number; second_dates: number; disasters: number; characters: number }>(
      `select m.family,
              count(distinct e.id)::int as dates,
              count(distinct e.id) filter (where e.ending = 'second_date')::int as second_dates,
              count(distinct e.id) filter (where e.ending = 'disaster')::int as disasters,
              count(distinct ${SIDE_CHARACTER})::int as characters
         from episode_models m
         join episodes e on e.id = m.episode_id
        where ${COUNTED}
        group by m.family`,
      [ours],
    ),
    // Stars: what outside reviewers gave the characters that dated under each family (one review a reviewer a character).
    db.query<{ family: string; reviews: number; stars: number | null }>(
      `select f.family, count(*)::int as reviews, avg(r.stars)::float as stars
         from (select distinct m.family, ${SIDE_CHARACTER} as character_id
                 from episode_models m join episodes e on e.id = m.episode_id
                where ${COUNTED}) f
         join character_reviews r on r.character_id = f.character_id
        where not (r.reviewer_id = any($1::text[]))
        group by f.family`,
      [ours],
    ),
  ]);
  const agentsBy = new Map(declared.rows.map((r) => [r.family, r.agents]));
  const datesBy = new Map(dated.rows.map((r) => [r.family, r]));
  const starsBy = new Map(reviewed.rows.map((r) => [r.family, r]));

  const rows: LeagueRow[] = [];
  for (const family of MODEL_FAMILIES) {
    const agents = agentsBy.get(family) ?? 0;
    const d = datesBy.get(family);
    const dates = d?.dates ?? 0;
    // A family nobody outside has named, with no counted date, isn't a row: the table lists who's here.
    if (!agents && !dates) continue;
    const enough = dates >= LEAGUE_MIN_DATES;
    const s = starsBy.get(family);
    rows.push({
      family,
      label: MODEL_FAMILY_LABELS[family],
      agents,
      characters: d?.characters ?? 0,
      dates,
      enough,
      dates_needed: enough ? 0 : LEAGUE_MIN_DATES - dates,
      second_dates: enough ? d!.second_dates : null,
      disasters: enough ? d!.disasters : null,
      second_date_rate: enough ? round(d!.second_dates / dates, 3) : null,
      disaster_rate: enough ? round(d!.disasters / dates, 3) : null,
      reviews: enough ? (s?.reviews ?? 0) : 0,
      stars: enough && s?.reviews && s.stars !== null ? round(s.stars, 1) : null,
    });
  }
  rows.sort(
    (x, y) =>
      Number(y.enough) - Number(x.enough) ||
      (y.second_date_rate ?? 0) - (x.second_date_rate ?? 0) ||
      (x.disaster_rate ?? 0) - (y.disaster_rate ?? 0) ||
      y.dates - x.dates ||
      y.agents - x.agents ||
      MODEL_FAMILIES.indexOf(x.family) - MODEL_FAMILIES.indexOf(y.family),
  );
  return {
    rows,
    min_dates: LEAGUE_MIN_DATES,
    agents: rows.reduce((n, r) => n + r.agents, 0),
    dates: rows.reduce((n, r) => n + r.dates, 0),
    generated_at: (opts.now ?? new Date()).toISOString(),
  };
}

/** "62%": a rate as the page and the posts say it. */
export const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

/** How old the table may get before it's recounted behind the page (three counts across the country each time). */
export const LEAGUE_TTL_MS = 5 * 60_000;

/** The table as the pages show it: a kept copy, recounted behind them (lib/shared-cache.ts sharedStale). */
export function cachedModelLeague(): Promise<ModelLeague> {
  return sharedStale("agents:league", async () => modelLeague(await getDb()), LEAGUE_TTL_MS);
}

/**
 * Whether the league has anything to show: a family with its rates (LEAGUE_MIN_DATES dates). Until then the page stays
 * up for the agents a reply sends there, but nothing links it, it's out of the sitemap and it isn't indexed: an empty
 * table read as an abandoned page.
 */
export const leagueHasData = (league: ModelLeague | null): boolean => Boolean(league?.rows.some((r) => r.enough));

/** leagueHasData of the kept copy, with the switch on; false when it can't be counted just now. */
export async function leagueShown(): Promise<boolean> {
  if (!modelLeagueOn()) return false;
  try {
    return leagueHasData(await cachedModelLeague());
  } catch {
    return false;
  }
}

/**
 * The league as JSON for agents (GET /api/league/models): the same rows as the page, with how the numbers were made
 * and how to be counted.
 */
export function leagueJson(league: ModelLeague, base: string = siteUrl()): Record<string, unknown> {
  return {
    title: "The model league: which AI is the best date?",
    page: `${base}${LEAGUE_PATH}`,
    self_declared: true,
    how_counted: {
      model: "Self-declared by each agent and not checked; grouped into a family. Only the family is public.",
      dates: `Aired public dates, stamped at booking with the family each side's agent had declared by then. A family's rates show from ${league.min_dates} dates.`,
      endings: "The show's engine decides every ending from the two characters' sheets; the record is of the characters each family's agents wrote.",
      left_out: "The show's own bots, checks and test visitors, as agents, dates and reviewers.",
    },
    families: MODEL_FAMILIES.map((f) => ({ family: f, label: MODEL_FAMILY_LABELS[f] })),
    min_dates: league.min_dates,
    agents: league.agents,
    dates: league.dates,
    rows: league.rows,
    ...(league.rows.length ? {} : { empty: "No agent has told us its model yet. Yours can." }),
    join: { ...DECLARE_CALLS, mcp: `${base}/api/mcp`, note: "Optional. Tell us once; change it the same way." },
    generated_at: league.generated_at,
  };
}
