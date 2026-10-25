"use client";

import { useEffect, useRef, useState } from "react";
import { ClipHere } from "./MediaMenu";
import SceneMatch from "./SceneMatch";

/**
 * One camera button for all of the theater's capture tools, opening a small panel of the options (David, 2026-10-25:
 * "combine these three into one camera with a modal of the options … save some space"). It gathers: 📸 Picture this
 * moment (a still of the two from the line on screen), 🎞 Clip this moment (a short video), and — when they already have
 * a picture of what's happening — 📷 one they have. The existing ClipHere and SceneMatch are composed as-is, so their
 * pricing, making and the match offer are unchanged. Closes on an outside click or Esc.
 */
export default function CaptureMenu({
  a,
  b,
  at,
  nightId,
  paused,
  onPicture,
  canPicture,
  match,
}: {
  a: string;
  b: string;
  at: number;
  nightId: string | null;
  paused: string | null;
  /** Start the "Picture this moment" flow; null when it isn't offered here (e.g. a replay). */
  onPicture: (() => void) | null;
  /** There's a line on screen to picture. */
  canPicture: boolean;
  match: { image_id: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="ad-capture" ref={box}>
      <button type="button" className={`theater-icon${open ? " on" : ""}`} aria-expanded={open} aria-haspopup="menu" aria-label="Pictures and clips" title="Pictures & clips" onClick={() => setOpen((v) => !v)}>
        📷
      </button>
      {open && (
        <div className="ad-capture-menu" role="menu" aria-label="Pictures and clips">
          {onPicture && (
            <button
              type="button"
              role="menuitem"
              className="ad-capture-item"
              disabled={!canPicture || Boolean(paused)}
              title={paused ?? "A picture of the two of them, from the line on screen"}
              onClick={() => {
                onPicture();
                setOpen(false);
              }}
            >
              <span aria-hidden>📸</span> Picture this moment
            </button>
          )}
          {/* The clip and the match keep their own behaviour; the row label sits beside each. */}
          <div className="ad-capture-item ad-capture-row">
            <ClipHere a={a} b={b} at={at} nightId={nightId} paused={paused} />
          </div>
          {match && (
            <div className="ad-capture-item ad-capture-row">
              <SceneMatch match={match} />
              <span className="small muted">A picture you already have</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
