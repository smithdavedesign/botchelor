"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import type { WriterOptions } from "@/lib/adult/writer";
import { plainName } from "@/lib/adult/writer-config";

/**
 * Who writes your scenes (lib/adult/writer.ts): a writer from the list, kept for every scene and the two sides of a
 * night. The hub shows it as a card; the theater and the scene's steer bar as a ✍️ button with the writer's short name
 * that opens the list (`icon`; David, 2026-10-25: "the writer drop down as a logo in the theatre mode").
 */
export default function WriterPicker({ initial, compact = false, icon = false }: { initial: WriterOptions; compact?: boolean; icon?: boolean }) {
  const [w, setW] = useState(initial);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The list closes on a tap anywhere else, or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
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
          {compact ? m.label : plainName(m) === m.label ? `${m.label}${m.note ? `: ${m.note}` : ""}` : `${plainName(m)} (${m.label})`}
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

  if (icon) {
    // The writer's short name ("GLM-4.6", "DeepSeek") is the logo; the list says what to expect from each.
    const short = (chosen?.label ?? "Writer").split(/\s+/)[0];
    return (
      <div className={`ad-writer-logo${open ? " open" : ""}`} ref={box}>
        <button type="button" className="ad-writer-logo-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((v) => !v)} title={`Who writes the lines: ${chosen?.label ?? "the default"}`}>
          <span aria-hidden="true">✍️</span> <span className="ad-writer-logo-name">{busy ? "…" : short}</span>
        </button>
        {open && (
          <div className="ad-writer-menu" role="menu" aria-label="Who writes the lines">
            {w.models.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={m.id === w.chosen}
                className={m.id === w.chosen ? "on" : ""}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  if (m.id !== w.chosen) void pick(m.id);
                }}
              >
                <strong>
                  {m.id === w.chosen ? "✓ " : ""}
                  {m.label}
                </strong>
                {m.note && <span className="small muted">{m.note}</span>}
              </button>
            ))}
          </div>
        )}
        {note?.error && (
          <p className="error small ad-writer-logo-error" role="alert">
            {note.text}
          </p>
        )}
      </div>
    );
  }
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
