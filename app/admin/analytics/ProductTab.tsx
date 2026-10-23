"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { percent, shortDay, type Interval } from "@/lib/chart";
import type { CharacterRow, CohortRow, Insights, VenueRow } from "@/lib/insights";
import type { RealUse as RealUseData } from "@/lib/real-metrics";
import { ENDING_LABELS } from "@/lib/rules";
import { CountChart } from "./CountChart";
import { ENDING_COLORS } from "./OverviewTab";
import RealUse from "./RealUse";
import SortableTable, { type Column } from "./SortableTable";
import CharacterName from "@/app/CharacterName";

export type AdminFetch = (path: string) => Promise<Response>;

const KIND_LABEL: Record<CharacterRow["kind"], string> = { house: "house", people: "person's", agents: "agent's" };

/** A rate over a small base says how small instead of a percentage that would mean nothing. */
const rateText = (num: number, den: number, minN: number) => (den === 0 ? "—" : den < minN ? `${num} of ${den}` : `${percent(num / den)} (${num}/${den})`);

/** The product: what gets made, booked and sent, the top characters and venues, who comes back, and Real use. */
export default function ProductTab({ data, interval, adminFetch }: { data: Insights; interval: Interval; adminFetch: AdminFetch }) {
  const s = data.series;
  return (
    <>
      <h2>Making and dating</h2>
      <div className="chart-grid-2">
        <CountChart title="Characters created" data={data} interval={interval} unit="characters" stacks={[{ key: "characters", label: "characters", color: "var(--viz-1)", values: s.characters.current }]} previous={s.characters.previous} />
        <CountChart title="Accounts created" data={data} interval={interval} unit="accounts" stacks={[{ key: "accounts", label: "accounts", color: "var(--viz-2)", values: s.accounts.current }]} previous={s.accounts.previous} caption="People only: the segment doesn't change it." />
        <CountChart title="Texts between dates" data={data} interval={interval} unit="texts" stacks={[{ key: "texts", label: "texts", color: "var(--viz-1)", values: s.texts.current }]} previous={s.texts.previous} />
        <CountChart title="Swipes" data={data} interval={interval} unit="swipes" stacks={[{ key: "swipes", label: "swipes", color: "var(--viz-2)", values: s.swipes.current }]} previous={s.swipes.previous} />
        <CountChart title="Matches" data={data} interval={interval} unit="matches" stacks={[{ key: "matches", label: "matches", color: "var(--viz-3)", values: s.matches.current }]} previous={s.matches.previous} />
      </div>

      <h2>How dates end</h2>
      <EndingsTable data={data} />

      <h2>Top characters</h2>
      <CharactersTable rows={data.characters} minN={data.min_n} />

      <h2>Venues</h2>
      <VenuesTable rows={data.venues} minN={data.min_n} />

      <h2>Who comes back</h2>
      <RetentionTable rows={data.retention.rows} weeks={data.retention.weeks} minN={data.min_n} />

      <RealUseSection adminFetch={adminFetch} />
    </>
  );
}

function EndingsTable({ data }: { data: Insights }) {
  type Row = Insights["endings"][number];
  const total = data.endings.reduce((n, e) => n + e.current, 0);
  const before = data.endings.reduce((n, e) => n + e.previous, 0);
  const columns: Column<Row>[] = [
    {
      key: "ending",
      label: "Ending",
      value: (r) => ENDING_LABELS[r.ending],
      render: (r) => (
        <span className="swatch-label">
          <span className="chart-key" style={{ background: ENDING_COLORS[r.ending] }} aria-hidden="true" />
          {ENDING_LABELS[r.ending]}
        </span>
      ),
    },
    { key: "current", label: "Dates", numeric: true, value: (r) => r.current },
    { key: "share", label: "Share", numeric: true, value: (r) => (total ? r.current / total : null), render: (r) => (total ? percent(r.current / total) : "—") },
    { key: "previous", label: `Previous ${data.query.days} days`, numeric: true, value: (r) => r.previous },
    { key: "previous_share", label: "Share then", numeric: true, value: (r) => (before ? r.previous / before : null), render: (r) => (before ? percent(r.previous / before) : "—") },
  ];
  return (
    <SortableTable
      caption="How dates end"
      csvName="endings"
      columns={columns}
      rows={data.endings}
      rowKey={(r) => r.ending}
      note="The ending the engine decided, for the dates booked in each period (the segment applies)."
    />
  );
}

function CharactersTable({ rows, minN }: { rows: CharacterRow[]; minN: number }) {
  const columns: Column<CharacterRow>[] = [
    {
      key: "name",
      label: "Character",
      value: (r) => r.name,
      className: "wrap",
      render: (r) => (
        <>
          <CharacterName character={{ id: r.id, name: r.name }} />
          {r.private && <span className="muted small"> (private)</span>}
        </>
      ),
    },
    { key: "kind", label: "Whose", value: (r) => KIND_LABEL[r.kind] },
    { key: "dates", label: "Dates", numeric: true, value: (r) => r.dates },
    { key: "aired", label: "Aired", numeric: true, value: (r) => r.aired },
    {
      key: "second",
      label: "Second-date rate",
      numeric: true,
      title: "First dates that aired whose couple booked a second date within 7 days.",
      value: (r) => (r.first_aired ? r.followed / r.first_aired : null),
      render: (r) => rateText(r.followed, r.first_aired, minN),
    },
    { key: "reviews", label: "Reviews", numeric: true, title: "Reviews posted in the period.", value: (r) => r.reviews },
    { key: "stars", label: "Stars", numeric: true, value: (r) => r.stars, render: (r) => (r.stars === null ? "—" : `${r.stars.toFixed(1)} / 5`) },
  ];
  return (
    <SortableTable
      caption="Top characters"
      csvName="top-characters"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      initialSort={{ key: "dates", dir: "desc" }}
      limit={15}
      note="The 50 characters with the most dates in the period (both sides of a date count). The segment picks whose characters."
      empty="No dates in this period."
    />
  );
}

function VenuesTable({ rows, minN }: { rows: VenueRow[]; minN: number }) {
  const total = rows.reduce((n, r) => n + r.dates, 0);
  const columns: Column<VenueRow>[] = [
    { key: "name", label: "Venue", value: (r) => r.name, className: "wrap" },
    { key: "dates", label: "Dates", numeric: true, value: (r) => r.dates },
    { key: "share", label: "Share", numeric: true, value: (r) => (total ? r.dates / total : null), render: (r) => (total ? percent(r.dates / total) : "—") },
    { key: "second_date", label: "Second date", numeric: true, value: (r) => r.endings.second_date },
    { key: "friends", label: "Friends", numeric: true, value: (r) => r.endings.friends },
    { key: "disaster", label: "Disaster", numeric: true, value: (r) => r.endings.disaster },
    {
      key: "rate",
      label: "Second-date rate",
      numeric: true,
      value: (r) => (r.first_aired ? r.followed / r.first_aired : null),
      render: (r) => rateText(r.followed, r.first_aired, minN),
    },
  ];
  return (
    <SortableTable
      caption="Venues"
      csvName="venues"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.venue}
      initialSort={{ key: "dates", dir: "desc" }}
      note="Where the period's dates were, by the ending the engine decided. A place a couple picked themselves counts as Their place or Somewhere new."
      empty="No dates in this period."
    />
  );
}

/** The share for one cohort and week, as a cell: shaded by the share once the cohort is big enough to read. */
function cohortCell(row: CohortRow, k: number, minN: number): { text: string; className?: string; style?: CSSProperties } {
  const n = row.active[k];
  if (n === null) return { text: "—", className: "cohort-cell is-pending" };
  if (row.size < minN) return { text: `${n}/${row.size}`, className: "cohort-cell is-pending" };
  return { text: percent(n / row.size), className: "cohort-cell", style: { "--share": n / row.size } as CSSProperties };
}

function RetentionTable({ rows, weeks, minN }: { rows: CohortRow[]; weeks: number; minN: number }) {
  const columns: Column<CohortRow>[] = [
    { key: "week", label: "First seen, week of", value: (r) => r.week, render: (r) => shortDay(r.week) },
    { key: "size", label: "People", numeric: true, value: (r) => r.size },
    ...Array.from({ length: weeks }, (_, i): Column<CohortRow> => {
      const k = i + 1;
      return {
        key: `w${k}`,
        label: `Week ${k}`,
        numeric: true,
        value: (r) => (r.active[k] === null ? null : r.active[k]! / r.size),
        render: (r) => cohortCell(r, k, minN).text,
        cell: (r) => {
          const c = cohortCell(r, k, minN);
          return { className: c.className, style: c.style };
        },
      };
    }),
  ];
  return (
    <SortableTable
      caption="Weekly retention"
      csvName="retention"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.week}
      initialSort={{ key: "week", dir: "asc" }}
      note={`People first seen in this period, by the week (Monday to Sunday, UTC) they were first seen; each week after, the share who did something stored again. Cohorts under ${minN} show counts, not shares; a week that hasn't come yet shows a dash, and the current week is still filling in.`}
      empty="No new people in this period."
    />
  );
}

/** Real use: fixed 7- and 30-day windows with their own definitions (lib/real-metrics.ts), loaded when this tab opens. */
function RealUseSection({ adminFetch }: { adminFetch: AdminFetch }) {
  const [data, setData] = useState<RealUseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminFetch("/api/admin/real-metrics")
      .then(async (res) => {
        if (!live) return;
        if (res.ok) setData(await res.json());
        else setError(`Real use didn't load (${res.status}).`);
      })
      .catch(() => live && setError("Real use didn't load (network error)."));
    return () => {
      live = false;
    };
  }, [adminFetch]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading Real use…</p>;
  return <RealUse data={data} />;
}
