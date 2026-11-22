/**
 * How After Dark's jobs went, for the admin (app/admin/after-dark/providers, and a line on settings): per kind of job, how
 * many were made and how many failed in the last day, how many are stuck (still "making" well past the time any job
 * takes), and the last failure with its reason where the row keeps one. The providers' cards say only what's set and
 * what's cooling down, so the 2026-11-22 audit found none of these on either page: a writer timeout that day, a failed
 * clip, three Studio shoots refused by Venice's rate limit and a beat stuck "drawing" for days. Reads only, from each
 * job's own rows; a table that can't be read is left out, never a broken page.
 */
import type { Db } from "../db";

export type JobKind = "steps" | "pictures" | "beats" | "shoots" | "nights" | "clips" | "talks" | "faces";

export type JobHealth = {
  kind: JobKind;
  label: string;
  /** Made and failed in the window (a day by default). */
  made: number;
  failed: number;
  /** Still in progress well past any job's time: never finished, never marked failed. */
  stuck: number;
  /** The newest failure in the last LAST_FAILURE_DAYS: when, and the reason where the row keeps one. */
  last_failure: { at: string; reason: string | null } | null;
};

/** A job still "making" after this long has stopped: the longest (a night's video, a shoot of several) take minutes. */
export const STUCK_AFTER_MIN = 30;
/** How far back "the last failure" looks. */
export const LAST_FAILURE_DAYS = 30;

type Spec = {
  kind: JobKind;
  label: string;
  table: string;
  /** Which of the table's rows are this kind (adult_reels holds night videos and clips). */
  where?: string;
  made: readonly string[];
  failed: readonly string[];
  /** The statuses of a job that hasn't finished. */
  going: readonly string[];
  /** The column (or expression) with a failure's reason, where the table keeps one. */
  reason: string | null;
};

/** Every kind of job, from its own rows (lib/db.ts): the statuses each moves through. */
const JOBS: readonly Spec[] = [
  { kind: "steps", label: "Scene steps (the writer)", table: "adult_steps", made: ["ok"], failed: ["error"], going: [], reason: "coalesce(message, 'HTTP ' || http::text)" },
  { kind: "pictures", label: "Pictures", table: "adult_images", made: ["ready"], failed: ["failed"], going: ["pending"], reason: null },
  { kind: "beats", label: "Beat pictures", table: "adult_beats", made: ["drawn"], failed: ["failed"], going: ["drawing"], reason: "fail_reason" },
  { kind: "shoots", label: "Studio shoots", table: "adult_studio_shoots", made: ["ready", "partial"], failed: ["failed"], going: ["making"], reason: "error" },
  { kind: "nights", label: "Night videos", table: "adult_reels", where: "kind = 'night'", made: ["ready"], failed: ["failed"], going: ["making"], reason: null },
  { kind: "clips", label: "Clips", table: "adult_reels", where: "kind = 'clip'", made: ["ready"], failed: ["failed"], going: ["making"], reason: null },
  { kind: "talks", label: "Talking moments", table: "adult_talks", made: ["ready"], failed: ["failed"], going: ["making"], reason: "error" },
  { kind: "faces", label: "Living faces", table: "adult_presence", made: ["ready"], failed: ["failed"], going: ["making"], reason: "error" },
];

const list = (xs: readonly string[]): string => (xs.length ? `array[${xs.map((x) => `'${x}'`).join(", ")}]::text[]` : "array[]::text[]");

/** One kind's numbers in one read: $1 the window's start, $2 the stuck line, $3 how far back the last failure looks. */
function sqlOf(j: Spec): string {
  const scope = j.where ? `${j.where} and ` : "";
  const reason = j.reason ?? "null";
  return `select
      count(*) filter (where status = any(${list(j.made)}) and created_at > $1)::int as made,
      count(*) filter (where status = any(${list(j.failed)}) and created_at > $1)::int as failed,
      count(*) filter (where status = any(${list(j.going)}) and created_at < $2)::int as stuck,
      (select row_to_json(f) from (
         select created_at as at, ${reason} as reason from ${j.table}
          where ${scope}status = any(${list(j.failed)}) and created_at > $3 order by created_at desc limit 1
       ) f) as last_failure
    from ${j.table} where ${scope}(created_at > $1 or status = any(${list(j.going)}))`;
}

type Row = { made: number; failed: number; stuck: number; last_failure: { at: string; reason: string | null } | string | null };

/** Every kind of job's last day (or `hours`), in JOBS order; kinds whose table can't be read are left out. */
export async function jobHealth(db: Db, now: number = Date.now(), hours = 24): Promise<JobHealth[]> {
  const since = new Date(now - hours * 3_600_000).toISOString();
  const stuckLine = new Date(now - STUCK_AFTER_MIN * 60_000).toISOString();
  const failSince = new Date(now - LAST_FAILURE_DAYS * 86_400_000).toISOString();
  const rows = await Promise.all(
    JOBS.map(async (j): Promise<JobHealth | null> => {
      const r = (await db.query<Row>(sqlOf(j), [since, stuckLine, failSince]).catch(() => null))?.rows[0];
      if (!r) return null;
      // A driver may hand the json back as text.
      const f = typeof r.last_failure === "string" ? (JSON.parse(r.last_failure) as { at: string; reason: string | null }) : r.last_failure;
      return {
        kind: j.kind,
        label: j.label,
        made: Number(r.made),
        failed: Number(r.failed),
        stuck: Number(r.stuck),
        last_failure: f ? { at: new Date(f.at).toISOString(), reason: f.reason ? String(f.reason).replace(/\s+/g, " ").trim().slice(0, 240) : null } : null,
      };
    }),
  );
  return rows.filter((r): r is JobHealth => r !== null);
}

/** The day's trouble in one line's numbers: jobs that failed, and jobs stuck. */
export function troubleOf(jobs: readonly JobHealth[]): { failed: number; stuck: number } {
  return jobs.reduce((t, j) => ({ failed: t.failed + j.failed, stuck: t.stuck + j.stuck }), { failed: 0, stuck: 0 });
}

/**
 * Which models each provider actually made After Dark's pictures and videos with this week, most used first: the card
 * named the model set for new pictures (lustify-v8), which made none of the week's 185 (every one starts from a face, so
 * they're edits, qwen-edit-uncensored). Reads only; nothing when the table can't be read.
 */
export async function modelsUsed(db: Db, now: number = Date.now(), days = 7): Promise<Record<string, { model: string; n: number }[]>> {
  const since = new Date(now - days * 86_400_000).toISOString();
  const { rows } = await db
    .query<{ provider: string; model: string; n: number }>(
      `select provider, model, count(*)::int as n from adult_images
        where status = 'ready' and created_at > $1 and provider is not null and coalesce(model, '') <> ''
        group by provider, model order by n desc`,
      [since],
    )
    .catch(() => ({ rows: [] as { provider: string; model: string; n: number }[] }));
  const out: Record<string, { model: string; n: number }[]> = {};
  for (const r of rows) (out[r.provider] ??= []).push({ model: r.model, n: Number(r.n) });
  return out;
}
