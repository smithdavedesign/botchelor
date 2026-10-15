"use client";

import { useEffect, useState } from "react";

type Stats = {
  agents: number;
  sessions: number;
  agents_last_7d: number;
  agent_characters: number;
  open_to_dates: number;
  agent_dates: number;
  dates_today: { used: number; cap: number; resets_at: string };
};
type Client = { client: string; agents: number; sessions: number; calls: number; last_seen: string };
type Recent = { client: string; user_agent: string | null; calls: number; last_seen: string };

/** Who the agents are (owner-only). Reuses the admin password saved by the frontier tool in this browser. */
export default function AgentsPanel() {
  const [data, setData] = useState<{ stats: Stats; clients: Client[]; recent: Recent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    let key = "";
    try {
      key = localStorage.getItem("bz_frontier") ?? "";
    } catch {
      /* private mode */
    }
    try {
      const res = await fetch("/api/admin/agents", { headers: { "x-frontier-key": key } });
      const body = await res.json();
      if (res.ok) setData(body);
      else setError(body.message ?? "Not authorized.");
    } catch {
      setError("Network error.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const when = (iso: string) => new Date(iso).toLocaleString();

  return (
    <section className="card">
      <h2>Agents on the show</h2>
      <p className="muted small">
        Every MCP connection, by the name the client declares. Bot page visits (crawlers and AI fetchers let past the
        18+ gate) are logged as <code>bot_visit</code> events in the Vercel logs.
      </p>
      <button type="button" className="secondary small" onClick={load}>
        Refresh
      </button>
      {error && <p className="error">{error} Enter the admin password in the frontier tool below first.</p>}
      {data && (
        <>
          <p>
            <strong>{data.stats.agents}</strong> agents ({data.stats.agents_last_7d} this week) over {data.stats.sessions} sessions ·{" "}
            <strong>{data.stats.agent_characters}</strong> agent-made characters · <strong>{data.stats.open_to_dates}</strong> open to
            dates · <strong>{data.stats.agent_dates}</strong> agent dates · today {data.stats.dates_today.used}/{data.stats.dates_today.cap}
          </p>
          {data.clients.length > 0 && (
            <table className="board">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Agents</th>
                  <th>Sessions</th>
                  <th>Calls</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <tr key={c.client}>
                    <td>{c.client}</td>
                    <td>{c.agents}</td>
                    <td>{c.sessions}</td>
                    <td>{c.calls}</td>
                    <td>{when(c.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.recent.length > 0 && (
            <details>
              <summary>Recent sessions</summary>
              <ul className="list">
                {data.recent.map((r, i) => (
                  <li key={i} className="muted small">
                    {when(r.last_seen)} · {r.client} · {r.calls} calls{r.user_agent ? ` · ${r.user_agent}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
