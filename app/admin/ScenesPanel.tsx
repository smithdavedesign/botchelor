"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SceneRequest } from "@/lib/scenes";
import type { QueuedSet } from "@/lib/sets";

/**
 * Scenes people asked for (owner-only): places dates went that the library has no set for yet, by a plan they texted or
 * a move on the date, most asked-for first. Reuses the admin password saved by the frontier tool in this browser.
 */
export default function ScenesPanel() {
  const [scenes, setScenes] = useState<SceneRequest[] | null>(null);
  const [queue, setQueue] = useState<QueuedSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);

  const key = () => {
    try {
      return localStorage.getItem("bz_frontier") ?? "";
    } catch {
      return ""; // private mode
    }
  };

  useEffect(() => {
    (async () => {
      if (!key()) return setError("Not signed in.");
      const res = await fetch("/api/admin/scenes", { headers: { "x-frontier-key": key() } });
      const body = await res.json();
      if (res.ok) {
        setScenes(body.scenes);
        setQueue(body.queue ?? []);
      } else setError(body.message ?? "Not authorized.");
    })().catch(() => setError("Network error."));
  }, []);

  /** Draws the queue's due sets now, instead of waiting for the hourly job. */
  const drawQueue = async () => {
    setDrawing(true);
    try {
      const res = await fetch("/api/admin/scenes", { method: "POST", headers: { "x-frontier-key": key(), "content-type": "application/json" }, body: JSON.stringify({ queue: true, limit: 5 }) });
      const body = await res.json();
      if (res.ok) setQueue(body.queue ?? []);
      else setError(body.message ?? "Couldn't draw the queue.");
    } catch {
      setError("Network error.");
    } finally {
      setDrawing(false);
    }
  };

  return (
    <section className="card">
      <h2>Scenes people asked for</h2>
      <p className="muted">
        Places dates went that have no set yet. They play on a generic background with the place&apos;s name; the most asked-for are
        the next backdrops to make.
      </p>
      {error && <p className="muted">{error}</p>}
      {scenes && scenes.length === 0 && <p className="muted">None yet.</p>}
      {scenes && scenes.length > 0 && (
        <ol>
          {scenes.map((s) => (
            <li key={s.normalized}>
              <strong>{s.label}</strong> · {s.requests} {s.requests === 1 ? "date" : "dates"}
              {s.plans > 0 && s.moves > 0 && ` (${s.plans} planned by text, ${s.moves} moved there)`}
              {s.plans > 0 && s.moves === 0 && " planned by text"}
              {s.moves > 0 && s.plans === 0 && " moved there"} · <Link href={`/episodes/${s.episode_id}`}>latest</Link>
            </li>
          ))}
        </ol>
      )}
      <h3>Sets still to draw</h3>
      <p className="muted">
        Every place a scene goes is drawn once in the background. These haven&apos;t landed yet; the hourly job draws the due ones, a
        couple at a time.
      </p>
      {queue && queue.length === 0 && <p className="muted">Nothing waiting.</p>}
      {queue && queue.length > 0 && (
        <>
          <ul>
            {queue.map((q) => (
              <li key={q.label}>
                <strong>{q.label}</strong> · {q.status}
                {q.attempts > 0 && ` · ${q.attempts} ${q.attempts === 1 ? "try" : "tries"}`}
                {q.reason && <span className="muted"> · {q.reason}</span>}
                {q.retry_at && <span className="muted"> · next try {new Date(q.retry_at).toLocaleString()}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="btn" disabled={drawing} onClick={() => void drawQueue()}>
            {drawing ? "Drawing…" : "Draw the due ones now"}
          </button>
        </>
      )}
    </section>
  );
}
