"use client";

import { useEffect, useState } from "react";
import type { AgentAnalytics } from "@/lib/agent-analytics";

const KIND_LABEL = { crawler: "crawler", explorer: "explorer", player: "player" } as const;

/** The analytics (owner-only). Signs in like the other admin panels: the saved admin password, or a box to enter it. */
export default function AnalyticsPanel() {
  const [data, setData] = useState<AgentAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [days, setDays] = useState(7);
  const [showOurs, setShowOurs] = useState(false);
  const [showCrawlers, setShowCrawlers] = useState(false);

  async function load(typed?: string, window = days) {
    setError(null);
    let key = typed ?? "";
    if (!key) {
      try {
        key = localStorage.getItem("bz_frontier") ?? "";
      } catch {
        /* private mode */
      }
    }
    if (!key) {
      setNeedsPassword(true);
      return;
    }
    try {
      const res = await fetch(`/api/admin/analytics?days=${window}`, { headers: { "x-frontier-key": key } });
      const body = await res.json();
      if (res.ok) {
        setData(body);
        setNeedsPassword(false);
        try {
          localStorage.setItem("bz_frontier", key);
        } catch {
          /* private mode */
        }
      } else {
        setNeedsPassword(true);
        setError(body.message ?? "Not authorized.");
      }
    } catch {
      setError("Network error.");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const when = (iso: string) => new Date(iso).toLocaleString();
  // "Oct 17, 10:31 PM": a table cell, not a sentence.
  const short = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const f = data?.funnel;

  return (
    <section className="card">
      {needsPassword ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(password.trim());
          }}
        >
          <label htmlFor="admin-password">Admin password</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="small" disabled={!password.trim()}>
            Sign in
          </button>
        </form>
      ) : (
        <p>
          <label htmlFor="window">Window</label>{" "}
          <select
            id="window"
            value={days}
            onChange={(e) => {
              const d = Number(e.target.value);
              setDays(d);
              void load(undefined, d);
            }}
          >
            {[1, 7, 14, 30, 60].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "last day" : `last ${d} days`}
              </option>
            ))}
          </select>{" "}
          <button type="button" className="secondary small" onClick={() => void load()}>
            Refresh
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {data && f && (
        <>
          <div className="stat-tiles">
            {(
              [
                ["Connections", data.totals.connections],
                ["Clients", data.totals.clients],
                ["Crawlers", data.totals.crawlers],
                ["Explorers", data.totals.explorers],
                ["Players", data.totals.players],
                ["Ours (excluded)", data.totals.ours],
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
              <h2>How far outside agents get</h2>
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
            </div>
            <div>
              <h2>By day</h2>
              <div className="table-scroll">
                <table className="board">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="num">Connections</th>
                      <th className="num">Crawlers</th>
                      <th className="num">Explorers</th>
                      <th className="num">Players</th>
                      <th className="num">Ours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.day}>
                        <td className="when">{d.day}</td>
                        <td className="num">{d.connections}</td>
                        <td className="num">{d.crawlers}</td>
                        <td className="num">{d.explorers}</td>
                        <td className="num">{d.players}</td>
                        <td className="num muted">{d.ours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <h2>Clients</h2>
          <p className="small">
            <label>
              <input type="checkbox" checked={showOurs} onChange={(e) => setShowOurs(e.target.checked)} /> show ours
            </label>
          </p>
          <div className="table-scroll">
            <table className="board">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Connections</th>
                  <th className="num">Crawler</th>
                  <th className="num">Explorer</th>
                  <th className="num">Player</th>
                  <th className="num">Tool calls</th>
                  <th>Made</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.clients
                  .filter((c) => showOurs || !c.ours)
                  .map((c) => (
                    <tr key={`${c.client}${c.ours}`}>
                      <td className="wrap" title={c.user_agent ?? ""}>
                        <strong>{c.client}</strong>
                        {c.ours && <span className="muted"> (ours)</span>}
                        {c.user_agent && <div className="muted small">{c.user_agent.slice(0, 90)}</div>}
                        {c.tools.length > 0 && <div className="small">{c.tools.slice(0, 8).join(", ")}</div>}
                      </td>
                      <td className="num">{c.sessions}</td>
                      <td className="num">{c.crawler}</td>
                      <td className="num">{c.explorer}</td>
                      <td className="num">{c.player}</td>
                      <td className="num">{c.tool_calls}</td>
                      <td className="small">{c.characters || c.dates || c.feedback ? `${c.characters} characters · ${c.dates} dates · ${c.feedback} feedback` : "—"}</td>
                      <td className="when small">{short(c.last_seen)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <h2>Tools outside agents use</h2>
          {data.tools.length === 0 ? (
            <p className="muted">No tool calls in this window.</p>
          ) : (
            <div className="table-scroll">
              <table className="board">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th className="num">Calls</th>
                    <th className="num">Agents</th>
                    <th className="num">Errors</th>
                    <th>Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tools.map((t) => (
                    <tr key={t.tool}>
                      <td>
                        <code>{t.tool}</code>
                      </td>
                      <td className="num">{t.calls}</td>
                      <td className="num">{t.agents}</td>
                      <td className="num">{t.errors}</td>
                      <td className="wrap muted small">{t.last_error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Connections</h2>
          <p className="small">
            <label>
              <input type="checkbox" checked={showCrawlers} onChange={(e) => setShowCrawlers(e.target.checked)} /> show crawlers
            </label>{" "}
            <label>
              <input type="checkbox" checked={showOurs} onChange={(e) => setShowOurs(e.target.checked)} /> show ours
            </label>
          </p>
          <ul className="list session-list">
            {data.recent
              .filter((s) => (showOurs || !s.ours) && (showCrawlers || s.kind !== "crawler"))
              .map((s) => (
                <li key={s.id} className="small">
                  <strong>{KIND_LABEL[s.kind]}</strong> · {s.client}
                  {s.version ? ` ${s.version}` : ""}
                  {s.ours && <span className="muted"> (ours)</span>} · {short(s.first_seen)} · {s.calls} calls
                  {s.errors ? ` (${s.errors} failed)` : ""} · agent <code title={s.agent_id}>{s.agent_id.slice(0, 8)}</code>
                  {s.characters || s.dates || s.feedback ? ` · made ${s.characters} characters, ${s.dates} dates, ${s.feedback} feedback` : ""}
                  {s.tools.length > 0 && <div>{s.tools.slice(0, 20).join(" → ")}</div>}
                  {s.user_agent && <div className="muted">{s.user_agent}</div>}
                </li>
              ))}
          </ul>
        </>
      )}
    </section>
  );
}
