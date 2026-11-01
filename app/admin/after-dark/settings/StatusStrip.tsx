"use client";

import Link from "next/link";
import { useState } from "react";
import { FieldNote, useSettings } from "./autosave";

/** A media pause as the page shows it (lib/adult/hive-limit.ts mediaPauses, its clock already in words). */
export type PauseLine = { what: string; text: string; active: boolean; reason: string | null; hive: boolean };

/**
 * The top of the settings (2026-10-31 UX audit, E3): After Dark on or off, which asks before it turns off, what's
 * paused right now, and the way to each provider's live status. The switch was a small checkbox in the second card,
 * apart from the paused card.
 */
export default function StatusStrip({ pauses }: { pauses: PauseLine[] }) {
  const { s, save, status } = useSettings();
  const [confirming, setConfirming] = useState(false);
  const saving = status.enabled?.state === "saving";
  const turn = async (on: boolean) => {
    setConfirming(false);
    await save("enabled", { enabled: on });
  };
  const paused = pauses.filter((p) => p.active);
  return (
    <section className="card ad-status-strip" aria-label="Where After Dark stands">
      <div className="ad-status-row">
        <button
          type="button"
          id="ad-enabled"
          role="switch"
          aria-checked={s.enabled}
          className={`ad-switch${s.enabled ? " is-on" : ""}`}
          disabled={saving}
          onClick={() => (s.enabled ? setConfirming(true) : void turn(true))}
        >
          <span className="ad-switch-track" aria-hidden="true" />
          <strong>After Dark {s.enabled ? "on" : "off"}</strong>
        </button>
        <span className="muted small">
          {s.enabled ? (s.openrouter_last4 ? "It's open." : "It opens once an OpenRouter key is saved.") : "Nobody can open it."}
        </span>{" "}
        <FieldNote field="enabled" />
      </div>
      {confirming && (
        <div className="ad-status-confirm" role="group" aria-label="Turn After Dark off?">
          <span>Turn After Dark off? Nobody can open it until it&apos;s back on.</span>
          <button type="button" className="secondary small" onClick={() => void turn(false)}>
            Turn it off
          </button>
          <button type="button" className="button-ghost small" onClick={() => setConfirming(false)}>
            Keep it on
          </button>
        </div>
      )}
      <p className="small ad-status-pauses">
        {paused.length ? (
          <span className="error">Paused: {paused.map((p) => `${p.what} ${p.text}`).join(" · ")}</span>
        ) : (
          <span className="muted">Nothing is paused.</span>
        )}{" "}
        · <Link href="/admin/after-dark/providers">Providers</Link>
      </p>
      {pauses.length > 0 && (
        <details className="ux-fold ad-status-more">
          <summary className="small">What&apos;s paused, and why</summary>
          <ul className="list small">
            {pauses.map((p) => (
              <li key={p.what}>
                <strong>{p.what}</strong> {p.text}
                {p.reason ? <span className="muted"> · {p.reason}</span> : null}
                {p.hive && p.active ? <p className="muted">Hive isn&apos;t answering checks: no picture, keyframe or video is drawn until it does, and the page says until when.</p> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
