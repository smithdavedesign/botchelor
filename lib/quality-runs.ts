/**
 * Quality runs (David, 2026-10-21: "self-improvement that actually moves"). The simulated visitors rate the product 8 to 8.5
 * whatever changes, so two other measures sit next to Real use on /admin/analytics:
 *
 *  - "golden": the golden set's side-by-side judge (scripts/eval/golden.mjs). The same fixed cases run on two configs, A and
 *    B, and a local model picks the better transcript of each pair twice, with the order swapped. Its summary is B's win
 *    rate against A, a sign test, the deterministic metrics' deltas and whether the regression gate passed.
 *  - "after_dark_observer": the nightly After Dark observer (scripts/eval/observer-nightly.mjs), which counts what the
 *    observer's checks flag (lib/adult/observer.ts) on every pair whose scene or nights changed in the last day.
 *
 * Both run on the developer's Mac and post here (POST /api/admin/quality). Posting the same kind and label again
 * replaces the row, so a rerun doesn't add a duplicate.
 */
import type { Db } from "./db";

export const QUALITY_RUN_KINDS = ["after_dark_observer", "golden"] as const;
export type QualityRunKind = (typeof QUALITY_RUN_KINDS)[number];

export type QualityRun = { id: string; kind: QualityRunKind; at: string; sha: string | null; label: string; metrics: Record<string, unknown> };

type Row = { id: string; kind: QualityRunKind; at: Date | string; sha: string | null; label: string; metrics: Record<string, unknown> | string | null };

const toRun = (r: Row): QualityRun => ({
  id: r.id,
  kind: r.kind,
  at: new Date(r.at).toISOString(),
  sha: r.sha ?? null,
  label: r.label,
  metrics: typeof r.metrics === "string" ? (JSON.parse(r.metrics) as Record<string, unknown>) : (r.metrics ?? {}),
});

/** Records a run; the same kind and label again replaces its time, commit and metrics (the row keeps its id). */
export async function saveQualityRun(db: Db, run: Omit<QualityRun, "id">): Promise<QualityRun> {
  const { rows } = await db.query<Row>(
    `insert into quality_runs (id, kind, at, sha, label, metrics) values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (kind, label) do update set at = excluded.at, sha = excluded.sha, metrics = excluded.metrics, posted_at = now()
     returning id, kind, at, sha, label, metrics`,
    [crypto.randomUUID(), run.kind, run.at, run.sha, run.label, JSON.stringify(run.metrics ?? {})],
  );
  return toRun(rows[0]);
}

/** The latest runs, newest first: all kinds, or one. */
export async function listQualityRuns(db: Db, { limit = 10, kind }: { limit?: number; kind?: QualityRunKind } = {}): Promise<QualityRun[]> {
  const { rows } = await db.query<Row>(
    `select id, kind, at, sha, label, metrics from quality_runs where ($2::text is null or kind = $2) order by at desc, posted_at desc limit $1`,
    [limit, kind ?? null],
  );
  return rows.map(toRun);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fixed = (v: number | null, digits = 2) => (v === null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(digits));
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** One number the analytics table shows for a run. `bad` marks a failed gate or a count that should be zero. */
export type KeyMetric = { label: string; value: string; bad?: boolean };

/**
 * The handful of numbers /admin/analytics shows per run (the rest stay in `metrics`): for the golden set, B's win rate
 * against A with its sample size and sign-test p, how often B sounded more like the sheet, the gate and the cost; for the
 * observer, how many pairs and lines it read and what it flagged.
 */
export function keyMetrics(run: QualityRun): KeyMetric[] {
  const m = run.metrics ?? {};
  if (run.kind === "golden") {
    const out: KeyMetric[] = [];
    if (typeof m.suite === "string") out.push({ label: "suite", value: m.suite.replace(/_/g, " ") });
    const n = num(m.n);
    const winRate = num(m.win_rate_b);
    out.push({
      label: "B vs A",
      value: winRate === null ? "not judged" : `${pct(winRate)} (n ${n ?? 0}${num(m.p_value) !== null ? `, p ${fixed(num(m.p_value))}` : ""})`,
      bad: winRate !== null && winRate < 0.45,
    });
    if (num(m.sheet_win_rate_b) !== null) out.push({ label: "sounds like the sheet", value: pct(num(m.sheet_win_rate_b)) });
    const gate = m.gate as { passed?: unknown } | null | undefined;
    if (gate && typeof gate.passed === "boolean") out.push({ label: "gate", value: gate.passed ? "passed" : "failed", bad: !gate.passed });
    if (num(m.cost_usd) !== null) out.push({ label: "cost", value: `$${num(m.cost_usd)!.toFixed(2)}` });
    return out;
  }
  const repeats = (num(m.verbatim_repeats) ?? 0) + (num(m.near_repeats) ?? 0);
  const out: KeyMetric[] = [
    { label: "pairs", value: fixed(num(m.pairs)) },
    { label: "lines", value: fixed(num(m.lines)) },
    { label: "unprovoked moves", value: fixed(num(m.unprovoked_moves)), bad: (num(m.unprovoked_moves) ?? 0) > 0 },
    { label: "repeats", value: String(repeats), bad: repeats > 0 },
    { label: "unfounded memories", value: fixed(num(m.unfounded_memories)), bad: (num(m.unfounded_memories) ?? 0) > 0 },
  ];
  if (num(m.share_memory) !== null) out.push({ label: "lines citing a memory", value: pct(num(m.share_memory)) });
  if (num(m.errors)) out.push({ label: "pairs that failed", value: fixed(num(m.errors)), bad: true });
  return out;
}
