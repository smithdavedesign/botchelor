"use client";

import { useState, type KeyboardEvent } from "react";
import { crisisFrom } from "@/app/CrisisNotice";
import type { StepInSceneView } from "@/lib/adult/step-in-shared";
import { NO_SHEET, TRACKER_FIELD_MAX, TRACKER_FIELDS, trackerLabels, type SceneSheet, type TrackerField } from "@/lib/adult/step-in-tracker";
import type { CrisisResources } from "@/lib/crisis";

/**
 * The scene's continuity sheet (lib/adult/step-in-tracker.ts), in the scene's ⋯ menu: where the two of them are, what
 * each has on and what's within reach, as it's kept after every reply so nothing in the scene appears or changes
 * without the story saying so. Each line is the viewer's to correct, and the next reply is told the corrected one.
 * Asked for each time the fold is opened (it changes with every reply), never before.
 *
 * `live`: the scene can still be written; otherwise the sheet is only read.
 *
 * No <form> in here: the menu sits inside the composer's own form (./StepInScene.tsx), and a form inside a form isn't
 * one. Save is a plain button, and Enter in a line's box is that line's, never the composer's.
 */
export default function StepInTracker({
  sceneId,
  name,
  live,
  onCrisis,
  onScene,
}: {
  sceneId: string;
  name: string;
  live: boolean;
  onCrisis?: (c: CrisisResources) => void;
  /** The scene as it stands, when a correction was refused in a way that changed it (the self-harm protocol pauses it). */
  onScene?: (scene: StepInSceneView) => void;
}) {
  // undefined: not asked for yet; null: nothing noted.
  const [sheet, setSheet] = useState<SceneSheet | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ field: TrackerField; text: string } | null>(null);
  const labels = trackerLabels(name);
  const path = `/api/admin/after-dark/step-in/${encodeURIComponent(sceneId)}/tracker`;

  async function load() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path);
      const d = (await res.json().catch(() => null)) as { tracker?: SceneSheet | null } | null;
      if (res.ok && d) setSheet(d.tracker ?? null);
      else setError("That didn't load. Close this and open it again.");
    } catch {
      setError("That didn't load. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  /** One line corrected (an empty one clears it): what comes back is the sheet as it now stands. */
  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ [editing.field]: editing.text }) });
      const d = (await res.json().catch(() => null)) as { tracker?: SceneSheet | null; scene?: StepInSceneView; message?: string } | null;
      if (d?.scene) onScene?.(d.scene);
      const help = crisisFrom(d);
      if (help) {
        onCrisis?.(help);
        setError(help.message);
        // Nothing they wrote was kept, so it doesn't stay in the box either.
        setEditing(null);
        return;
      }
      if (!res.ok || !d) {
        setError(d?.message ?? "That didn't go through. Try again in a moment.");
        return;
      }
      setSheet(d.tracker ?? null);
      setEditing(null);
    } catch {
      setError("That didn't go through. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  /** Enter in a line's box saves that line, and never sends the composer's (the form it sits in). */
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
    }
  };

  const now = sheet ?? NO_SHEET;
  return (
    <details
      className="ad-si-memory ad-si-tracker"
      data-step-in-tracker={sheet === undefined ? "closed" : sheet ? "noted" : "empty"}
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
        else setEditing(null);
      }}
    >
      <summary>🧭 Where things stand</summary>
      <div className="ad-si-memory-body">
        {sheet === undefined && !error && <p className="muted small">Loading…</p>}
        {sheet !== undefined && (
          <>
            <p className="muted small">Kept so the scene stays consistent. {live ? "Correct anything that's wrong." : "It was kept as the scene went."}</p>
            {sheet === null && <p className="muted small">Nothing noted yet. It fills in after the first reply.</p>}
            {(sheet !== null || live) && (
              <ul className="ad-si-facts">
                {TRACKER_FIELDS.map((f) => (
                  <li key={f} data-tracker-line={f}>
                    {editing?.field === f ? (
                      <span className="ad-si-fact-edit" role="group" aria-label={`Correct: ${labels[f]}`}>
                        <label className="muted small" htmlFor={`ad-si-tracker-${f}`}>
                          {labels[f]}
                        </label>
                        <input
                          id={`ad-si-tracker-${f}`}
                          value={editing.text}
                          maxLength={TRACKER_FIELD_MAX}
                          autoFocus
                          autoComplete="off"
                          onChange={(e) => setEditing({ field: f, text: e.target.value })}
                          onKeyDown={onKey}
                        />
                        <button type="button" className="button-ghost small" disabled={busy} onClick={() => void save()} data-tracker-save>
                          Save
                        </button>
                        <button type="button" className="button-ghost small" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        <span className="ad-si-fact-text">
                          <span className="muted small">{labels[f]}: </span>
                          {now[f] || <span className="muted">not noted</span>}
                        </span>
                        {live && (
                          <span className="ad-si-fact-tools">
                            <button type="button" className="button-ghost small" disabled={busy} onClick={() => setEditing({ field: f, text: now[f] })} aria-label={`Change: ${labels[f]}`} data-tracker-change>
                              Change
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
