"use client";

import { useState } from "react";
import { SCENARIOS } from "@/lib/adult/scenarios";
import { STAGES } from "@/lib/adult/stages";

/** How many scenarios show before "Show N more" (the full set was a page of cards). */
const FIRST = 4;

/**
 * Start a night from a scenario (lib/adult/scenarios.ts): pick one, and the night that ran is filed under Their nights
 * (as Start over does), they're put in its place and the first lines are written from its opening.
 */
export default function Scenarios({ busy, hasLines, current, onStart }: { busy: boolean; hasLines: boolean; current: string | null; onStart: (id: string) => Promise<boolean> }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const now = SCENARIOS.find((s) => s.id === current);
  // The first few, and tonight's if it's further down, so the chosen card is always there.
  const shown = all ? SCENARIOS : SCENARIOS.filter((s, i) => i < FIRST || s.id === current);
  const more = SCENARIOS.length - shown.length;
  return (
    <details className="ad-panel ad-scenarios">
      <summary>🎬 Start a night from a scenario{now ? `: tonight is ${now.title}` : ""}</summary>
      <p className="muted small">Each one is two adults who both want to be there. Starting one files tonight&apos;s scene under Their nights, like Start over.</p>
      <ul className="ad-scenario-list">
        {shown.map((s) => (
          <li key={s.id} className={s.id === current ? "chosen" : ""}>
            <strong>{s.title}</strong>
            <span className="muted small ad-scenario-premise">{s.premise}</span>
            <span className="ad-scenario-meta">
              <span className="chip">📍 {s.place}</span> <span className="chip">{STAGES[s.stage]}</span>
            </span>
            {asking === s.id ? (
              <span className="ad-memory-buttons ad-scenario-go">
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
      {(more > 0 || all) && (
        <p className="ad-scenario-more">
          <button type="button" className="button-ghost small" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show ${more} more`}
          </button>
        </p>
      )}
    </details>
  );
}
