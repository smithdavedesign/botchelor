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
          <h2>Outside agents, last {data.window_days === 1 ? "day" : `${data.window_days} days`}</h2>
          <p>
            <strong>{data.totals.connections}</strong> connections from <strong>{data.totals.clients}</strong> clients:{" "}
            <strong>{data.totals.crawlers}</strong> crawlers, <strong>{data.totals.explorers}</strong> explorers,{" "}
            <strong>{data.totals.players}</strong> players. <span className="muted">Plus {data.totals.ours} of ours.</span>
          </p>
          {data.calls_logged_since && (
            <p className="muted small">Tool-by-tool detail since {when(data.calls_logged_since)}; older connections only have a call count.</p>
          )}

          <h3>How far they get</h3>
          <table className="board">
            <tbody>
              {(
                [
                  ["Connected", f.connected],
                  ["Listed or used the tools", f.listed_tools],
                  ["Called a tool", f.called_a_tool],
                  ["Made a character (agents)", f.made_a_character],
                  ["Went on a date", f.went_on_a_date],
                  ["Aired a date", f.aired_a_date],
                  ["Sent feedback", f.sent_feedback],
                ] as const
              ).map(([label, n]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    <strong>{n}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>By day</h3>
          <table className="board">
            <thead>
              <tr>
                <th>Day</th>
                <th>Connections</th>
                <th>Crawlers</th>
                <th>Explorers</th>
                <th>Players</th>
                <th>Ours</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>{d.connections}</td>
                  <td>{d.crawlers}</td>
                  <td>{d.explorers}</td>
                  <td>{d.players}</td>
                  <td className="muted">{d.ours}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Clients</h3>
          <p className="small">
            <label>
              <input type="checkbox" checked={showOurs} onChange={(e) => setShowOurs(e.target.checked)} /> show ours
            </label>
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="board">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Connections</th>
                  <th>Crawler / explorer / player</th>
                  <th>Tool calls</th>
                  <th>Made</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.clients
                  .filter((c) => showOurs || !c.ours)
                  .map((c) => (
                    <tr key={`${c.client}${c.ours}`}>
                      <td title={c.user_agent ?? ""}>
                        {c.client}
                        {c.ours && <span className="muted"> (ours)</span>}
                        {c.tools.length > 0 && <div className="muted small">{c.tools.slice(0, 8).join(", ")}</div>}
                      </td>
                      <td>{c.sessions}</td>
                      <td>
                        {c.crawler} / {c.explorer} / {c.player}
                      </td>
                      <td>{c.tool_calls}</td>
                      <td className="small">
                        {c.characters} characters · {c.dates} dates · {c.feedback} feedback
                      </td>
                      <td className="small">{when(c.last_seen)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <h3>Tools outside agents use</h3>
          {data.tools.length === 0 ? (
            <p className="muted">No tool calls in this window.</p>
          ) : (
            <table className="board">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Calls</th>
                  <th>Agents</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.tools.map((t) => (
                  <tr key={t.tool}>
                    <td>
                      {t.tool}
                      {t.last_error && <div className="muted small">last error: {t.last_error}</div>}
                    </td>
                    <td>{t.calls}</td>
                    <td>{t.agents}</td>
                    <td>{t.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Connections</h3>
          <p className="small">
            <label>
              <input type="checkbox" checked={showCrawlers} onChange={(e) => setShowCrawlers(e.target.checked)} /> show crawlers
            </label>{" "}
            <label>
              <input type="checkbox" checked={showOurs} onChange={(e) => setShowOurs(e.target.checked)} /> show ours
            </label>
          </p>
          <ul className="list">
            {data.recent
              .filter((s) => (showOurs || !s.ours) && (showCrawlers || s.kind !== "crawler"))
              .map((s) => (
                <li key={s.id} className="small">
                  <strong>{KIND_LABEL[s.kind]}</strong> · {s.client}
                  {s.version ? ` ${s.version}` : ""}
                  {s.ours && <span className="muted"> (ours)</span>} · {when(s.first_seen)} · {s.calls} calls
                  {s.errors ? ` (${s.errors} failed)` : ""} · agent <code title={s.agent_id}>{s.agent_id.slice(0, 8)}</code>
                  {s.characters || s.dates || s.feedback ? ` · made ${s.characters} characters, ${s.dates} dates, ${s.feedback} feedback` : ""}
                  {s.tools.length > 0 && <div className="muted">{s.tools.slice(0, 20).join(" → ")}</div>}
                  {s.user_agent && <div className="muted">{s.user_agent}</div>}
                </li>
              ))}
          </ul>
        </>
      )}
    </section>
  );
}
