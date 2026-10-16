/**
 * Report review: the owner's half of the report button. REPORT_HIDE_THRESHOLD distinct reports hide an episode; every
 * open report is listed on /admin and raises an alert through the system monitor (GET /api/health), until the owner
 * clears it (the episode comes back) or takes it down (private to its creator). Reviewing MOVES the reports to
 * reports_reviewed, so the visibility queries that count `reports` never need to know review exists.
 */
import type { Db } from "./db";
import { REPORT_HIDE_THRESHOLD } from "./rules";

export const REVIEW_DECISIONS = ["cleared", "removed"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** How many transcript lines the review card shows: enough to judge, short enough to scan. */
const PREVIEW_LINES = 8;
const MAX_LISTED = 50;

export type ReportedEpisode = {
  episode_id: string;
  characters: [string, string];
  visibility: string;
  created_at: string;
  reports: number;
  hidden: boolean;
  reasons: Record<string, number>;
  first_reported_at: string;
  last_reported_at: string;
  preview: { setting: string | null; best_line: string | null; twist: string | null; finale: string | null; lines: string[] };
};

type Row = {
  episode_id: string;
  visibility: string;
  created_at: string | Date;
  setting: string | null;
  best_line: string | null;
  twist: string | null;
  finale: string | null;
  transcript: Array<{ side?: string; dialogue?: string }> | null;
  a_name: string;
  b_name: string;
  reports: number;
  first_at: string | Date;
  last_at: string | Date;
  reasons: Record<string, number> | null;
};

const iso = (v: string | Date) => new Date(v).toISOString();

/** Episodes with reports nobody has reviewed yet, most-reported first. */
export async function listOpenReports(db: Db): Promise<ReportedEpisode[]> {
  const { rows } = await db.query<Row>(
    `select e.id as episode_id, e.visibility, e.created_at, e.setting, e.best_line, e.twist, e.finale, e.transcript,
            a.name as a_name, b.name as b_name, rep.n as reports, rep.first_at, rep.last_at,
            (select jsonb_object_agg(x.reason, x.n)
               from (select reason, count(*)::int as n from reports r2 where r2.episode_id = e.id group by reason) x) as reasons
       from (select episode_id, count(*)::int as n, min(created_at) as first_at, max(created_at) as last_at
               from reports group by episode_id) rep
       join episodes e on e.id = rep.episode_id
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      order by rep.n desc, rep.last_at desc
      limit $1`,
    [MAX_LISTED],
  );
  return rows.map((r) => ({
    episode_id: r.episode_id,
    characters: [r.a_name, r.b_name],
    visibility: r.visibility,
    created_at: iso(r.created_at),
    reports: r.reports,
    hidden: r.reports >= REPORT_HIDE_THRESHOLD,
    reasons: r.reasons ?? {},
    first_reported_at: iso(r.first_at),
    last_reported_at: iso(r.last_at),
    preview: {
      setting: r.setting,
      best_line: r.best_line,
      twist: r.twist,
      finale: r.finale,
      lines: (r.transcript ?? [])
        .slice(0, PREVIEW_LINES)
        .map((l) => `${l.side === "b" ? r.b_name : r.a_name}: ${l.dialogue ?? ""}`),
    },
  }));
}

/**
 * Reviews every open report on one episode. 'cleared': the reports stop counting, so a hidden episode is back.
 * 'removed': the same, and the episode becomes private to its creator (reversible from the owner's own page;
 * nothing is deleted). Returns how many reports were reviewed (0: nothing was open on that episode).
 */
export async function reviewReports(db: Db, episodeId: string, decision: ReviewDecision): Promise<number> {
  const { rows } = await db.query<{ episode_id: string }>(
    `with moved as (delete from reports where episode_id = $1 returning episode_id, reporter_id, reason, created_at)
     insert into reports_reviewed (episode_id, reporter_id, reason, created_at, decision)
     select episode_id, reporter_id, reason, created_at, $2 from moved
     on conflict (episode_id, reporter_id) do update set decision = excluded.decision, reviewed_at = now()
     returning episode_id`,
    [episodeId, decision],
  );
  if (rows.length && decision === "removed") {
    await db.query("update episodes set visibility = 'private' where id = $1", [episodeId]);
  }
  return rows.length;
}

/** What the monitor needs: how much is waiting for review, and since when. */
export async function openReportSummary(db: Db): Promise<{ episodes: number; reports: number; oldest_at: string | null }> {
  const { rows } = await db.query<{ episodes: number; reports: number; oldest_at: string | Date | null }>(
    "select count(distinct episode_id)::int as episodes, count(*)::int as reports, min(created_at) as oldest_at from reports",
  );
  const r = rows[0] ?? { episodes: 0, reports: 0, oldest_at: null };
  return { episodes: r.episodes, reports: r.reports, oldest_at: r.oldest_at ? iso(r.oldest_at) : null };
}
