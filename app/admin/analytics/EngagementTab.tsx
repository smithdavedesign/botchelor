"use client";

import { useEffect, useState } from "react";
import { bucket, shortDay, type Interval } from "@/lib/chart";
import type { CountRow, Engagement, PageRow, SourceRow } from "@/lib/engagement";
import { TimeChart } from "./charts";
import type { AdminFetch } from "./ProductTab";
import SortableTable, { type Column } from "./SortableTable";

type Host = "all" | "show" | "after_dark";
const HOSTS: Record<Host, string> = { all: "Both sites", show: "The show", after_dark: "After Dark" };

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const secs = (s: number | null) => (s == null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
const vs = (now: number, before: number) => {
  if (!before) return now ? "new this period" : "none before either";
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% against ${before.toLocaleString("en-US")} before`;
};

const countColumns = (label: string): Column<CountRow>[] => [
  { key: "key", label, value: (r) => r.key },
  { key: "count", label: "Count", value: (r) => r.count, numeric: true },
  { key: "visitors", label: "Visitors", value: (r) => r.visitors, numeric: true },
];
const pageColumns: Column<PageRow>[] = [
  { key: "path", label: "Page", value: (r) => r.path },
  { key: "views", label: "Views", value: (r) => r.views, numeric: true },
  { key: "visitors", label: "Visitors", value: (r) => r.visitors, numeric: true },
  { key: "avg_seconds", label: "Time per view", value: (r) => r.avg_seconds, render: (r) => secs(r.avg_seconds), numeric: true, title: "Visible time only, added up across a view's beats" },
  { key: "avg_scroll", label: "Scrolled", value: (r) => r.avg_scroll, render: (r) => (r.avg_scroll == null ? "—" : `${r.avg_scroll}%`), numeric: true, title: "How far down the page, on average" },
];
const sourceColumns: Column<SourceRow>[] = [
  { key: "source", label: "Source", value: (r) => r.source },
  { key: "sessions", label: "Visits", value: (r) => r.sessions, numeric: true },
  { key: "visitors", label: "Visitors", value: (r) => r.visitors, numeric: true },
  { key: "engaged", label: "Clicked", value: (r) => r.engaged, numeric: true, title: "Visitors who clicked anything" },
  { key: "created", label: "Made a character", value: (r) => r.created, numeric: true },
  { key: "signups", label: "Signed up", value: (r) => r.signups, numeric: true },
];

/**
 * Engagement: the site's own beacon (lib/engagement.ts), for the page's date range and our-traffic choice. Who came,
 * from where, what they opened and clicked, how long they stayed, and how far they got toward a date.
 */
export default function EngagementTab({ from, to, includeOurs, interval, adminFetch }: { from: string; to: string; includeOurs: boolean; interval: Interval; adminFetch: AdminFetch }) {
  const [host, setHost] = useState<Host>("all");
  const [data, setData] = useState<Engagement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    adminFetch(`/api/admin/engagement?from=${from}&to=${to}&host=${host}${includeOurs ? "&include_ours=1" : ""}`)
      .then(async (res) => {
        if (!live) return;
        if (res.ok) {
          setData(await res.json());
          setError(null);
        } else setError(`The engagement numbers didn't load (${res.status}).`);
      })
      .catch(() => live && setError("The engagement numbers didn't load (network error)."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [adminFetch, from, to, host, includeOurs]);

  const hostPicker = (
    <div className="segmented" role="group" aria-label="Which site">
      {(Object.keys(HOSTS) as Host[]).map((h) => (
        <button key={h} type="button" className="segmented-tab" aria-pressed={host === h} onClick={() => setHost(h)}>
          {HOSTS[h]}
        </button>
      ))}
    </div>
  );
  if (!data) return <>{hostPicker}<p className={error ? "error" : "muted"}>{error ?? (loading ? "Loading…" : "Nothing loaded yet.")}</p></>;

  const t = data.totals;
  const visitors = bucket(data.days, data.daily.map((d) => d.visitors), interval, "sum");
  const views = bucket(data.days, data.daily.map((d) => d.page_views), interval, "sum");
  const busiest = data.daily.reduce((b, d) => (d.visitors > b.visitors ? d : b), { day: "", visitors: 0, sessions: 0, page_views: 0 });
  return (
    <>
      {hostPicker}
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        From the site&apos;s own beacon (every page, click and conversion; never anything typed). Bots, automated browsers and the owner&apos;s browsers
        never send, and our own accounts are left out unless you include them. It started on 2026-10-31: there&apos;s nothing before that.
      </p>
      <div className="kpi-grid">
        <div className="kpi" title="Distinct browsers with any event in the range">
          <span className="kpi-label">Visitors</span>
          <span className="kpi-value">{num(t.visitors)}</span>
          <span className="kpi-delta is-quiet">{vs(t.visitors, data.previous.visitors)}</span>
          <span className="kpi-sub">{num(t.new_visitors)} new</span>
        </div>
        <div className="kpi" title="Visits: a tab's run of pages, ended by half an hour idle">
          <span className="kpi-label">Visits</span>
          <span className="kpi-value">{num(t.sessions)}</span>
          <span className="kpi-delta is-quiet">{vs(t.sessions, data.previous.sessions)}</span>
          <span className="kpi-sub">{t.pages_per_session ?? "—"} pages a visit</span>
        </div>
        <div className="kpi" title="Every page opened, including moves inside the app">
          <span className="kpi-label">Page views</span>
          <span className="kpi-value">{num(t.page_views)}</span>
          <span className="kpi-delta is-quiet">{vs(t.page_views, data.previous.page_views)}</span>
        </div>
        <div className="kpi" title="Visible time per visit, added up across its pages">
          <span className="kpi-label">Time per visit</span>
          <span className="kpi-value">{secs(t.avg_session_seconds)}</span>
          <span className="kpi-sub">{t.bounce_rate == null ? "" : `${t.bounce_rate}% left after one page without clicking`}</span>
        </div>
      </div>

      <TimeChart
        title="Visitors"
        summary={`${num(t.visitors)} visitors and ${num(t.page_views)} page views in these days.${busiest.visitors ? ` The busiest day was ${shortDay(busiest.day)}, with ${busiest.visitors}.` : ""}`}
        labels={visitors.labels}
        weekly={interval === "week"}
        labelNote={(i) => (visitors.partial[i] ? "partial week" : null)}
        bars={[{ key: "visitors", label: "Visitors", color: "var(--viz-1)", values: visitors.values }]}
        lines={[{ key: "views", label: "Page views", color: "var(--viz-2)", values: views.values }]}
        empty="No visitors in these days yet."
      />

      <h2>The first visit, step by step</h2>
      <p className="muted small">Each step: visitors in the range who did it, and their share of everyone who opened a page.</p>
      <SortableTable
        caption="Funnel"
        csvName="engagement-funnel"
        rows={data.funnel}
        rowKey={(r) => r.key}
        columns={[
          { key: "label", label: "Step", value: (r) => r.label },
          { key: "visitors", label: "Visitors", value: (r) => r.visitors, numeric: true },
          { key: "of_first", label: "Of visitors", value: (r) => r.of_first, render: (r) => (r.of_first == null ? "—" : `${r.of_first}%`), numeric: true },
        ]}
      />

      <h2>Where they came from</h2>
      <SortableTable caption="Sources" csvName="engagement-sources" rows={data.sources} rowKey={(r) => r.source} columns={sourceColumns} initialSort={{ key: "sessions", dir: "desc" }} />
      {data.campaigns.length > 0 && (
        <SortableTable caption="Tagged links (utm source / medium / campaign / content)" csvName="engagement-campaigns" rows={data.campaigns} rowKey={(r) => r.key} columns={countColumns("Campaign")} />
      )}
      <SortableTable caption="Landing pages" csvName="engagement-landing" rows={data.landing} rowKey={(r) => r.key} columns={countColumns("First page")} limit={10} />

      <h2>Pages</h2>
      <SortableTable caption="Pages" csvName="engagement-pages" rows={data.pages} rowKey={(r) => r.path} columns={pageColumns} initialSort={{ key: "views", dir: "desc" }} limit={20} />

      <h2>What they did</h2>
      <SortableTable caption="Events" csvName="engagement-events" rows={data.events} rowKey={(r) => r.key} columns={countColumns("Event")} limit={20} />
      <SortableTable caption="Clicks (what · where on the page)" csvName="engagement-clicks" rows={data.clicks} rowKey={(r) => r.key} columns={countColumns("Clicked")} limit={20} />
      {data.outbound.length > 0 && <SortableTable caption="Links out" csvName="engagement-outbound" rows={data.outbound} rowKey={(r) => r.key} columns={countColumns("Site")} />}

      <h2>Who</h2>
      <SortableTable caption="Devices" csvName="engagement-devices" rows={data.devices} rowKey={(r) => r.key} columns={countColumns("Device")} />
      <SortableTable caption="Countries" csvName="engagement-countries" rows={data.countries} rowKey={(r) => r.key} columns={countColumns("Country")} limit={10} />
    </>
  );
}
