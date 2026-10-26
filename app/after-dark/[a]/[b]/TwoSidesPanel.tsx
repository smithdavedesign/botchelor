"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import { TwoSidesView } from "@/app/after-dark/shorts/TwoSides";
import type { SidesNight, TwoSides } from "@/lib/adult/monologues";
import styles from "@/app/after-dark/shorts/shorts.module.css";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * 🌗 Two sides of the night, on a pair's page (lib/adult/monologues.ts): the viewer's own whole nights, each one's
 * inner monologue of it and their morning-after texts. Written once a night (counted against the month), then kept.
 * Loaded when opened.
 */
export default function TwoSidesPanel({ a, b, flat = false }: { a: { id: string }; b: { id: string }; flat?: boolean }) {
  const [panel, setPanel] = useState<{ nights: SidesNight[]; left: number | null } | null>(null);
  const [open, setOpen] = useState<{ id: string; sides: TwoSides } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/after-dark/sides?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { panel: { nights: SidesNight[]; left: number | null } }) : null;
    if (!data) return setError("Their nights didn't load. Try again.");
    setError(null);
    setPanel(data.panel);
  }
  async function read(n: SidesNight) {
    setBusy(n.id);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/sides", { night_id: n.id }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError(res?.message ?? "That didn't come through. Try again.");
    setOpen({ id: n.id, sides: res.data.sides as TwoSides });
    if (res.data.written) void load();
  }

  // On the page's Two sides tab (flat): open, and loaded as it shows.
  useEffect(() => {
    if (flat && !panel) void load();
    // Once, when the tab first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

  return (
    <details className={`ad-panel ad-two-sides${flat ? " is-flat" : ""}`} open={flat || undefined} onToggle={(e) => (e.currentTarget.open && !panel ? void load() : undefined)}>
      <summary>🌗 Two sides of the night</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!panel ? (
        !error && <p className="muted small">Loading…</p>
      ) : (
        <>
          <p className="muted small">
            Each of them alone with their thoughts about one of their whole nights, a page each in their own voice, and the texts they send the morning after.
            Written once a night, then kept{panel.left !== null ? `: ${panel.left} left to write this month` : ""}.
          </p>
          {panel.nights.length ? (
            <ul className={styles.nights}>
              {panel.nights.map((n) => (
                <li key={n.id} className={styles.night}>
                  <span className={styles.row}>
                    <strong>
                      {day(n.filed_at)} · {n.chapters} chapter{n.chapters === 1 ? "" : "s"} · {n.lines} lines
                    </strong>
                    {n.complete ? (
                      <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void read(n)}>
                        {busy === n.id ? "Writing both sides… (about half a minute)" : n.written ? "Read both sides" : "Write both sides"}
                      </button>
                    ) : (
                      <span className="muted small">Still going: Start over files it, then both sides can be written.</span>
                    )}
                  </span>
                  {open?.id === n.id && <TwoSidesView sides={open.sides} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No saved nights yet: Start over files the night that ran.</p>
          )}
        </>
      )}
    </details>
  );
}
