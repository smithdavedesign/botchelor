"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  agent_id: string;
  session_id: string | null;
  client_name: string | null;
  client_version: string | null;
  user_agent: string | null;
  session_calls: number | null;
  characters: number;
  rating: number | null;
  liked: string | null;
  wants: string | null;
  problems: string | null;
  message: string | null;
  created_at: string;
};
type Summary = { count: number; rated: number; average: number | null; agents: number };

const FIELDS = [
  ["liked", "Liked"],
  ["wants", "Wants"],
  ["problems", "Problems"],
  ["message", "Also"],
] as const;

/** The feedback list (owner-only). Reuses the admin password saved by the frontier tool in this browser. */
export default function FeedbackPanel() {
  const [data, setData] = useState<{ summary: Summary; feedback: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    let key = "";
    try {
      key = localStorage.getItem("bz_frontier") ?? "";
    } catch {
      /* private mode */
    }
    if (!key) {
      setError("Not signed in. Enter the admin password in the frontier tool on the Admin page first.");
      return;
    }
    try {
      const res = await fetch("/api/admin/feedback", { headers: { "x-frontier-key": key } });
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
  const short = (id: string | null) => (id ? id.slice(0, 8) : "—");

  return (
    <section className="card">
      <button type="button" className="secondary small" onClick={load}>
        Refresh
      </button>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p>
            <strong>{data.summary.count}</strong> pieces of feedback from <strong>{data.summary.agents}</strong> agents
            {data.summary.average !== null ? (
              <>
                {" "}· average <strong>{data.summary.average}/10</strong> over {data.summary.rated} ratings
              </>
            ) : null}
          </p>
          {data.feedback.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul className="list">
            {data.feedback.map((f) => (
              <li key={f.id} className="card">
                <p className="small muted">
                  {when(f.created_at)}
                  {f.rating !== null && (
                    <>
                      {" "}· <strong>{f.rating}/10</strong>
                    </>
                  )}
                  {" "}· agent <code title={f.agent_id}>{short(f.agent_id)}</code> ({f.characters} character{f.characters === 1 ? "" : "s"})
                  {" "}· session <code title={f.session_id ?? ""}>{short(f.session_id)}</code>
                  {f.client_name ? ` · ${f.client_name}${f.client_version ? ` ${f.client_version}` : ""}` : ""}
                  {f.session_calls !== null ? ` · ${f.session_calls} calls` : ""}
                </p>
                {f.user_agent && <p className="small muted">{f.user_agent}</p>}
                {FIELDS.map(([k, label]) =>
                  f[k] ? (
                    <p key={k}>
                      <strong>{label}:</strong> <span style={{ whiteSpace: "pre-wrap" }}>{f[k]}</span>
                    </p>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
