"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AgentAnalytics, ClientRow, DayRow, ToolRow } from "@/lib/agent-analytics";
import type { Interval } from "@/lib/chart";
import type { Insights } from "@/lib/insights";
import { CountChart } from "./CountChart";
import type { AdminFetch } from "./ProductTab";
import SortableTable, { type Column } from "./SortableTable";

const KIND_LABEL = { crawler: "crawler", explorer: "explorer", player: "player" } as const;
/** How many crawl-only clients the table shows before "show all". */
const CRAWLERS_SHOWN = 10;
/** How many connections the list shows before "Show all" (players and explorers come first). */
const CONNECTIONS_SHOWN = 30;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const made = (c: { characters: number; dates: number; feedback: number }) =>
  `${count(c.characters, "character")} · ${count(c.dates, "date")} · ${c.feedback} feedback`;
// "Oct 17, 10:31 PM": a table cell, not a sentence.
const short = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * Agents: who connects over MCP and what they do (lib/agent-analytics.ts), for the page's date range and our-traffic
 * choice. A crawler connects and lists the tools; an explorer calls tools that only read; a player changed something.
 */
export default function AgentsTab({
  insights,
  to,
  days,
  includeOurs,
  interval,
  adminFetch,
}: {
  insights: Insights | null;
  to: string;
  days: number;
  includeOurs: boolean;
  interval: Interval;
  adminFetch: AdminFetch;
}) {
  const [data, setData] = useState<AgentAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCrawlers, setShowCrawlers] = useState(false);
  const [allClients, setAllClients] = useState(false);
  const [allConnections, setAllConnections] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    adminFetch(`/api/admin/analytics?days=${days}&to=${to}${includeOurs ? "&include_ours=1" : ""}`)
      .then(async (res) => {
        if (!live) return;
        if (res.ok) {
          setData(await res.json());
          setError(null);
        } else setError(`The MCP numbers didn't load (${res.status}).`);
      })
      .catch(() => live && setError("The MCP numbers didn't load (network error)."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [adminFetch, days, to, includeOurs]);

  const f = data?.funnel;
  // Most clients are directories that connected once or twice: show the ones that called tools, and the busiest
  // crawlers; the rest behind "show all", so the page stays readable.
  const pool = (data?.clients ?? []).filter((c) => includeOurs || !c.ours);
  const activeClients = pool.filter((c) => c.explorer + c.player > 0);
  const crawlerClients = pool.filter((c) => c.explorer + c.player === 0).sort((a, b) => b.sessions - a.sessions);
  const shownClients = [...activeClients, ...(allClients ? crawlerClients : crawlerClients.slice(0, CRAWLERS_SHOWN))];
  const connections = (data?.recent ?? []).filter((s) => (includeOurs || !s.ours) && (showCrawlers || s.kind !== "crawler"));

  return (
    <>
      {insights && (
        <>
          <h2>Connections and tool calls</h2>
          <div className="chart-grid-2">
            <CountChart
              title="MCP connections"
              data={insights}
              interval={interval}
              unit="connections"
              stacks={[{ key: "sessions", label: "connections", color: "var(--viz-2)", values: insights.series.sessions.current }]}
              previous={insights.series.sessions.previous}
              caption="Every MCP session opened, crawlers included, by the day it opened. Agents only: the segment doesn't change it."
            />
            <CountChart
              title="MCP tool calls"
              data={insights}
              interval={interval}
              unit="tool calls"
              stacks={[
                { key: "ok", label: "worked", color: "var(--viz-2)", values: insights.series.calls.ok },
                { key: "error", label: "failed", color: "var(--bad)", values: insights.series.calls.error },
              ]}
              previous={insights.series.calls.previous}
              caption={
                insights.logged_since.mcp_calls
                  ? `Tool calls (not listing or initialize), whether they worked. Logged call by call since ${insights.logged_since.mcp_calls.slice(0, 10)}.`
                  : "Tool calls, whether they worked. None logged yet."
              }
            />
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted small">Loading the MCP numbers…</p>}
      {data && f && (
        <div className={`insights-body${loading ? " is-loading" : ""}`}>
          <h2>Who comes in over MCP</h2>
          <div className="stat-tiles">
            {(
              [
                ["Connections", data.totals.connections],
                ["Clients", data.totals.clients],
                ["Crawlers", data.totals.crawlers],
                ["Explorers", data.totals.explorers],
                ["Players", data.totals.players],
                [includeOurs ? "Ours (counted)" : "Ours (left out)", data.totals.ours],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="stat-tile">
                <strong>{n}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {data.calls_logged_since && (
            <p className="muted small">Tool-by-tool detail since {when(data.calls_logged_since)}; older connections only have a call count.</p>
          )}

          <div className="analytics-grid">
            <div>
              <h3>How far outside agents get</h3>
              {(
                [
                  ["Connected", f.connected],
                  ["Listed or used the tools", f.listed_tools],
                  ["Called a tool", f.called_a_tool],
                  ["Made a character", f.made_a_character],
                  ["Went on a date", f.went_on_a_date],
                  ["Aired a date", f.aired_a_date],
                  ["Sent feedback", f.sent_feedback],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="funnel-row">
                  <span>{label}</span>
                  <div className="funnel-track" aria-hidden>
                    <div className="funnel-fill" style={{ width: `${f.connected ? Math.max(n ? 1.5 : 0, (n / f.connected) * 100) : 0}%` }} />
                  </div>
                  <strong className="num">{n}</strong>
                </div>
              ))}
              <p className="muted small">
                Connections down to calling a tool; agents (distinct identities) from making a character on.
                {includeOurs ? " Our own checks are counted here because the filter includes them." : ""}
              </p>
            </div>
            <div>
              <h3>By day</h3>
              <DaysTable rows={data.days} />
            </div>
          </div>

          <h3>Clients</h3>
          <ClientsTable
            rows={shownClients}
            note={
              <>
                {activeClients.length} clients called tools; {crawlerClients.length} only crawled
                {!allClients && crawlerClients.length > CRAWLERS_SHOWN ? ` (the ${CRAWLERS_SHOWN} busiest shown)` : ""}.{" "}
                <label>
                  <input type="checkbox" checked={allClients} onChange={(e) => setAllClients(e.target.checked)} /> show all {pool.length}
                </label>
              </>
            }
          />

          <h3>Tools outside agents use</h3>
          <ToolsTable rows={data.tools} />

          <h3>Connections</h3>
          <p className="small">
            <label>
              <input type="checkbox" checked={showCrawlers} onChange={(e) => setShowCrawlers(e.target.checked)} /> show crawlers
            </label>
          </p>
          <ul className="list session-list">
            {(allConnections ? connections : connections.slice(0, CONNECTIONS_SHOWN)).map((s) => (
              <li key={s.id} className="small">
                <strong>{KIND_LABEL[s.kind]}</strong> · {s.client}
                {s.version ? ` ${s.version}` : ""}
                {s.ours && <span className="muted"> (ours)</span>} · {short(s.first_seen)} · {count(s.calls, "call")}
                {s.errors ? ` (${s.errors} failed)` : ""} · agent <code title={s.agent_id}>{s.agent_id.slice(0, 8)}</code>
                {s.characters || s.dates || s.feedback ? ` · made ${made(s)}` : ""}
                {s.tools.length > 0 && <div>{s.tools.slice(0, 20).join(" → ")}</div>}
                {s.user_agent && <div className="muted">{s.user_agent}</div>}
              </li>
            ))}
          </ul>
          {connections.length > CONNECTIONS_SHOWN && (
            <button type="button" className="secondary small" onClick={() => setAllConnections((a) => !a)} aria-expanded={allConnections}>
              {allConnections ? `Show the first ${CONNECTIONS_SHOWN}` : `Show all ${connections.length}`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function DaysTable({ rows }: { rows: DayRow[] }) {
  const columns: Column<DayRow>[] = [
    { key: "day", label: "Day", value: (r) => r.day, className: "when" },
    { key: "connections", label: "Connections", numeric: true, value: (r) => r.connections },
    { key: "crawlers", label: "Crawlers", numeric: true, value: (r) => r.crawlers },
    { key: "explorers", label: "Explorers", numeric: true, value: (r) => r.explorers },
    { key: "players", label: "Players", numeric: true, value: (r) => r.players },
    { key: "ours", label: "Ours", numeric: true, value: (r) => r.ours, className: "muted" },
  ];
  return <SortableTable caption="MCP connections by day" csvName="mcp-by-day" columns={columns} rows={rows} rowKey={(r) => r.day} initialSort={{ key: "day", dir: "desc" }} limit={14} />;
}

function ClientsTable({ rows, note }: { rows: ClientRow[]; note: ReactNode }) {
  const columns: Column<ClientRow>[] = [
    {
      key: "client",
      label: "Client",
      value: (r) => r.client,
      className: "wrap",
      render: (c) => (
        <div title={c.user_agent ?? ""}>
          <strong>{c.client}</strong>
          {c.ours && <span className="muted"> (ours)</span>}
          {c.user_agent && <div className="muted small">{c.user_agent.slice(0, 90)}</div>}
          {c.tools.length > 0 && <div className="small">{c.tools.slice(0, 8).join(", ")}</div>}
        </div>
      ),
    },
    { key: "sessions", label: "Connections", numeric: true, value: (r) => r.sessions },
    { key: "crawler", label: "Crawler", numeric: true, value: (r) => r.crawler },
    { key: "explorer", label: "Explorer", numeric: true, value: (r) => r.explorer },
    { key: "player", label: "Player", numeric: true, value: (r) => r.player },
    { key: "tool_calls", label: "Tool calls", numeric: true, value: (r) => r.tool_calls },
    { key: "made", label: "Made", value: (c) => (c.characters || c.dates || c.feedback ? made(c) : null), className: "small" },
    { key: "last_seen", label: "Last seen", value: (r) => r.last_seen, render: (c) => short(c.last_seen), className: "when small" },
  ];
  return <SortableTable caption="MCP clients" csvName="mcp-clients" columns={columns} rows={rows} rowKey={(c) => `${c.client}${c.ours}`} note={note} />;
}

function ToolsTable({ rows }: { rows: ToolRow[] }) {
  const columns: Column<ToolRow>[] = [
    { key: "tool", label: "Tool", value: (r) => r.tool, render: (t) => <code>{t.tool}</code> },
    { key: "calls", label: "Calls", numeric: true, value: (r) => r.calls },
    { key: "agents", label: "Agents", numeric: true, value: (r) => r.agents },
    { key: "errors", label: "Errors", numeric: true, value: (r) => r.errors },
    { key: "error_rate", label: "Error rate", numeric: true, value: (r) => (r.calls ? r.errors / r.calls : null), render: (t) => (t.calls ? `${Math.round((t.errors / t.calls) * 100)}%` : "—") },
    { key: "last_error", label: "Last error", value: (r) => r.last_error, className: "wrap muted small" },
  ];
  return (
    <SortableTable caption="MCP tools" csvName="mcp-tools" columns={columns} rows={rows} rowKey={(t) => t.tool} initialSort={{ key: "calls", dir: "desc" }} limit={15} empty="No tool calls in this window." />
  );
}
