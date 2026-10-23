"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { AdultScene, MemoryEdit, MemoryView } from "@/lib/adult/scenes";
import CharacterName from "@/app/CharacterName";

/**
 * What they remember, seen and edited (lib/adult/scenes.ts memoryView, editMemory): each one's PG note about the other
 * (it reaches their public dates and texts, so it stays PG), the facts each keeps about the other, and the night's
 * recap. Every item can be changed or deleted; only the viewer's own nights' memory shows. Loaded when opened.
 */
export default function Memory({ a, b, onScene }: { a: { id: string; name: string }; b: { id: string; name: string }; onScene: (scene: AdultScene) => void }) {
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = (n: string) => n.split(/\s+/)[0];

  async function load() {
    const res = await fetch(`/api/admin/after-dark?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}&memory=1`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { memory: MemoryView }) : null;
    if (!data) return setError("Their memory didn't load. Try again.");
    setError(null);
    setMemory(data.memory);
  }
  /** Saves one edit (null text deletes); whether it went through. */
  async function edit(e: MemoryEdit): Promise<boolean> {
    setBusy(true);
    const res = await requestJson("/api/admin/after-dark", { a: a.id, b: b.id, memory_edit: e }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message ?? "That didn't save. Try again.");
      return false;
    }
    setError(null);
    setMemory(res.data.memory as MemoryView);
    onScene(res.data.scene as AdultScene);
    return true;
  }

  const count = memory ? (memory.notes.a ? 1 : 0) + (memory.notes.b ? 1 : 0) + memory.facts.length + (memory.recap ? 1 : 0) : null;
  return (
    <details className="ad-panel ad-memory" onToggle={(e) => (e.currentTarget.open && !memory ? void load() : undefined)}>
      <summary>🧠 What they remember{count !== null ? ` (${count})` : ""}</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!memory ? (
        !error && <p className="muted small">Loading…</p>
      ) : (
        <>
          {(["a", "b"] as const).map((who) => {
            const self = who === "a" ? a : b;
            const other = who === "a" ? b : a;
            const facts = memory.facts.filter((f) => f.of === who);
            return (
              <section key={who} className="ad-memory-side">
                <h3>
                  <CharacterName character={self} label={first(self.name)} link={false} size={22} /> remembers about {first(other.name)}
                </h3>
                <p className="muted small">The note goes into their public dates and texts, so it stays PG.</p>
                {memory.notes[who] ? (
                  <Item label="Note" text={memory.notes[who]!} max={300} busy={busy} onSave={(text) => edit({ kind: "note", of: who, text })} />
                ) : (
                  <p className="muted small">No note yet: one is written when a night or a chapter is filed.</p>
                )}
                {facts.length ? (
                  <ul className="ad-memory-list">
                    {facts.map((f) => (
                      <li key={f.id}>
                        <Item label={f.kind.replace("_", " ")} text={f.fact} max={200} busy={busy} onSave={(text) => edit({ kind: "fact", id: f.id, text })} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No facts yet.</p>
                )}
              </section>
            );
          })}
          <section className="ad-memory-side">
            <h3>Tonight so far</h3>
            {memory.recap ? (
              <Item label="Recap" text={memory.recap} max={1200} busy={busy} multiline onSave={(text) => edit({ kind: "recap", text })} />
            ) : (
              <p className="muted small">No recap yet: the night gets one when its first chapter is filed.</p>
            )}
          </section>
        </>
      )}
    </details>
  );
}

/** One remembered thing: read, edit in place, or delete (asked once). */
function Item({ label, text, max, busy, multiline = false, onSave }: { label: string; text: string; max: number; busy: boolean; multiline?: boolean; onSave: (text: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [confirming, setConfirming] = useState(false);
  if (editing) {
    return (
      <div className="ad-memory-item editing">
        {multiline ? (
          <textarea aria-label={`Edit the ${label.toLowerCase()}`} value={draft} maxLength={max} rows={4} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <input aria-label={`Edit the ${label.toLowerCase()}`} value={draft} maxLength={max} onChange={(e) => setDraft(e.target.value)} />
        )}
        <span className="ad-memory-buttons">
          <button type="button" className="primary small" disabled={busy || !draft.trim() || draft.trim() === text} onClick={async () => (await onSave(draft.trim())) && setEditing(false)}>
            Save
          </button>
          <button type="button" className="button-ghost small" onClick={() => (setDraft(text), setEditing(false))}>
            Cancel
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="ad-memory-item">
      <span className="badge">{label}</span> <span className="ad-memory-text">{text}</span>
      <span className="ad-memory-buttons">
        {confirming ? (
          <>
            <span className="small">Delete it?</span>
            <button type="button" className="button-ghost small" disabled={busy} onClick={async () => (await onSave(null)) || setConfirming(false)}>
              Yes, delete
            </button>
            <button type="button" className="button-ghost small" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ad-x" aria-label={`Edit the ${label.toLowerCase()}`} title="Edit" onClick={() => (setDraft(text), setEditing(true))}>
              ✎
            </button>
            <button type="button" className="ad-x" aria-label={`Delete the ${label.toLowerCase()}`} title="Delete" onClick={() => setConfirming(true)}>
              ×
            </button>
          </>
        )}
      </span>
    </div>
  );
}
