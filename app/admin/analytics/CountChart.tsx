"use client";

import type { ReactNode } from "react";
import { bucket, shortDay, trendLines, type Interval } from "@/lib/chart";
import type { Insights } from "@/lib/insights";
import { TimeChart, type BarSeries } from "./charts";

const sum = (xs: readonly (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

export const trendLabel = (interval: Interval) => (interval === "day" ? "7-day average" : "4-week average");
export const previousLabel = (days: number) => `previous ${days === 1 ? "day" : `${days} days`}`;

/** The sentence a screen reader hears for a count chart: the totals of both periods and the busiest day or week. */
export function countSummary(labels: readonly string[], values: readonly (number | null)[], previousTotal: number, days: number, unit: string, weekly: boolean): string {
  const total = sum(values);
  let peak = 0;
  values.forEach((v, i) => {
    if ((v ?? 0) > (values[peak] ?? 0)) peak = i;
  });
  const busiest = (values[peak] ?? 0) > 0 ? ` The busiest ${weekly ? "week was the week of" : "day was"} ${shortDay(labels[peak])}, with ${values[peak]}.` : "";
  return `${total.toLocaleString("en-US")} ${unit} in these ${days} days, against ${previousTotal.toLocaleString("en-US")} in the ${days} before.${busiest}`;
}

/**
 * A daily count (or several stacked): bars by day or week, the trend line (a moving average, led in by the previous
 * period) and the previous period's own line, point for point.
 */
export function CountChart({
  title,
  data,
  stacks,
  previous,
  interval,
  unit,
  caption,
  empty,
}: {
  title: string;
  data: Insights;
  /** One series, or several stacked: each a daily count over data.days (null on a day it wasn't logged). */
  stacks: { key: string; label: string; color: string; values: (number | null)[] }[];
  /** The previous period's daily total over data.previous_days. */
  previous: (number | null)[];
  interval: Interval;
  unit: string;
  caption?: ReactNode;
  empty?: ReactNode;
}) {
  // A day none of the stacks logged stays missing; otherwise the stacks add up.
  const totals = data.days.map((_, i) => (stacks.every((b) => b.values[i] === null) ? null : stacks.reduce((s, b) => s + (b.values[i] ?? 0), 0)));
  const lines = trendLines(data.days, totals, data.previous_days, previous, interval);
  const shaped = stacks.map((b) => ({ ...b, shaped: bucket(data.days, b.values, interval, "sum") }));
  const labels = shaped[0]?.shaped.labels ?? data.days;
  const partial = shaped[0]?.shaped.partial ?? [];
  const bars: BarSeries[] = shaped.map((b) => ({ key: b.key, label: b.label, color: b.color, values: b.shaped.values }));
  return (
    <TimeChart
      title={title}
      caption={caption}
      empty={empty ?? `No ${unit} in these ${data.query.days === 1 ? "day" : `${data.query.days} days`}.`}
      summary={countSummary(labels, bucket(data.days, totals, interval, "sum").values, sum(previous), data.query.days, unit, interval === "week")}
      labels={labels}
      weekly={interval === "week"}
      labelNote={(i) => (partial[i] ? "partial week" : null)}
      bars={bars}
      lines={[
        { key: "average", label: trendLabel(interval), color: "var(--ink)", values: lines.average, kind: "average" },
        { key: "previous", label: previousLabel(data.query.days), color: "var(--viz-prev)", values: lines.previous, kind: "previous" },
      ]}
    />
  );
}
