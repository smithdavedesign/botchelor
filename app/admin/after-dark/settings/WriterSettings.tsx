"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { AdultSettings } from "@/lib/adult/settings";
import type { WriterConfig } from "@/lib/adult/writer-config";

/**
 * Who writes the scenes (lib/adult/writer-config.ts): the default writer, and the writers people can pick from (the
 * list as JSON, validated when it's saved). The text model above stays the one for recaps, memory and clip directions.
 */
export default function WriterSettings({ initial }: { initial: AdultSettings }) {
  const [writer, setWriter] = useState<WriterConfig>(initial.writer);
  const [json, setJson] = useState(() => JSON.stringify(initial.writer.models, null, 2));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/settings", { writer: patch }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't save that.", error: true });
    const s = res.data.settings as AdultSettings;
    setWriter(s.writer);
    setJson(JSON.stringify(s.writer.models, null, 2));
    setNote({ text: "Saved." });
  }

  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <h2>✍️ The writer</h2>
      <p className="muted small">
        The model that writes the scenes and the two sides of a night. Each person can pick from this list on their After Dark page; this is the
        one everyone else gets. Recaps, memory and clip directions stay on the text model above. Every writer runs on the reviewed hosts only, so
        try a step before adding one.
      </p>
      <label htmlFor="ad-writer-default">The default writer</label>
      <select id="ad-writer-default" value={writer.default} disabled={busy} onChange={(e) => void save({ default: e.target.value })}>
        {writer.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.id})
          </option>
        ))}
      </select>
      <details className="ad-settings-section">
        <summary>
          <h3>The writers people can pick from</h3>
        </summary>
        <p className="muted small">Each with its OpenRouter id, a short name and what to expect. Saving checks every value.</p>
        <textarea aria-label="The writers (JSON)" rows={10} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} style={{ fontFamily: "monospace", width: "100%" }} />
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(json);
            } catch {
              return setNote({ text: "That isn't valid JSON.", error: true });
            }
            void save({ models: parsed });
          }}
        >
          Save the writers
        </button>
      </details>
      {note && (
        <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}
