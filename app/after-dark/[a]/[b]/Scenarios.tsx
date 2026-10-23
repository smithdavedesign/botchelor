"use client";

import { useState } from "react";
import { SCENARIOS } from "@/lib/adult/scenarios";
import { STAGES } from "@/lib/adult/stages";

/**
 * Start a night from a scenario (lib/adult/scenarios.ts): pick one, and the night that ran is filed under Their nights
 * (as Start over does), they're put in its place and the first lines are written from its opening.
 */
export default function Scenarios({ busy, hasLines, current, onStart }: { busy: boolean; hasLines: boolean; current: string | null; onStart: (id: string) => Promise<boolean> }) {
  const [asking, setAsking] = useState<string | null>(null);
  const now = SCENARIOS.find((s) => s.id === current);
  return (
    <details className="ad-panel ad-scenarios">
      <summary>🎬 Start a night from a scenario{now ? `: tonight is ${now.title}` : ""}</summary>
      <p className="muted small">Each one is two adults who both want to be there. Starting one files tonight&apos;s scene under Their nights, like Start over.</p>
      <ul className="ad-scenario-list">
        {SCENARIOS.map((s) => (
          <li key={s.id} className={s.id === current ? "chosen" : ""}>
            <strong>{s.title}</strong>
            <span className="muted small">{s.premise}</span>
            <span className="ad-scenario-meta">
              <span className="chip">📍 {s.place}</span> <span className="chip">{STAGES[s.stage]}</span>
            </span>
            {asking === s.id ? (
              <span className="ad-memory-buttons">
                <span className="small">File tonight and start this?</span>
                <button
                  type="button"
                  className="primary small"
                  disabled={busy}
                  onClick={async () => {
                    await onStart(s.id);
                    setAsking(null);
                  }}
                >
                  Start
                </button>
                <button type="button" className="button-ghost small" onClick={() => setAsking(null)}>
                  Not now
                </button>
              </span>
            ) : (
              <button type="button" className="button-ghost small" disabled={busy} onClick={() => (hasLines ? setAsking(s.id) : void onStart(s.id))}>
                Start this night
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
