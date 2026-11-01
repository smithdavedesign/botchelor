"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { compact, linePath, niceTicks, scaleLinear, shortDay } from "@/lib/chart";

/*
 * The admin analytics charts, hand-drawn in SVG (no chart library). Each one: a legend for two or more series, thin
 * marks (bars at most 24px with a 2px gap and a rounded top, 2px lines), a hairline grid, a crosshair tooltip that
 * follows the pointer or the arrow keys, and every number again in a table underneath, so nothing is only a colour or
 * only on hover. Colours are the --viz-* tokens, so light and dark come from the theme.
 */

export type BarSeries = { key: string; label: string; color: string; values: (number | null)[] };
export type LineSeries = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  kind?: "series" | "average" | "previous";
  /** Join the points across days without a value: for runs posted every few days, not for a day that wasn't logged. */
  connect?: boolean;
};
/** A status mark on a line's point: a passed or failed gate. */
export type Marker = "good" | "bad" | null;

type TimeChartProps = {
  title: string;
  /** The one-sentence text alternative read in place of the drawing. */
  summary: string;
  /** "YYYY-MM-DD": a day, or a week's Monday. */
  labels: string[];
  /** A note on a label in the tooltip and the table: "partial week". */
  labelNote?: (i: number) => string | null;
  /** "Week of" before a week's Monday. */
  weekly?: boolean;
  bars?: BarSeries[];
  lines?: LineSeries[];
  /** Status marks drawn on the first line's points, explained in the legend. */
  markers?: { values: Marker[]; good: string; bad: string };
  /** A threshold drawn as a dashed hairline. */
  reference?: { value: number; label: string };
  /** A fixed top for the value axis (1 for a share, 10 for a rating). */
  yMax?: number;
  format?: (v: number) => string;
  /** Shown instead of the drawing when there's nothing to draw. */
  empty?: ReactNode;
  caption?: ReactNode;
  height?: number;
};

const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;
const defaultFormat = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));

/** The plot's width in CSS pixels, so the SVG is drawn at its real size and its text never scales. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(1, Math.floor(el.getBoundingClientRect().width)));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** A bar segment with its top corners rounded (the data end) and a square base. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

function Legend({ bars = [], lines = [], markers, reference }: Pick<TimeChartProps, "bars" | "lines" | "markers" | "reference">) {
  const items = [
    ...bars.map((b) => ({ key: b.key, label: b.label, color: b.color, shape: "" })),
    ...lines.map((l) => ({ key: l.key, label: l.label, color: l.color, shape: "is-line" })),
    ...(markers ? [{ key: "good", label: markers.good, color: "var(--ok)", shape: "is-dot" }, { key: "bad", label: markers.bad, color: "var(--bad)", shape: "is-dot" }] : []),
  ];
  // One series needs no legend: the title already says what it is.
  if (items.length < 2 && !reference) return null;
  return (
    <ul className="chart-legend">
      {items.map((i) => (
        <li key={i.key}>
          <span className={`chart-key ${i.shape}`} style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
      {reference && (
        <li>
          <span className="chart-key is-reference" aria-hidden="true" />
          {reference.label}
        </li>
      )}
    </ul>
  );
}

const labelFor = (day: string, weekly?: boolean) => (weekly ? `Week of ${shortDay(day)}` : shortDay(day));

/** A time series: stacked bars, lines, or both, on one value axis. */
export function TimeChart(props: TimeChartProps) {
  const { title, summary, labels, labelNote, weekly, bars = [], lines = [], markers, reference, yMax, format = defaultFormat, empty, caption, height = 200 } = props;
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const hasData = [...bars, ...lines].some((s) => s.values.some((v) => v !== null && v !== 0));

  const totals = labels.map((_, i) => bars.reduce((s, b) => s + (b.values[i] ?? 0), 0));
  const peak = Math.max(0, ...totals, ...lines.flatMap((l) => l.values.filter((v): v is number => v !== null)), reference?.value ?? 0);
  // Counts tick on whole numbers (a trend line's averages don't make them fractional).
  const counted = [...bars.flatMap((b) => b.values), ...lines.filter((l) => l.kind !== "average").flatMap((l) => l.values)];
  const integer = counted.every((v) => v === null || Number.isInteger(v));
  const ticks = yMax ? [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax] : niceTicks(peak || 1, 4, integer);
  const top = ticks[ticks.length - 1];
  const tickText = (v: number) => (yMax === 1 ? `${Math.round(v * 100)}%` : compact(v));
  const left = Math.max(...ticks.map((t) => tickText(t).length)) * 6.5 + 10;
  const margin = { top: 8, right: 8, bottom: 22, left };
  const plotW = Math.max(1, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const slot = plotW / Math.max(1, n);
  const x = (i: number) => margin.left + slot * i + slot / 2;
  const y = scaleLinear([0, top], [margin.top + plotH, margin.top]);
  const barW = Math.max(1, Math.min(BAR_MAX, slot - (slot > 6 ? GAP * 2 : slot > 3 ? GAP : 0)));
  // About one date label per 64px, always the first and the last; a label closer than a full step to the last one gives way.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  const xTicks = labels.map((_, i) => i).filter((i) => i % every === 0 || i === n - 1).filter((i, k, all) => i === n - 1 || all[k + 1] - i >= every);

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - margin.left) / slot);
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget.getBoundingClientRect());
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -n, End: n };
    if (e.key === "Escape") return setActive(null);
    if (!(e.key in moves)) return;
    e.preventDefault();
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + moves[e.key])));
  };

  const rows = (i: number) => [
    ...bars.map((b) => ({ key: b.key, label: b.label, color: b.color, value: b.values[i], line: false })),
    ...(bars.length > 1 ? [{ key: "total", label: "total", color: "transparent", value: totals[i], line: false }] : []),
    ...lines.map((l) => ({ key: l.key, label: l.label, color: l.color, value: l.values[i], line: true })),
  ];
  const tipText = (i: number) =>
    `${labelFor(labels[i], weekly)}${labelNote?.(i) ? ` (${labelNote(i)})` : ""}: ` +
    rows(i).map((r) => `${r.label} ${r.value === null || r.value === undefined ? "none" : format(r.value)}`).join(", ") +
    (markers?.values[i] ? `, ${markers.values[i] === "good" ? markers.good : markers.bad}` : "");

  return (
    <figure className="chart">
      <h3>{title}</h3>
      {caption && <p className="chart-caption muted small">{caption}</p>}
      <Legend bars={bars} lines={lines} markers={markers} reference={reference} />
      <div className="chart-plot" ref={ref}>
        {!hasData && empty ? (
          <p className="chart-empty">{empty}</p>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`${title}. ${summary}`}
              tabIndex={0}
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive((a) => a ?? n - 1)}
              onBlur={() => setActive(null)}
              onKeyDown={onKey}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} />
                  <text x={margin.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                    {tickText(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((i) => (
                <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"} dx={i === 0 && n > 1 ? -slot / 2 + 2 : i === n - 1 && n > 1 ? slot / 2 - 2 : 0}>
                  {shortDay(labels[i])}
                </text>
              ))}
              {reference && <line className="chart-reference" x1={margin.left} x2={width - margin.right} y1={y(reference.value)} y2={y(reference.value)} />}
              {labels.map((_, i) => {
                let base = 0;
                let first = true;
                const drawn = bars.filter((b) => (b.values[i] ?? 0) > 0);
                return drawn.map((b, k) => {
                  const v = b.values[i] ?? 0;
                  const y0 = y(base);
                  const y1 = y(base + v);
                  base += v;
                  // The 2px surface gap between stacked segments comes off the bottom of every segment but the lowest.
                  const h = Math.max(0.5, y0 - y1 - (first ? 0 : GAP));
                  first = false;
                  const isTop = k === drawn.length - 1;
                  return isTop ? (
                    <path key={b.key} d={topRounded(x(i) - barW / 2, y1, barW, h, RADIUS)} style={{ fill: b.color }} opacity={active === null || active === i ? 1 : 0.55} />
                  ) : (
                    <rect key={b.key} x={x(i) - barW / 2} y={y1} width={barW} height={h} style={{ fill: b.color }} opacity={active === null || active === i ? 1 : 0.55} />
                  );
                });
              })}
              {lines.map((l) => {
                const points = l.values.map((v, i) => (v === null ? null : { x: x(i), y: y(v) }));
                const dots = l.kind !== "average" && l.kind !== "previous";
                const path = linePath(l.connect ? points.filter((p) => p !== null) : points);
                return (
                  <g key={l.key}>
                    <path d={path} fill="none" style={{ stroke: l.color }} strokeWidth={l.kind === "previous" ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
                    {points.map((p, i) => {
                      // A dot where a point would otherwise be invisible (no neighbour to join), on every run of a joined-up
                      // series (each is a real run), and on every point of a short series.
                      const alone = p && l.values[i - 1] == null && l.values[i + 1] == null;
                      if (!p || !(alone || l.connect || (dots && n <= 45))) return null;
                      return <circle key={i} cx={p.x} cy={p.y} r={4} style={{ fill: l.color, stroke: "var(--card)" }} strokeWidth={2} />;
                    })}
                  </g>
                );
              })}
              {markers &&
                lines[0] &&
                markers.values.map((m, i) => {
                  const v = lines[0].values[i];
                  if (!m || v === null) return null;
                  return <circle key={`m${i}`} cx={x(i)} cy={y(v)} r={5} style={{ fill: m === "good" ? "var(--ok)" : "var(--bad)", stroke: "var(--card)" }} strokeWidth={2} />;
                })}
              {active !== null && <line className="chart-cross" x1={x(active)} x2={x(active)} y1={margin.top} y2={margin.top + plotH} />}
              {/* The whole plot is the hit target: the pointer only has to be near a day, never on a 2px line. */}
              <rect x={margin.left} y={margin.top} width={plotW} height={plotH} fill="transparent" />
            </svg>
            {active !== null && (
              <div
                className="chart-tooltip"
                aria-hidden="true"
                style={x(active) > width * 0.6 ? { right: width - x(active) + 12 } : { left: x(active) + 12 }}
              >
                <div className="tip-title">
                  {labelFor(labels[active], weekly)}
                  {labelNote?.(active) ? ` · ${labelNote(active)}` : ""}
                </div>
                {rows(active).map((r) => (
                  <div className="tip-row" key={r.key}>
                    <span className={`chart-key ${r.line ? "is-line" : ""}`} style={{ background: r.color }} />
                    <strong>{r.value === null || r.value === undefined ? "—" : format(r.value)}</strong>
                    <span>{r.label}</span>
                  </div>
                ))}
                {markers?.values[active] && <div className="tip-row">{markers.values[active] === "good" ? `✓ ${markers.good}` : `✗ ${markers.bad}`}</div>}
              </div>
            )}
            <p className="sr-only" aria-live="polite">
              {active !== null ? tipText(active) : ""}
            </p>
          </>
        )}
      </div>
      {hasData && (
        <details className="chart-table ux-fold">
          <summary>Show the numbers</summary>
          <div className="table-scroll">
            <table className="board">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th>{weekly ? "Week of" : "Day"}</th>
                  {rows(0).map((r) => (
                    <th key={r.key} className="num">
                      {r.label}
                    </th>
                  ))}
                  {markers && <th>Gate</th>}
                </tr>
              </thead>
              <tbody>
                {labels.map((day, i) => (
                  <tr key={day}>
                    <td className="when">
                      {shortDay(day)}
                      {labelNote?.(i) ? ` (${labelNote(i)})` : ""}
                    </td>
                    {rows(i).map((r) => (
                      <td key={r.key} className="num">
                        {r.value === null || r.value === undefined ? "—" : format(r.value)}
                      </td>
                    ))}
                    {markers && <td>{markers.values[i] === "good" ? markers.good : markers.values[i] === "bad" ? markers.bad : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}

/** A tiny trend line for a card: decoration only (the card's text carries the numbers). */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => ({ x: (i / (values.length - 1)) * 100, y: 22 - (v / max) * 20 }));
  return (
    <svg className="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={linePath(points)} fill="none" style={{ stroke: "var(--viz-1)" }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export type FunnelBar = { label: string; count: number; note?: string; definition?: string };

/** Steps as bars, each as long as its share of the first step: the same rows as the MCP funnel, with conversion under each label. */
export function FunnelChart({ title, steps }: { title: string; steps: FunnelBar[] }) {
  const first = steps[0]?.count ?? 0;
  return (
    <div role="group" aria-label={title}>
      {steps.map((s) => (
        <div key={s.label} className="funnel-row" title={s.definition}>
          <span className="funnel-step">
            {s.label}
            {s.note && <small>{s.note}</small>}
          </span>
          <div className="funnel-track" aria-hidden="true">
            <div className="funnel-fill" style={{ width: `${first ? Math.max(s.count ? 1.5 : 0, (s.count / first) * 100) : 0}%` }} />
          </div>
          <strong className="num">{s.count.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}
