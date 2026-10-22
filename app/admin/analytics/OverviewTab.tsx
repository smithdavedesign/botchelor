"use client";

import { percent, shortDay, type Interval } from "@/lib/chart";
import type { Insights } from "@/lib/insights";
import { ENDING_LABELS, ENDINGS } from "@/lib/rules";
import { FunnelChart } from "./charts";
import { CountChart } from "./CountChart";
import { InsightList, KpiGrid } from "./Kpis";

/** Each ending keeps its colour on every chart and table: a second date, just friends, a disaster. */
export const ENDING_COLORS = { second_date: "var(--viz-1)", friends: "var(--viz-2)", disaster: "var(--viz-3)" } as const;

/** Cards that live on another tab only: agents' feedback is on Quality, beside the people's. */
const ELSEWHERE: ReadonlySet<string> = new Set(["agent_feedback"]);

/** The overview: what stands out, the key numbers against the previous period, dates by ending, and the people funnel. */
export default function OverviewTab({ data, interval }: { data: Insights; interval: Interval }) {
  const against = `${shortDay(data.previous.from)} – ${shortDay(data.previous.to)}`;
  return (
    <>
      <h2>What stands out</h2>
      <InsightList insights={data.insights} />

      <h2>Key numbers</h2>
      <p className="muted small">
        Each against the previous {data.query.days} days ({against}). A change only shows in colour when it&apos;s bigger than normal
        variation (two standard errors); under {data.min_events} events, or {data.min_n} for a rate, it says &ldquo;too few to say&rdquo;.
      </p>
      <KpiGrid kpis={data.kpis.filter((k) => !ELSEWHERE.has(k.key))} segment={data.query.segment} />

      <div className="chart-grid-2">
        <CountChart
          title="Dates started, by ending"
          data={data}
          interval={interval}
          unit="dates"
          stacks={ENDINGS.map((e) => ({ key: e, label: ENDING_LABELS[e], color: ENDING_COLORS[e], values: data.series.dates.endings[e] }))}
          previous={data.series.dates.previous}
          caption="The ending the engine decided for each date booked, by the day it was booked."
        />
        <PeopleFunnel data={data} />
      </div>
    </>
  );
}

/** The people funnel for this period's newcomers, with its numbers and each step's meaning below. */
export function PeopleFunnel({ data }: { data: Insights }) {
  const steps = data.funnel;
  return (
    <section className="chart">
      <h3>The people funnel</h3>
      <p className="chart-caption muted small">
        People first seen in these {data.query.days} days, and how far they&apos;ve got so far. Each step counts the people who also did
        every step before it. Visits that do nothing aren&apos;t stored, so it starts at a first action.
      </p>
      {steps[0]?.count ? (
        <FunnelChart
          title="The people funnel"
          steps={steps.map((s) => ({ label: s.label, count: s.count, definition: s.definition, note: s.of_previous === null ? undefined : `${percent(s.of_previous)} of the step before` }))}
        />
      ) : (
        <p className="chart-empty">No new people in this period.</p>
      )}
      <details className="chart-table">
        <summary>Show the numbers</summary>
        <div className="table-scroll">
          <table className="board">
            <caption className="sr-only">The people funnel</caption>
            <thead>
              <tr>
                <th>Step</th>
                <th className="num">People</th>
                <th className="num">Of the step before</th>
                <th className="num">Of first seen</th>
                <th className="num" title="The previous period's newcomers have had longer to get this far.">
                  Previous {data.query.days} days
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.key}>
                  <td className="wrap">
                    <strong>{s.label}</strong>
                    <div className="muted small">{s.definition}</div>
                  </td>
                  <td className="num">{s.count}</td>
                  <td className="num">{s.of_previous === null ? "—" : percent(s.of_previous)}</td>
                  <td className="num">{s.of_first === null ? "—" : percent(s.of_first)}</td>
                  <td className="num muted">{s.previous}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">The previous period&apos;s newcomers have had longer to get this far, so their later steps run higher.</p>
      </details>
    </section>
  );
}
