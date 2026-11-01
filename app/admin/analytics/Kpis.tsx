"use client";

import type { ReactNode } from "react";
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

/**
 * A card: its label, the value, the change and the previous value. A caveat (a note, or what the segment filter doesn't
 * cover) sits behind an ⓘ by the label and in "What each number means", not on the card (2026-10-31 UX audit, E12:
 * a five-line caveat made the grid ragged).
 */
export function KpiCard({ kpi, segment, sharedNotes }: { kpi: Kpi; segment: Segment; sharedNotes?: ReadonlySet<string> }) {
  const change = describeChange(kpi);
  const value = kpi.current === null ? "—" : kpi.format === "percent" ? percent(kpi.current) : kpi.current.toLocaleString("en-US");
  const caveat = kpiCaveat(kpi, segment, sharedNotes);
  const base = kpi.base ? `of ${kpi.base.current.toLocaleString("en-US")} ${kpi.base.unit}` : null;
  return (
    <div className="kpi" title={kpi.definition}>
      <span className="kpi-label">
        {kpi.label}
        {caveat && (
          <details className="info-tip">
            <summary aria-label={`About ${kpi.label}`}>ⓘ</summary>
            <span className="info-tip-body muted small">{caveat}</span>
          </details>
        )}
      </span>
      <span className="kpi-value">{value}</span>
      <span className={`kpi-delta is-${change.tone}`}>{change.text}</span>
      {(kpi.sub || base) && <span className="kpi-sub">{[base, kpi.sub].filter(Boolean).join(" · ")}</span>}
      {kpi.spark && <Sparkline values={kpi.spark} />}
    </div>
  );
}

/** A card's caveat in words: its own note (unless several cards share it) and what the segment filter doesn't cover. */
export function kpiCaveat(kpi: Kpi, segment: Segment, sharedNotes?: ReadonlySet<string>): string | null {
  const scopeNote = segment !== "all" && kpi.scope !== "segment" ? SCOPE_NOTE[kpi.scope] : null;
  // A note several cards share (the launch-day caveat) is said once, in the fold, instead.
  const note = kpi.note && !sharedNotes?.has(kpi.note) ? kpi.note : null;
  return [note, scopeNote].filter(Boolean).join(" ") || null;
}

/**
 * The cards, then what each one means (for touch screens, where a card's title tooltip never shows): `explain` (how a
 * change is judged), the notes several cards share, and each card's definition and caveat.
 */
export function KpiGrid({ kpis, segment, explain }: { kpis: Kpi[]; segment: Segment; explain?: ReactNode }) {
  const counts = new Map<string, number>();
  for (const k of kpis) if (k.note) counts.set(k.note, (counts.get(k.note) ?? 0) + 1);
  const shared = new Set([...counts].filter(([, n]) => n > 1).map(([note]) => note));
  return (
    <>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} segment={segment} sharedNotes={shared} />
        ))}
      </div>
      <details className="kpi-definitions ux-fold">
        <summary className="small">What each number means</summary>
        {explain && <p className="muted small">{explain}</p>}
        {[...shared].map((note) => (
          <p key={note} className="kpi-shared-note muted small">
            {note}
          </p>
        ))}
        <dl className="small">
          {kpis.map((k) => {
            const caveat = kpiCaveat(k, segment, shared);
            return (
              <div key={k.key}>
                <dt>
                  <strong>{k.label}</strong>
                </dt>
                <dd className="muted">
                  {k.definition}
                  {caveat ? ` ${caveat}` : ""}
                </dd>
              </div>
            );
          })}
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
