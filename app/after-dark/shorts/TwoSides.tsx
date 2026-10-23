"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { TwoSides } from "@/lib/adult/monologues";
import styles from "./shorts.module.css";

const first = (name: string) => name.split(/\s+/)[0] ?? name;

/**
 * Two sides of the night (lib/adult/monologues.ts), side by side: "Her side · His side" (from their pronouns, with their
 * names), each one's page in their own voice, and under them the two texts of the morning after, which disagree.
 */
export function TwoSidesView({ sides }: { sides: TwoSides }) {
  const both = [sides.a, sides.b] as const;
  return (
    <div className={styles.sides}>
      <div className={styles.sidePages}>
        {both.map((s) => (
          <article key={s.id} className={`card ${styles.side}`} aria-label={`${s.label}: ${s.name}`}>
            <h3>
              {s.label} <span className="muted small">· {first(s.name)}</span>
            </h3>
            {s.page
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </article>
        ))}
      </div>
      <h3 className={styles.morningHead}>The morning after</h3>
      <div className={styles.morning}>
        {both.map((s, i) => (
          <p key={s.id} className={styles.bubble}>
            <span className="muted small">
              {first(s.name)} to {first(both[1 - i].name)}
            </span>
            <span>{s.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * A Short's two sides, once the viewer has pressed play: shown when they've been written; otherwise a button writes them
 * (once, for everyone after; counted against this viewer's month).
 */
export function ShortSides({ shortId, initial }: { shortId: string; initial: TwoSides | null }) {
  const [sides, setSides] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function write() {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/sides", { short_id: shortId }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.message ?? "That didn't come through. Try again.");
    setSides(res.data.sides as TwoSides);
  }
  return (
    <section className={styles.sidesSection} aria-label="Two sides of the night">
      <h2>🌗 Two sides of the night</h2>
      {sides ? (
        <TwoSidesView sides={sides} />
      ) : (
        <>
          <p className="muted small">The same night from inside each of their heads, a page each, and the texts they send the morning after.</p>
          <p>
            <button type="button" className="secondary" disabled={busy} onClick={() => void write()}>
              {busy ? "Writing both sides… (about half a minute)" : "Read both sides"}
            </button>
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
