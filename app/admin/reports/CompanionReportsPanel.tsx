"use client";

import { useEffect, useState } from "react";
import type { CompanionReport } from "@/lib/companion-reports";
import { venueName } from "@/lib/venues";

const WHO = { user: "Them", character: "Companion", system: "Notice" } as const;

/** Reported companion replies waiting for the owner (lib/companion-reports.ts). Works with the saved admin password or an admin account. */
export default function CompanionReportsPanel() {
  const [reports, setReports] = useState<CompanionReport[] | null>(null);
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
    try {
      const res = await fetch("/api/admin/companion-reports", { headers: headers() });
      const body = await res.json();
      if (res.ok) setReports(body.reports);
      else setError(body.message ?? "Not authorized.");
    } catch {
      setError("Network error.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function review(messageId: string, decision: "fine" | "fix") {
    setBusy(messageId);
    try {
      const res = await fetch("/api/admin/companion-reports", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ message_id: messageId, decision }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? "That didn't work.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" data-companion-reports>
      <h2>Companion replies reported</h2>
      <p className="muted small">
        Replies people reported in their own conversations, with the few messages before each (nothing more of it). Fine if nothing&apos;s wrong; a real
        miss is for the prompt or the checks (lib/companion-prompt.ts, lib/safety.ts).
      </p>
      <button type="button" className="secondary small" onClick={load}>
        Refresh
      </button>
      {error && <p className="error">{error}</p>}
      {reports && reports.length === 0 && <p>Nothing waiting. 🎉</p>}
      {reports?.map((r) => (
        <article key={r.message_id} className="card">
          <p>
            <strong>{r.character.name}</strong> · {r.reason_label} · {new Date(r.reported_at).toLocaleString()}
            {r.scene && <> · 🎭 {venueName(r.scene)}</>}
          </p>
          {r.context.length > 0 && (
            <ul className="list">
              {r.context.map((m, i) => (
                <li key={i} className="small muted">
                  <strong>{WHO[m.role]}:</strong> {m.text}
                </li>
              ))}
            </ul>
          )}
          <blockquote className="small">
            {r.action && <em>({r.action}) </em>}
            {r.text}
          </blockquote>
          <div className="consent-actions">
            <button type="button" className="secondary small" disabled={busy === r.message_id} onClick={() => review(r.message_id, "fine")}>
              Fine
            </button>
            <button type="button" className="small" disabled={busy === r.message_id} onClick={() => review(r.message_id, "fix")}>
              A real miss
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
