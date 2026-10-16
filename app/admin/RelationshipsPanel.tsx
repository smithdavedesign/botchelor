"use client";

import { useEffect, useState } from "react";
import type { RelationshipMetrics } from "@/lib/relationship-metrics";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** Is the long game working (owner-only)? Reuses the admin password saved by the frontier tool in this browser. */
export default function RelationshipsPanel() {
  const [m, setM] = useState<RelationshipMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let key = "";
      try {
        key = localStorage.getItem("bz_frontier") ?? "";
      } catch {
        /* private mode */
      }
      if (!key) return setError("Not signed in.");
      const res = await fetch("/api/admin/relationships", { headers: { "x-frontier-key": key } });
      const body = await res.json();
      if (res.ok) setM(body);
      else setError(body.message ?? "Not authorized.");
    })().catch(() => setError("Network error."));
  }, []);

  return (
    <section className="card">
      <h2>Relationships: the long game</h2>
      {error && <p className="muted">{error}</p>}
      {m && (
        <>
          <p>
            <strong>Second-date conversion:</strong> {pct(m.second_dates.conversion)} ({m.second_dates.booked} of {m.second_dates.mutual} mutual dates in
            the last {m.window_days} days booked their second date; {m.second_dates.waiting_on_a_yes} waiting on the other creator&apos;s yes).
          </p>
          <p>
            <strong>Owners coming back:</strong> {pct(m.owners.d1_rate)} the next day, {pct(m.owners.d7_rate)} within a week ({m.owners.cohort} owners
            whose first date was 1–60 days ago).
          </p>
          <p>
            <strong>Couples:</strong> {m.couples.total} ({m.couples.public} with aired public dates), the deepest at {m.couples.deepest} dates. By dates:{" "}
            {Object.entries(m.couples.by_dates)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
            . By stage:{" "}
            {Object.entries(m.couples.by_stage)
              .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
              .join(" · ")}
            .
          </p>
          <p>
            <strong>Between dates:</strong> {m.between_dates.texts_7d} texts across {m.between_dates.couples_texted_7d} couples this week ·{" "}
            {m.between_dates.nudges_set_30d} nudges left ({m.between_dates.nudges_used_30d} used) · {m.between_dates.follows} follows · arc calls{" "}
            {m.between_dates.arc_calls_open} open, {m.between_dates.arc_calls_right}/{m.between_dates.arc_calls_settled} right ·{" "}
            {m.between_dates.notifications_7d} notifications this week ({m.between_dates.notifications_read_7d} read) · {m.between_dates.push_subscriptions}{" "}
            browsers with push on.
          </p>
        </>
      )}
    </section>
  );
}
