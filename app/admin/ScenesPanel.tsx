"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SceneRequest } from "@/lib/scenes";

/**
 * Scenes people asked for (owner-only): places dates went that the library has no set for yet, by a plan they texted or
 * a move on the date, most asked-for first. Reuses the admin password saved by the frontier tool in this browser.
 */
export default function ScenesPanel() {
  const [scenes, setScenes] = useState<SceneRequest[] | null>(null);
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
      const res = await fetch("/api/admin/scenes", { headers: { "x-frontier-key": key } });
      const body = await res.json();
      if (res.ok) setScenes(body.scenes);
      else setError(body.message ?? "Not authorized.");
    })().catch(() => setError("Network error."));
  }, []);

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
    </section>
  );
}
