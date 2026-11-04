"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptLine } from "@/lib/adult/reels";

/**
 * Pick lines from the night's transcript to add as shots (David, 2026-11-04: "a quick modal popup that allows them to
 * search the transcript for a scene they liked from the chapter and then choosing a few lines"). Up to `max` at once;
 * lines already in the storyboard show but can't be picked again. Search matches the words and who said them.
 */
export default function PickLines({
  reelId,
  names,
  max,
  room,
  onAdd,
  onClose,
}: {
  reelId: string;
  names: { a: string; b: string };
  max: number;
  /** Shots the storyboard still has room for. */
  room: number;
  onAdd: (lines: number[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const first = (name: string) => name.split(/\s+/)[0];
  const limit = Math.max(0, Math.min(max, room));

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/after-dark/reel?transcript=${encodeURIComponent(reelId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { lines?: TranscriptLine[] } | null) => {
        if (!live) return;
        if (d?.lines) setLines(d.lines);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    search.current?.focus();
    return () => {
      live = false;
    };
  }, [reelId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!lines || !q) return lines ?? [];
    return lines.filter((l) => `${l.who === "a" ? names.a : names.b} ${l.text}`.toLowerCase().includes(q));
  }, [lines, query, names]);
  const chapters = new Set((lines ?? []).map((l) => l.chapter)).size > 1;

  const toggle = (i: number) => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : c.length < limit ? [...c, i] : c));

  async function add() {
    setAdding(true);
    const ok = await onAdd([...chosen].sort((x, y) => x - y));
    setAdding(false);
    if (ok) onClose();
  }

  return (
    <div className="ad-storyboard-backdrop ad-pick-backdrop" role="dialog" aria-modal="true" aria-label="Add lines from the transcript" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ad-storyboard ad-pick">
        <div className="ad-storyboard-head">
          <strong>➕ Add from the transcript</strong>
          <span className="small muted">
            {chosen.length}/{limit} picked
          </span>
          <button type="button" className="button-ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="small muted">Find a moment you liked and pick up to {limit} line{limit === 1 ? "" : "s"}: each becomes a shot, in the night&apos;s order.</p>
        <input
          ref={search}
          type="search"
          className="ad-pick-search"
          placeholder="Search the lines…"
          aria-label="Search the transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {failed ? (
          <p className="small ad-storyboard-error">The transcript couldn&apos;t be loaded. Close and try again.</p>
        ) : !lines ? (
          <p className="small muted" role="status">
            Loading the lines…
          </p>
        ) : !shown.length ? (
          <p className="small muted">No line has those words.</p>
        ) : (
          <ol className="ad-pick-lines">
            {shown.map((l) => {
              const on = chosen.includes(l.i);
              const full = !on && chosen.length >= limit;
              return (
                <li key={l.i}>
                  <label className={`ad-pick-line${on ? " is-on" : ""}${l.used ? " is-used" : ""}`}>
                    <input type="checkbox" checked={on || l.used} disabled={l.used || full || adding} onChange={() => toggle(l.i)} />
                    <span>
                      <strong>{first(l.who === "a" ? names.a : names.b)}</strong> {l.text}
                      {(l.used || (chapters && l.chapter !== null)) && (
                        <span className="ad-pick-tag small muted">
                          {[chapters && l.chapter !== null ? `ch. ${l.chapter}` : "", l.used ? "in the storyboard" : ""].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
        )}
        <div className="ad-storyboard-actions">
          <button type="button" className="primary" disabled={!chosen.length || adding} onClick={() => void add()}>
            {adding ? "Adding…" : chosen.length ? `Add ${chosen.length} shot${chosen.length === 1 ? "" : "s"}` : "Pick a line"}
          </button>
          {limit < max && <span className="small muted">The storyboard has room for {limit} more.</span>}
        </div>
      </div>
    </div>
  );
}
