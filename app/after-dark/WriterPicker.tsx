"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { WriterOptions } from "@/lib/adult/writer";

/**
 * Who writes your scenes (lib/adult/writer.ts): a writer from the list, kept for every scene and the two sides of a
 * night. The hub shows it as a card; the scene page, in its ⋯ More menu (`compact`).
 */
export default function WriterPicker({ initial, compact = false }: { initial: WriterOptions; compact?: boolean }) {
  const [w, setW] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const chosen = w.models.find((m) => m.id === w.chosen);

  async function pick(id: string) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/writer", { model: id }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't change the writer. Try again.", error: true });
    setW(res.data as WriterOptions);
    const now = (res.data as WriterOptions).models.find((m) => m.id === id);
    setNote({ text: `${now?.label ?? "That writer"} writes your next lines.` });
  }

  // In the scene's steer bar (`compact`) only the names, to keep it narrow; the note is the option's tooltip.
  const select = (
    <select id={compact ? "ad-writer-compact" : "ad-writer"} value={w.chosen} disabled={busy} onChange={(e) => void pick(e.target.value)} title={chosen?.note || undefined}>
      {w.models.map((m) => (
        <option key={m.id} value={m.id} title={m.note || undefined}>
          {m.label}
          {!compact && m.note ? `: ${m.note}` : ""}
          {!compact && m.id === w.default ? " (the default)" : ""}
        </option>
      ))}
    </select>
  );
  // In the steer bar only a failure shows (a new line there would grow the bar); the new name says the rest.
  const status = note && (!compact || note.error) && (
    <p className={note.error ? "error small" : "muted small"} role={note.error ? "alert" : "status"}>
      {note.text}
    </p>
  );

  if (compact) {
    return (
      <div className="ad-writer-compact">
        <label htmlFor="ad-writer-compact">✍️ Writer</label>
        {select}
        {status}
      </div>
    );
  }
  return (
    <section className="card ad-writer" id="writer">
      <h2>✍️ The writer</h2>
      <p className="muted small">
        The model that writes your scenes and the two sides of a night. {chosen?.label ?? "It"} writes them now; switch any time, and the next
        lines are the new one&apos;s.
      </p>
      <label htmlFor="ad-writer">Writer</label>
      {select}
      {status}
    </section>
  );
}
