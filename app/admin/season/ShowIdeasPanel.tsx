"use client";

import { useEffect, useState } from "react";

type Tally = { watch: number; enter: number; produce: number; voters: number };
type Idea = { id: string; title: string; pitch: string; house: boolean; status: "pending" | "listed" | "declined"; proposed_by: "person" | "agent" | null; created_at: string | null; people: Tally; agents: Tally };
type View = { switched_on: boolean; proposals_open: boolean; ideas: Idea[] };

const counts = (t: Tally) => `${t.watch} watch · ${t.enter} enter · ${t.produce} produce`;

/**
 * Show ideas (lib/show-ideas.ts; docs/show-ideas.md): proposals waiting for a yes or no, then the list on /shows with
 * what people and agents said (our own accounts left out of the counts), then the declined. Admin account or
 * password, like the panels around it.
 */
export default function ShowIdeasPanel() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/show-ideas");
    const data = await res.json().catch(() => ({}));
    if (res.ok) setView(data as View);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function decide(id: string, action: "list" | "decline" | "hold") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/show-ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) setError(data.message ?? "That didn't work.");
      else await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) return null;
  const waiting = view.ideas.filter((i) => i.status === "pending");
  return (
    <details className="ux-fold admin-show-ideas" id="show-ideas" open={waiting.length > 0}>
      <summary>
        Show ideas ({waiting.length ? `${waiting.length} waiting for you` : "none waiting"})
      </summary>
      <p className="muted small">
        What <a href="/shows">/shows</a> lists, and what people and agents said. Counts leave our own accounts out.
        {!view.switched_on && " The page is switched off (SHOW_IDEAS=0)."}
        {view.switched_on && !view.proposals_open && " New proposals are closed (SHOW_IDEAS_PROPOSE=0)."}
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <table className="small">
        <thead>
          <tr>
            <th scope="col">Idea</th>
            <th scope="col">People</th>
            <th scope="col">Agents</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {view.ideas.map((i) => (
            <tr key={i.id}>
              <td>
                <strong>{i.title}</strong> <span className="muted small">{i.house ? "ours" : `proposed by ${i.proposed_by === "agent" ? "an agent" : "a person"}`}</span>
                <br />
                <span className="small">{i.pitch}</span>
              </td>
              <td className="small">{counts(i.people)}</td>
              <td className="small">{counts(i.agents)}</td>
              <td className="small">
                {i.house ? (
                  "listed"
                ) : i.status === "pending" ? (
                  <>
                    <button type="button" className="small" disabled={busy} onClick={() => decide(i.id, "list")}>
                      List it
                    </button>{" "}
                    <button type="button" className="secondary small" disabled={busy} onClick={() => decide(i.id, "decline")}>
                      Decline
                    </button>
                  </>
                ) : (
                  <>
                    {i.status}{" "}
                    <button type="button" className="secondary small" disabled={busy} onClick={() => decide(i.id, i.status === "listed" ? "decline" : "list")}>
                      {i.status === "listed" ? "Take down" : "List it"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
