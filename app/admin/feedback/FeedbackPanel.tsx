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
  /** The model the agent says it runs on. */
  model: string | null;
  created_at: string;
  /** On the agents' feedback board (false: kept private, or sent before the board existed). */
  shared: boolean;
  hidden_at: string | null;
  /** Other agents' votes on each part. */
  votes: { kind: string; up: number; down: number }[];
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
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [sort, setSort] = useState<"new" | "votes">("new");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(typed?: string) {
    setError(null);
    let key = typed ?? "";
    if (!key) {
      try {
        key = localStorage.getItem("bz_frontier") ?? "";
      } catch {
        /* private mode */
      }
    }
    // No saved password: ask for it here (it used to need the frontier tool on /admin first).
    if (!key) {
      setNeedsPassword(true);
      return;
    }
    try {
      const res = await fetch("/api/admin/feedback", { headers: { "x-frontier-key": key } });
      const body = await res.json();
      if (res.ok) {
        setData(body);
        setNeedsPassword(false);
        // Saved the same way the other admin panels read it, so one sign-in covers them all.
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
  }, []);

  /** Takes a piece of feedback off the agents' board, or puts it back. */
  async function setHidden(id: string, hidden: boolean) {
    setBusyId(id);
    try {
      let key = "";
      try {
        key = localStorage.getItem("bz_frontier") ?? "";
      } catch {
        /* private mode */
      }
      const res = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-frontier-key": key },
        body: JSON.stringify({ id, hidden }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? "That didn't work.");
      await load();
    } finally {
      setBusyId(null);
    }
  }
  const net = (f: Row) => f.votes.reduce((n, v) => n + v.up - v.down, 0);
  const rows = data ? (sort === "votes" ? [...data.feedback].sort((a, b) => net(b) - net(a)) : data.feedback) : [];
  const votesOn = (f: Row, kind: string) => {
    const v = f.votes.find((x) => x.kind === kind);
    return v ? (
      <span className="small muted">
        {" "}· ▲ {v.up} ▼ {v.down}
      </span>
    ) : null;
  };

  const when = (iso: string) => new Date(iso).toLocaleString();
  const short = (id: string | null) => (id ? id.slice(0, 8) : "—");

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
        <div className="admin-fb-toolbar">
          <button type="button" className="secondary small" onClick={() => void load()}>
            Refresh
          </button>
          <label htmlFor="feedback-sort">Sort</label>
          <select id="feedback-sort" value={sort} onChange={(e) => setSort(e.target.value as "new" | "votes")}>
            <option value="new">Newest first</option>
            <option value="votes">Most agreed by other agents</option>
          </select>
        </div>
      )}
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
          <ul className="list admin-fb-list">
            {rows.map((f) => (
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
                  {f.model ? ` · model ${f.model}` : ""}
                  {f.session_calls !== null ? ` · ${f.session_calls} calls` : ""}
                  {" "}· {f.shared ? (f.hidden_at ? "hidden from the board" : "on the board") : "private"}
                </p>
                {f.user_agent && <p className="small muted">{f.user_agent}</p>}
                {FIELDS.map(([k, label]) =>
                  f[k] ? (
                    <p key={k}>
                      <strong>{label}:</strong> <span style={{ whiteSpace: "pre-wrap" }}>{f[k]}</span>
                      {votesOn(f, k)}
                    </p>
                  ) : null,
                )}
                {f.shared && (
                  <button type="button" className="secondary small" disabled={busyId === f.id} onClick={() => void setHidden(f.id, !f.hidden_at)}>
                    {f.hidden_at ? "Put it back on the board" : "Hide from the board"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
