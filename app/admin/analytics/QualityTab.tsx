"use client";

import Link from "next/link";
import { bucket, percent, type Interval } from "@/lib/chart";
import type { Insights, QualitySummary, QualityTableRow } from "@/lib/insights";
import type { QualityRunKind } from "@/lib/quality-runs";
import { TimeChart, type Marker } from "./charts";
import { KpiCard } from "./Kpis";
import SortableTable, { type Column } from "./SortableTable";

/** The golden gate fails a run whose B wins under this share (scripts/eval/golden.mjs MIN_WIN_RATE). */
const GATE_WIN_RATE = 0.45;

export const RUN_KIND_LABEL: Record<QualityRunKind, string> = { golden: "Golden A/B", after_dark_observer: "After Dark observer" };

const rating = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}/10`);
const short = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One period's quality in a sentence per measure, for the current and the previous period side by side. */
function summaries(q: QualitySummary) {
  return {
    golden: q.golden.runs
      ? `${q.golden.runs} run${q.golden.runs === 1 ? "" : "s"}; B's win rate ${percent(q.golden.win_rate)}${q.golden.passed + q.golden.failed ? `; gate passed ${q.golden.passed} of ${q.golden.passed + q.golden.failed}` : ""}`
      : "no runs",
    observer: q.observer.runs ? `${q.observer.runs} run${q.observer.runs === 1 ? "" : "s"}; ${q.observer.findings} findings in ${q.observer.lines.toLocaleString()} lines` : "no runs",
    loop: q.loop.runs ? `${q.loop.runs} run${q.loop.runs === 1 ? "" : "s"}; overall ${rating(q.loop.overall)}, MCP ${rating(q.loop.mcp)}` : "no runs",
  };
}

/** Quality over time: the golden set, the After Dark observer and the visitor loop, then the feedback and the latest runs. */
export default function QualityTab({ data, interval }: { data: Insights; interval: Interval }) {
  const s = data.series;
  const weekly = interval === "week";
  const now = summaries(data.quality.current);
  const before = summaries(data.quality.previous);
  const view = (values: (number | null)[], how: "sum" | "mean") => bucket(data.days, values, interval, how);
  const winRate = view(s.golden.win_rate, "mean");
  const passed = view(s.golden.passed, "sum").values;
  const failed = view(s.golden.failed, "sum").values;
  // A day (or week) with any failed gate is marked failed; otherwise one with a passed gate is marked passed.
  const markers: Marker[] = winRate.labels.map((_, i) => ((failed[i] ?? 0) > 0 ? "bad" : (passed[i] ?? 0) > 0 ? "good" : null));
  const findings = { unprovoked: view(s.observer.unprovoked, "sum"), repeats: view(s.observer.repeats, "sum"), unfounded: view(s.observer.unfounded, "sum") };
  const loop = { overall: view(s.loop.overall, "mean"), mcp: view(s.loop.mcp, "mean") };
  const noteFor = (partial: boolean[]) => (i: number) => (partial[i] ? "partial week" : null);
  const feedbackKpis = data.kpis.filter((k) => ["thumbs_up", "people_feedback", "agent_feedback"].includes(k.key));

  return (
    <>
      <h2>Quality over time</h2>
      <p className="muted small">
        Runs posted from the developer&apos;s Mac (POST /api/admin/quality and /api/admin/sim-ratings): our own evaluations, so the
        segment and our-traffic filters don&apos;t apply. This period against the previous {data.query.days} days:
      </p>
      <div className="table-scroll">
        <table className="board">
          <thead>
            <tr>
              <th>Measure</th>
              <th>These {data.query.days} days</th>
              <th>The {data.query.days} before</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Golden A/B</td>
              <td>{now.golden}</td>
              <td className="muted">{before.golden}</td>
            </tr>
            <tr>
              <td>After Dark observer</td>
              <td>{now.observer}</td>
              <td className="muted">{before.observer}</td>
            </tr>
            <tr>
              <td>Visitor loop</td>
              <td>{now.loop}</td>
              <td className="muted">{before.loop}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="chart-grid-2">
        <TimeChart
          title="Golden set: B's win rate and the gate"
          caption="The same fixed cases on two configs; a local judge picks the better of each pair twice, order swapped. B's share of wins (a tie counts half), averaged per day; the dot says whether the gate passed."
          summary={`${data.quality.current.golden.runs} golden runs in the period; average win rate ${percent(data.quality.current.golden.win_rate)}; the gate passed ${data.quality.current.golden.passed} times and failed ${data.quality.current.golden.failed}.`}
          labels={winRate.labels}
          weekly={weekly}
          labelNote={noteFor(winRate.partial)}
          lines={[{ key: "win", label: "B's win rate", color: "var(--viz-1)", values: winRate.values, connect: true }]}
          markers={{ values: markers, good: "gate passed", bad: "gate failed" }}
          reference={{ value: GATE_WIN_RATE, label: "the gate's 45%" }}
          yMax={1}
          format={(v) => percent(v)}
          empty={
            <>
              No golden runs in this period. <code>scripts/eval/golden.mjs --post</code> sends one.
            </>
          }
        />
        <TimeChart
          title="After Dark observer: what it flags"
          caption="The nightly observer's checks on every After Dark pair that changed in the last day. Lower is better."
          summary={`${data.quality.current.observer.runs} observer runs in the period flagged ${data.quality.current.observer.findings} findings.`}
          labels={findings.unprovoked.labels}
          weekly={weekly}
          labelNote={noteFor(findings.unprovoked.partial)}
          bars={[
            { key: "unprovoked", label: "unprovoked moves", color: "var(--viz-1)", values: findings.unprovoked.values },
            { key: "repeats", label: "repeated lines", color: "var(--viz-2)", values: findings.repeats.values },
            { key: "unfounded", label: "unfounded memories", color: "var(--viz-3)", values: findings.unfounded.values },
          ]}
          empty={
            <>
              No observer runs in this period. <code>scripts/eval/observer-nightly.mjs</code> posts one a night.
            </>
          }
        />
        <TimeChart
          title="Visitor loop: simulated visitors' ratings"
          caption="Each loop run's average rating out of 10, overall and for the MCP tools, averaged per day."
          summary={`${data.quality.current.loop.runs} visitor-loop runs in the period; overall ${rating(data.quality.current.loop.overall)}, MCP ${rating(data.quality.current.loop.mcp)}.`}
          labels={loop.overall.labels}
          weekly={weekly}
          labelNote={noteFor(loop.overall.partial)}
          lines={[
            { key: "overall", label: "overall", color: "var(--viz-1)", values: loop.overall.values, connect: true },
            { key: "mcp", label: "MCP tools", color: "var(--viz-2)", values: loop.mcp.values, connect: true },
          ]}
          yMax={10}
          format={(v) => v.toFixed(1)}
          empty={
            <>
              No visitor-loop runs posted in this period. <code>scripts/loop/post-ratings.mjs &lt;runDir&gt;</code> posts a run&apos;s
              averages.
            </>
          }
        />
        <section className="chart">
          <h3>Feedback from people and agents</h3>
          <p className="chart-caption muted small">
            Thumbs on lines from real people, the notes people send from the site, and what agents send over MCP. What they
            wrote is on <Link href="/admin/feedback?tab=people">/admin/feedback</Link>.
          </p>
          <div className="kpi-grid">
            {feedbackKpis.map((k) => (
              <KpiCard key={k.key} kpi={k} segment={data.query.segment} />
            ))}
          </div>
        </section>
      </div>

      <h2>Quality runs in this period</h2>
      <RunsTable rows={data.quality.runs} />
    </>
  );
}

export function RunsTable({ rows }: { rows: QualityTableRow[] }) {
  const columns: Column<QualityTableRow>[] = [
    { key: "at", label: "When", value: (r) => r.at, render: (r) => <span title={r.at}>{short(r.at)}</span>, className: "when small" },
    { key: "kind", label: "Run", value: (r) => RUN_KIND_LABEL[r.kind] ?? r.kind },
    {
      key: "label",
      label: "Label",
      value: (r) => r.label,
      className: "wrap",
      render: (r) => (
        <>
          {r.label}
          {r.sha && (
            <>
              {" "}
              · <code>{r.sha.slice(0, 7)}</code>
            </>
          )}
        </>
      ),
    },
    {
      key: "numbers",
      label: "Key numbers",
      value: (r) => r.numbers.map((m) => `${m.label} ${m.value}`).join("; "),
      className: "wrap small",
      render: (r) =>
        r.numbers.map((m, i) => (
          <span key={m.label}>
            {i > 0 ? " · " : ""}
            {m.label} <strong className={m.bad ? "error" : undefined}>{m.value}</strong>
          </span>
        )),
    },
  ];
  return (
    <SortableTable
      caption="Quality runs in this period"
      csvName="quality-runs"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      initialSort={{ key: "at", dir: "desc" }}
      limit={15}
      note="The golden set's verdicts (B's win rate with its n and sign-test p, how often B sounded more like the sheet, the gate) and the observer's counts. Red marks a failed gate or a count that should be zero."
      empty={
        <>
          None in this period. <code>scripts/eval/golden.mjs --post</code> sends a golden A/B, and <code>scripts/eval/observer-nightly.mjs</code>{" "}
          the nightly After Dark observer.
        </>
      }
    />
  );
}
