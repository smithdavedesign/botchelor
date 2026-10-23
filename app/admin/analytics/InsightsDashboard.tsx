"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { addDays, dayDiff, isDay, isoDay, shortDay, type Interval } from "@/lib/chart";
import type { Insights, Segment } from "@/lib/insights";
import AgentsTab from "./AgentsTab";
import OverviewTab from "./OverviewTab";
import ProductTab from "./ProductTab";
import QualityTab from "./QualityTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "product", label: "Product" },
  { key: "agents", label: "Agents" },
  { key: "quality", label: "Quality" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const PRESETS = ["7", "30", "90"] as const;
type Preset = (typeof PRESETS)[number];
const SEGMENT_LABELS: Record<Segment, string> = { all: "All", people: "People", agents: "Agents (MCP)", house: "House" };
/** The longest custom range (lib/insights.ts MAX_RANGE_DAYS holds the server to it too). */
const MAX_DAYS = 365;
/** Past this many days the charts go weekly unless asked otherwise. */
const WEEKLY_FROM = 92;
const STORAGE_KEY = "bz_frontier";

export type Filters = { tab: Tab; preset: Preset | "custom"; from: string; to: string; segment: Segment; ours: boolean; interval: Interval | "auto" };

/** The filters from the page's address (a shared link opens on the same view); anything missing or wrong is the default. */
export function readFilters(params: Pick<URLSearchParams, "get">, today: string): Filters {
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "overview";
  const range = params.get("range");
  const segment = (Object.keys(SEGMENT_LABELS) as Segment[]).find((s) => s === params.get("segment")) ?? "all";
  const interval = params.get("interval") === "day" || params.get("interval") === "week" ? (params.get("interval") as Interval) : "auto";
  const ours = params.get("include_ours") === "1";
  const from = params.get("from");
  const to = params.get("to");
  if (range === "custom" && isDay(from) && isDay(to)) {
    let [f, t] = from <= to ? [from, to] : [to, from];
    if (t > today) t = today;
    if (f > t) f = t;
    if (dayDiff(f, t) + 1 > MAX_DAYS) f = addDays(t, -(MAX_DAYS - 1));
    return { tab, preset: "custom", from: f, to: t, segment, ours, interval };
  }
  const preset = PRESETS.find((p) => p === range) ?? "30";
  return { tab, preset, from: addDays(today, -(Number(preset) - 1)), to: today, segment, ours, interval };
}

/** The address for a view: only what differs from the default, so the plain page stays /admin/analytics. */
export function filtersQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tab !== "overview") p.set("tab", f.tab);
  if (f.preset === "custom") {
    p.set("range", "custom");
    p.set("from", f.from);
    p.set("to", f.to);
  } else if (f.preset !== "30") p.set("range", f.preset);
  if (f.segment !== "all") p.set("segment", f.segment);
  if (f.ours) p.set("include_ours", "1");
  if (f.interval !== "auto") p.set("interval", f.interval);
  return p.toString();
}

const savedKey = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return ""; // private mode
  }
};

/** A fetch with the saved admin password, if there is one (a signed-in admin account needs none). */
const adminFetch = (path: string) => {
  const key = savedKey();
  return fetch(path, { headers: key ? { "x-frontier-key": key } : {} });
};

/**
 * The analytics page (owner-only): one row of filters that scopes every tab, kept in the address, and four tabs. It
 * signs in like the other admin panels (the saved admin password, a signed-in admin account, or a box to enter it).
 */
export default function InsightsDashboard() {
  const params = useSearchParams();
  const [today] = useState(() => isoDay(new Date()));
  const [filters, setFilters] = useState<Filters>(() => readFilters(params, today));
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const request = useRef(0);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, product: null, agents: null, quality: null });

  const { from, to, segment, ours } = filters;
  const days = dayDiff(from, to) + 1;
  const interval: Interval = filters.interval === "auto" ? (days > WEEKLY_FROM ? "week" : "day") : filters.interval;

  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = filtersQuery(next);
    // replaceState keeps Next's router in step without a navigation; the view is kept, not stacked in history.
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }

  const insightsPath = useCallback(
    (fresh: boolean) => `/api/admin/insights?${new URLSearchParams({ from, to, segment, ...(ours ? { include_ours: "1" } : {}), ...(fresh ? { fresh: "1" } : {}) })}`,
    [from, to, segment, ours],
  );

  const load = useCallback(
    async (fresh = false) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const res = await adminFetch(insightsPath(fresh));
        if (id !== request.current) return; // a newer range was asked for meanwhile
        if (res.status === 403) {
          setNeedsPassword(true);
          return;
        }
        if (!res.ok) {
          setError(`The overview didn't load (${res.status}).`);
          return;
        }
        setData(await res.json());
        setNeedsPassword(false);
      } catch {
        if (id === request.current) setError("Network error.");
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [insightsPath],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    const key = password.trim();
    try {
      const res = await fetch(insightsPath(false), { headers: { "x-frontier-key": key } });
      if (!res.ok) {
        setError(res.status === 403 ? "That password didn't work." : `The overview didn't load (${res.status}).`);
        return;
      }
      // Saved only once it works, the same way the other admin panels read it, so one sign-in covers them all.
      try {
        localStorage.setItem(STORAGE_KEY, key);
      } catch {
        /* private mode: this page still works until it's closed */
      }
      setPassword("");
      setError(null);
      setData(await res.json());
      // The tabs mount again now, and load their own data with the saved password.
      setNeedsPassword(false);
    } catch {
      setError("Network error.");
    }
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: TABS.length - 1 - index };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = TABS[(index + moves[e.key] + TABS.length) % TABS.length].key;
    update({ tab: next });
    tabRefs.current[next]?.focus();
  }

  if (needsPassword) {
    return (
      <section className="card">
        <form onSubmit={signIn}>
          <label htmlFor="admin-password">Admin password</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="small" disabled={!password.trim()}>
            Sign in
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  const tab = filters.tab;
  return (
    <section>
      <div className="insights-filters" role="group" aria-label="Filters for every tab">
        <div className="filter-group">
          <span className="filter-label" id="range-label">
            Dates
          </span>
          <div className="segmented" role="group" aria-labelledby="range-label">
            {[...PRESETS, "custom" as const].map((p) => (
              <button
                key={p}
                type="button"
                className="segmented-tab"
                aria-pressed={filters.preset === p}
                onClick={() => update(p === "custom" ? { preset: "custom" } : { preset: p, from: addDays(today, -(Number(p) - 1)), to: today })}
              >
                {p === "custom" ? "Custom" : `${p} days`}
              </button>
            ))}
          </div>
        </div>
        {filters.preset === "custom" && (
          <div className="custom-range">
            <div>
              <label htmlFor="range-from">From</label>
              <input
                id="range-from"
                type="date"
                value={from}
                min={addDays(to, -(MAX_DAYS - 1))}
                max={to}
                onChange={(e) => isDay(e.target.value) && e.target.value <= to && update({ from: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="range-to">To</label>
              <input id="range-to" type="date" value={to} min={from} max={today} onChange={(e) => isDay(e.target.value) && e.target.value >= from && e.target.value <= today && update({ to: e.target.value })} />
            </div>
          </div>
        )}
        <div className="filter-group">
          <span className="filter-label" id="segment-label">
            Who
          </span>
          <div className="segmented" role="group" aria-labelledby="segment-label">
            {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => (
              <button key={s} type="button" className="segmented-tab" aria-pressed={segment === s} onClick={() => update({ segment: s })}>
                {SEGMENT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <label htmlFor="chart-interval">Charts</label>
          <select id="chart-interval" value={filters.interval} onChange={(e) => update({ interval: e.target.value as Filters["interval"] })}>
            <option value="auto">{days > WEEKLY_FROM ? "By week (auto)" : "By day (auto)"}</option>
            <option value="day">By day</option>
            <option value="week">By week</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={ours} onChange={(e) => update({ ours: e.target.checked })} />
          Include our own traffic
        </label>
        <button type="button" className="secondary small" onClick={() => void load(true)} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="muted small insights-range" suppressHydrationWarning>
        {shortDay(from)} – {shortDay(to)} ({days} UTC {days === 1 ? "day" : "days"}), against the {days === 1 ? "day" : `${days} days`} before ·{" "}
        {segment === "all" ? "everyone" : SEGMENT_LABELS[segment]} · our own traffic {ours ? "included" : "left out"}
        {data ? ` · as of ${new Date(data.generated_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="tabs" role="tablist" aria-label="Analytics sections">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[t.key] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={tab === t.key ? `panel-${t.key}` : undefined}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => update({ tab: t.key })}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} aria-busy={loading} className={`insights-body${loading && data ? " is-loading" : ""}`}>
        {tab === "agents" ? (
          <AgentsTab insights={data} to={to} days={days} includeOurs={ours} interval={interval} adminFetch={adminFetch} />
        ) : !data ? (
          <p className="muted">{loading ? "Loading…" : "Nothing loaded yet."}</p>
        ) : tab === "overview" ? (
          <OverviewTab data={data} interval={interval} />
        ) : tab === "product" ? (
          <ProductTab data={data} interval={interval} adminFetch={adminFetch} />
        ) : (
          <QualityTab data={data} interval={interval} adminFetch={adminFetch} />
        )}
      </div>
    </section>
  );
}
