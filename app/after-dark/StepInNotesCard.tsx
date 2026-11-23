"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { NOTE_PACES, NOTES_ABOUT, PACES, type NotePace, type NotePrefs } from "@/lib/adult/step-in-notes";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** An hour as the card says it: 22:00, 08:00. The same words on the server and in the browser. */
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** This device's time zone, as the browser names it; the server keeps one it doesn't know as UTC. */
const deviceZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether the characters someone has scenes running with may write to them first (lib/adult/step-in-notes.ts; David,
 * 2026-11-23: "Messages sent first, with quiet hours"). Off until they choose how often; then their quiet hours, in the
 * time zone this device gives when they turn it on. Every change is saved as it's made. One scene can be told not to
 * from its own ⋯ menu.
 */
export default function StepInNotesCard({ initial }: { initial: NotePrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const on = prefs.pace !== null;

  async function save(next: { pace: NotePace | null; quiet_from?: number; quiet_to?: number }) {
    setBusy(true);
    setNote(null);
    // The zone goes with every save while it's on: where this device is now is what the quiet hours are judged in.
    const res = await requestJson("/api/admin/after-dark/step-in/notes", { action: "save", ...next, ...(next.pace ? { time_zone: deviceZone() } : {}) }).catch(() => null);
    setBusy(false);
    const saved = (res?.data as { notes?: NotePrefs } | undefined)?.notes;
    if (!res?.ok || !saved) return setNote({ text: res?.message ?? "That didn't save. Try again in a moment.", error: true });
    setPrefs(saved);
    setNote({ text: saved.pace ? `Saved. ${PACES[saved.pace].says}` : "Off. Nobody writes to you first." });
  }

  return (
    <section className="card ad-notes" id="notes" data-step-in-notes-card={on ? prefs.pace! : "off"}>
      <h2>✉ They can write to you first</h2>
      <p className="muted small">{NOTES_ABOUT}</p>
      <fieldset className="ad-notes-pace" disabled={busy}>
        <legend>How often</legend>
        <label className={on ? "" : "chosen"}>
          <input type="radio" name="ad-notes-pace" checked={!on} onChange={() => void save({ pace: null })} /> <strong>Off</strong>{" "}
          <span className="muted small">Nobody writes to you first (how it starts).</span>
        </label>
        {NOTE_PACES.map((p) => (
          <label key={p} className={prefs.pace === p ? "chosen" : ""}>
            <input type="radio" name="ad-notes-pace" checked={prefs.pace === p} onChange={() => void save({ pace: p, quiet_from: prefs.quiet_from, quiet_to: prefs.quiet_to })} /> <strong>{PACES[p].label}</strong>{" "}
            <span className="muted small">{PACES[p].says}</span>
          </label>
        ))}
      </fieldset>
      {on && (
        <p className="ad-notes-quiet" data-step-in-notes-quiet>
          <label htmlFor="ad-notes-from">Quiet from</label>{" "}
          <select id="ad-notes-from" value={prefs.quiet_from} disabled={busy} onChange={(e) => void save({ pace: prefs.pace, quiet_from: Number(e.target.value), quiet_to: prefs.quiet_to })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>{" "}
          <label htmlFor="ad-notes-to">to</label>{" "}
          <select id="ad-notes-to" value={prefs.quiet_to} disabled={busy} onChange={(e) => void save({ pace: prefs.pace, quiet_from: prefs.quiet_from, quiet_to: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>{" "}
          <span className="muted small">
            {prefs.quiet_from === prefs.quiet_to ? "No quiet hours: a note can be written at any time." : "No note is written between those hours."} Your time zone: <span data-step-in-notes-zone>{prefs.time_zone}</span>.
          </span>
        </p>
      )}
      {note && (
        <p className={note.error ? "error small" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}
