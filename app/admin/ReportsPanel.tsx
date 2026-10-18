"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/rules";

type Reported = {
  episode_id: string;
  characters: [string, string];
  visibility: string;
  reports: number;
  hidden: boolean;
  reasons: Record<string, number>;
  last_reported_at: string;
  preview: { setting: string | null; best_line: string | null; twist: string | null; finale: string | null; lines: string[] };
};

/** Reported episodes waiting for the owner (lib/moderation.ts). Works with the saved admin password or an admin account. */
export default function ReportsPanel() {
  const [episodes, setEpisodes] = useState<Reported[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const headers = (): Record<string, string> => {
    try {
      const key = localStorage.getItem("bz_frontier");
      return key ? { "x-frontier-key": key } : {};
    } catch {
      return {};
    }
  };

  async function load() {
    setError(null);
    // No saved password: say so instead of sending a request that can only 403 (like the other admin panels).
    if (!headers()["x-frontier-key"]) {
      setError("Not signed in.");
      return;
    }
    try {
      const res = await fetch("/api/admin/reports", { headers: headers() });
      const body = await res.json();
      if (res.ok) setEpisodes(body.episodes);
      else setError(body.message ?? "Not authorized.");
    } catch {
      setError("Network error.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function review(episodeId: string, decision: "cleared" | "removed") {
    setBusy(episodeId);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ episode_id: episodeId, decision }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? "That didn't work.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const reasonText = (reasons: Record<string, number>) =>
    Object.entries(reasons)
      .map(([r, n]) => `${REPORT_REASON_LABELS[r as ReportReason] ?? r}${n > 1 ? ` ×${n}` : ""}`)
      .join(", ");

  return (
    <section className="card">
      <h2>Reports</h2>
      <p className="muted small">
        Episodes viewers reported. Three reports hide one until you decide. Put it back if it&apos;s fine, or take it down
        (private to its creator; nothing is deleted). New reports also alert #team-agents.
      </p>
      <button type="button" className="secondary small" onClick={load}>
        Refresh
      </button>
      {error && <p className="error">{error} Enter the admin password in the frontier tool below, or claim admin above.</p>}
      {episodes && episodes.length === 0 && <p>Nothing waiting. 🎉</p>}
      {episodes?.map((e) => (
        <article key={e.episode_id} className="card">
          <p>
            <strong>
              {e.characters[0]} × {e.characters[1]}
            </strong>{" "}
            · {e.reports} report{e.reports === 1 ? "" : "s"} ({reasonText(e.reasons)}) · {e.hidden ? "hidden" : "still showing"} ·{" "}
            {e.visibility} · last {new Date(e.last_reported_at).toLocaleString()} ·{" "}
            <Link href={`/episodes/${e.episode_id}`}>open</Link>
          </p>
          {e.preview.setting && <p className="muted small">{e.preview.setting}</p>}
          {e.preview.lines.length > 0 && (
            <ul className="list">
              {e.preview.lines.map((l, i) => (
                <li key={i} className="small">
                  {l}
                </li>
              ))}
            </ul>
          )}
          {e.preview.finale && <p className="small">Finale: {e.preview.finale}</p>}
          <div className="consent-actions">
            <button type="button" className="secondary small" disabled={busy === e.episode_id} onClick={() => review(e.episode_id, "cleared")}>
              Put it back
            </button>
            <button type="button" className="small" disabled={busy === e.episode_id} onClick={() => review(e.episode_id, "removed")}>
              Take it down
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
