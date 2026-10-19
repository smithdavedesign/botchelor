"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { AdultScene } from "@/lib/adult/scenes";

/** The scene so far, and the way to write more: a few lines at a time, with an optional steer. */
export default function SceneWriter({ initial }: { initial: AdultScene }) {
  const [scene, setScene] = useState(initial);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const nameOf = (who: "a" | "b") => (who === "a" ? scene.a.name : scene.b.name).split(/\s+/)[0];

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    setScene(res.data.scene as AdultScene);
    const held = Number(res.data.held ?? 0);
    if (held) setNote({ text: `${held} line${held === 1 ? "" : "s"} crossed one of the two lines and ${held === 1 ? "was" : "were"} dropped.` });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await send(direction.trim() ? { direction: direction.trim() } : {});
    setDirection("");
  }

  return (
    <section className="after-dark-scene">
      {scene.lines.length ? (
        <ol className="after-dark-lines">
          {scene.lines.map((l, i) => (
            <li key={i} className={`after-dark-line is-${l.who}`}>
              <strong>{nameOf(l.who)}</strong> {l.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing yet. Write the first lines, or steer it first.</p>
      )}
      {note && (
        <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      <form className="after-dark-form" onSubmit={onSubmit}>
        <label htmlFor="after-dark-direction">Steer it (optional)</label>
        <input
          id="after-dark-direction"
          value={direction}
          maxLength={300}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="They go back to hers…"
          disabled={busy}
        />
        <p>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Writing… (a local model can take a minute)" : "Write the next lines"}
          </button>{" "}
          <button type="button" className="button-ghost" disabled={busy || !scene.lines.length} onClick={() => void send({ reset: true })}>
            Start over
          </button>
        </p>
      </form>
    </section>
  );
}
