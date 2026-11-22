"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type View = {
  switched_on: boolean;
  season: { id: string; label: string; path: string; phase: "preseason" | "season" } | null;
  lead: { id: string; name: string } | null;
  pins: { id: string; shows: boolean }[];
  showing: { id: string; names: string; title: string | null; pinned: boolean }[];
};

const SLOTS = 3;

/**
 * The season page's starters (lib/season-page.ts; docs/season-page.md): a quiet fold with the three dates the lead
 * season's "Start here" box shows now, and up to three pins (episode ids or links) to choose them instead. A pin must
 * be one of the lead's aired public dates that passes the same checks, and drops out by itself if it stops passing.
 * Admin account or password, like the panels around it.
 */
export default function StartersPanel() {
  const [view, setView] = useState<View | null>(null);
  const [slots, setSlots] = useState<string[]>(Array(SLOTS).fill(""));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (data: View) => {
    setView(data);
    setSlots(Array.from({ length: SLOTS }, (_, i) => data.pins[i]?.id ?? ""));
  };

  useEffect(() => {
    fetch("/api/admin/season-starters")
      .then(async (res) => (res.ok ? show((await res.json()) as View) : null))
      .catch(() => {});
  }, []);

  async function save(ids: string[]) {
    if (!view?.season) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/admin/season-starters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season_id: view.season.id, episode_ids: ids.map((s) => s.trim()).filter(Boolean) }),
      });
      const data = (await res.json().catch(() => ({}))) as View & { note?: string; message?: string; failing?: string[] };
      if (!res.ok) setError(`${data.message ?? "That didn't work."}${data.failing?.length ? ` (${data.failing.join(", ")})` : ""}`);
      else {
        show(data);
        setNote(data.note ?? null);
      }
    } catch {
      setError("Network error.");
    }
    setBusy(false);
  }

  // Not authorized, or still loading: the season panel above already says so.
  if (!view) return null;
  const pinned = view.pins.length;
  return (
    <details className="ux-fold admin-starters" id="season-starters">
      <summary>Season page starters ({pinned ? `${pinned} pinned` : "automatic"})</summary>
      {!view.season ? (
        <p className="muted small">Neither this season nor the next runs a lead format, so no season page shows starters.</p>
      ) : (
        <>
          <p className="muted small">
            <Link href={view.season.path}>{view.season.label}&apos;s page</Link> opens on three of {view.lead?.name ?? "the lead"}&apos;s dates, picked by
            itself: one a partner, a mix of endings, best first. Pin up to three (an episode&apos;s id or link) to choose them instead.
            {view.switched_on ? "" : " Switched off (SEASON_PAGE_LIVE=0): the page isn't live."}
          </p>
          {view.showing.length > 0 ? (
            <ol className="small admin-invites-list" aria-label="What the box shows now">
              {view.showing.map((s) => (
                <li key={s.id}>
                  <Link href={`/episodes/${s.id}`}>{s.names}</Link>
                  {s.title ? ` “${s.title}”` : ""} {s.pinned && <span className="badge">pinned</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted small">Nothing qualifies yet, so the page shows no box.</p>
          )}
          {view.pins.some((p) => !p.shows) && (
            <p className="small error">Not showing (they no longer pass the checks): {view.pins.filter((p) => !p.shows).map((p) => p.id).join(", ")}</p>
          )}
          <form
            className="admin-invites-make"
            onSubmit={(e) => {
              e.preventDefault();
              void save(slots);
            }}
          >
            {slots.map((value, i) => (
              <input
                key={i}
                type="text"
                maxLength={300}
                placeholder={`Pin ${i + 1}: episode id or link`}
                value={value}
                onChange={(e) => setSlots((all) => all.map((s, j) => (j === i ? e.target.value : s)))}
                aria-label={`Pin ${i + 1}`}
              />
            ))}
            <button type="submit" className="primary small" disabled={busy}>
              {busy ? "Saving…" : "Save pins"}
            </button>
            {pinned > 0 && (
              <button type="button" className="secondary small" disabled={busy} onClick={() => void save([])}>
                Clear
              </button>
            )}
          </form>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          {note && <p className="notice small">{note}</p>}
        </>
      )}
    </details>
  );
}
