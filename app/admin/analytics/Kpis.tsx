"use client";

import { percent } from "@/lib/chart";
import type { Insight, Kpi, KpiScope, Segment } from "@/lib/insights";
import { Sparkline } from "./charts";

/** What a card that doesn't follow the segment filter is about, said when a segment is picked. */
const SCOPE_NOTE: Record<Exclude<KpiScope, "segment">, string> = {
  people: "People only, whatever the segment.",
  agents: "Agents only, whatever the segment.",
  admin: "Admin data, not filtered.",
  all: "Everyone, not split by segment.",
};

/**
 * A card's change against the previous period, in words: the direction and size, then whether it means anything
 * (too few to say, within normal variation, or not comparable). The tone colours it only when the change is real;
 * the arrow and the words carry it without colour.
 */
export function describeChange(k: Kpi): { text: string; tone: "up" | "down" | "quiet" } {
  if (k.current === null || k.previous === null) return { text: "no earlier value to compare", tone: "quiet" };
  const shown = (v: number) => (k.format === "percent" ? percent(v) : v.toLocaleString("en-US"));
  if (!k.comparable) return { text: `previous: ${shown(k.previous)} (not comparable)`, tone: "quiet" };
  if (k.verdict.tooFew) return { text: `previous: ${shown(k.previous)} · too few to say`, tone: "quiet" };
  if (k.verdict.direction === "flat") return { text: `same as before (${shown(k.previous)})`, tone: "quiet" };
  const up = k.verdict.direction === "up";
  const arrow = up ? "▲" : "▼";
  const size =
    k.format === "percent"
      ? `${Math.round(Math.abs(k.verdict.change ?? 0) * 100)} pts (${shown(k.previous)} → ${shown(k.current)})`
      : `${Math.abs(k.verdict.change ?? 0).toLocaleString("en-US")}${k.verdict.pct === null ? "" : ` (${Math.round(Math.abs(k.verdict.pct) * 100)}%)`}`;
  return k.verdict.real
    ? { text: `${arrow} ${up ? "up" : "down"} ${size}`, tone: up ? "up" : "down" }
    : { text: `${arrow} ${size}, within normal variation`, tone: "quiet" };
}

export function KpiCard({ kpi, segment, sharedNotes }: { kpi: Kpi; segment: Segment; sharedNotes?: ReadonlySet<string> }) {
  const change = describeChange(kpi);
  const value = kpi.current === null ? "—" : kpi.format === "percent" ? percent(kpi.current) : kpi.current.toLocaleString("en-US");
  const scopeNote = segment !== "all" && kpi.scope !== "segment" ? SCOPE_NOTE[kpi.scope] : null;
  // A note several cards share (the launch-day caveat) is said once above the grid instead.
  const note = kpi.note && !sharedNotes?.has(kpi.note) ? kpi.note : null;
  const base = kpi.base ? `of ${kpi.base.current.toLocaleString("en-US")} ${kpi.base.unit}` : null;
  return (
    <div className="kpi" title={kpi.definition}>
      <span className="kpi-label">{kpi.label}</span>
      <span className="kpi-value">{value}</span>
      <span className={`kpi-delta is-${change.tone}`}>{change.text}</span>
      {(kpi.sub || base) && <span className="kpi-sub">{[base, kpi.sub].filter(Boolean).join(" · ")}</span>}
      {(note || scopeNote) && <span className="kpi-note">{[note, scopeNote].filter(Boolean).join(" ")}</span>}
      {kpi.spark && <Sparkline values={kpi.spark} />}
    </div>
  );
}

/** The cards, then what each one means (for touch screens, where a card's title tooltip never shows). */
export function KpiGrid({ kpis, segment }: { kpis: Kpi[]; segment: Segment }) {
  const counts = new Map<string, number>();
  for (const k of kpis) if (k.note) counts.set(k.note, (counts.get(k.note) ?? 0) + 1);
  const shared = new Set([...counts].filter(([, n]) => n > 1).map(([note]) => note));
  return (
    <>
      {[...shared].map((note) => (
        <p key={note} className="kpi-shared-note muted small">
          {note}
        </p>
      ))}
      <div className="kpi-grid">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} segment={segment} sharedNotes={shared} />
        ))}
      </div>
      <details className="kpi-definitions">
        <summary className="small">What each number means</summary>
        <dl className="small">
          {kpis.map((k) => (
            <div key={k.key}>
              <dt>
                <strong>{k.label}</strong>
              </dt>
              <dd className="muted">{k.definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

const MARK: Record<Insight["tone"], string> = { up: "▲", down: "▼", warn: "!", info: "•" };
const TONE_WORD: Record<Insight["tone"], string> = { up: "Up", down: "Down", warn: "Worth a look", info: "Note" };

/** The plain-sentence callouts at the top of the overview. */
export function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <ul className="insight-list" aria-label="What stands out">
      {insights.map((i) => (
        <li key={i.text} className={`insight is-${i.tone}`}>
          <span className="insight-mark" aria-hidden="true">
            {MARK[i.tone]}
          </span>
          <span>
            <span className="sr-only">{TONE_WORD[i.tone]}: </span>
            {i.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
