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

/** A reported line of a house scene (lib/house-scenes.ts listSceneReports). */
type ReportedLine = { scene_id: string; line: number; text: string; speaker: string; reports: number; hidden: boolean; reasons: Record<string, number>; last_reported_at: string };

/** Reported episodes waiting for the owner (lib/moderation.ts). Works with the saved admin password or an admin account. */
export default function ReportsPanel() {
  const [episodes, setEpisodes] = useState<Reported[] | null>(null);
  const [sceneLines, setSceneLines] = useState<ReportedLine[]>([]);
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
      if (res.ok) {
        setEpisodes(body.episodes);
        setSceneLines(body.scene_lines ?? []);
      }
      else setError(body.message ?? "Not authorized.");
    } catch {
      setError("Network error.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function review(target: string | { scene_id: string; line: number }, decision: "cleared" | "removed") {
    setBusy(typeof target === "string" ? target : `${target.scene_id}#${target.line}`);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify(typeof target === "string" ? { episode_id: target, decision } : { ...target, decision }),
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
        Episodes (and lines of house scenes) viewers reported. Three reports hide one until you decide. Put it back if it&apos;s fine, or take it down
        (private to its creator; nothing is deleted). New reports also alert #team-agents.
      </p>
      <button type="button" className="secondary small" onClick={load}>
        Refresh
      </button>
      {error && <p className="error">{error} Enter the admin password in the frontier tool below, or claim admin above.</p>}
      {episodes && episodes.length === 0 && sceneLines.length === 0 && <p>Nothing waiting. 🎉</p>}
      {sceneLines.map((l) => {
        const key = `${l.scene_id}#${l.line}`;
        return (
          <article key={key} className="card">
            <p>
              <strong>House scene, line {l.line}</strong> · {l.reports} report{l.reports === 1 ? "" : "s"} ({reasonText(l.reasons)}) ·{" "}
              {l.hidden ? "hidden" : "still showing"} · last {new Date(l.last_reported_at).toLocaleString()} ·{" "}
              <Link href={`/house?scene=${encodeURIComponent(l.scene_id)}`}>open</Link>
            </p>
            <p className="small">
              {l.speaker}: {l.text}
            </p>
            <div className="consent-actions">
              <button type="button" className="secondary small" disabled={busy === key} onClick={() => review({ scene_id: l.scene_id, line: l.line }, "cleared")}>
                Put it back
              </button>
              <button type="button" className="small" disabled={busy === key} onClick={() => review({ scene_id: l.scene_id, line: l.line }, "removed")}>
                Take it down
              </button>
            </div>
          </article>
        );
      })}
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
