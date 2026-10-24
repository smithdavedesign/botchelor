"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ContentReportRow } from "@/lib/content-reports";
import { CONTENT_REPORT_LABELS, type ContentReportDecision } from "@/lib/content-reports-shared";

/** The admin password saved by the other admin panels in this browser, if any (an admin account works without it). */
function adminHeaders(): Record<string, string> {
  try {
    const key = localStorage.getItem("bz_frontier");
    return key ? { "x-frontier-key": key } : {};
  } catch {
    return {};
  }
}

const when = (iso: string) => new Date(iso).toLocaleString();
const STATUS_LABELS: Record<string, string> = { open: "Open", resolved: "Resolved", hidden: "Date hidden", dismissed: "Dismissed" };

/** Complaints and takedown requests from /report (lib/content-reports.ts), urgent and oldest first, with what to do. */
export default function ContentReportsPanel() {
  const [reports, setReports] = useState<ContentReportRow[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/content-reports${all ? "?status=all" : ""}`, { headers: adminHeaders() });
      const body = await res.json();
      if (res.ok) setReports(body.reports);
      else setError(body.message ?? "Not authorized.");
    } catch {
      setError("Network error.");
    }
  }, [all]);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: ContentReportDecision) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/content-reports", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ id, decision, note: notes[id] || undefined }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? "That didn't work.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2>Complaints and takedowns</h2>
      <p className="muted small">
        Sent from <Link href="/report">/report</Link>. We promise an answer within 48 hours for a minor, a real person or an
        intimate image, and within 7 business days for the rest. Each new one also emails the contact address and every admin
        with a confirmed email. Hide takes the date it names down (private to its creator; nothing is deleted).
      </p>
      <div className="consent-actions">
        <button type="button" className="secondary small" onClick={() => void load()}>
          Refresh
        </button>
        <label className="small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show decided ones too
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {reports && reports.length === 0 && <p>Nothing waiting.</p>}
      {reports?.map((r) => (
        <article key={r.id} className="card">
          <p>
            <strong>{CONTENT_REPORT_LABELS[r.category]}</strong>
            {r.urgent && <span className="badge"> 48 hours</span>} · {STATUS_LABELS[r.status] ?? r.status} · sent {when(r.created_at)}
            {r.status === "open" && <> · due {when(r.due_at)}</>}
            {r.flagged && <> · flagged ({r.flag_reason})</>}
          </p>
          <p className="small">
            What: {r.target ?? <span className="muted">not given</span>}
            {r.episode_id && (
              <>
                {" "}
                · <Link href={`/episodes/${r.episode_id}`}>open the date</Link>
              </>
            )}
          </p>
          {r.details && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{r.details}</p>}
          <p className="muted small">
            Reply to: {r.contact_email ? <a href={`mailto:${r.contact_email}`}>{r.contact_email}</a> : "no email given"}
            {r.account ? " · signed in" : " · anonymous"}
          </p>
          {r.note && <p className="muted small">Note: {r.note}</p>}
          <label className="small">
            Note (optional)
            <input
              type="text"
              maxLength={1000}
              value={notes[r.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
            />
          </label>
          <div className="consent-actions">
            <button type="button" className="secondary small" disabled={busy === r.id} onClick={() => void decide(r.id, "resolved")}>
              Resolve
            </button>
            <button type="button" className="small" disabled={busy === r.id || !r.episode_id} onClick={() => void decide(r.id, "hidden")}>
              Hide the date
            </button>
            <button type="button" className="secondary small" disabled={busy === r.id} onClick={() => void decide(r.id, "dismissed")}>
              Dismiss
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
