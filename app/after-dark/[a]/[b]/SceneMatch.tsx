"use client";

import { useEffect, useState } from "react";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/**
 * If the pair already has a Studio picture of what's happening in the scene right now (lib/adult/scene-match.ts; David,
 * 2026-10-24: "show images in the theater if we have one that matches the scene"), a 📷 chip in the theater opens it —
 * no drawing, no spend. Checked again each time the scene moves on; nothing shows when there's no match.
 */
export default function SceneMatch({ a, b, shown }: { a: string; b: string; shown: number }) {
  const [match, setMatch] = useState<{ image_id: string } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/after-dark/scene-match?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => r.json())
      .then((d: { match?: { image_id: string } | null }) => {
        if (!live) return;
        setMatch(d.match ?? null);
        setOpen(false);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [a, b, shown]);
  if (!match) return null;
  return (
    <span className="ad-scene-match">
      <button type="button" className="theater-icon" aria-expanded={open} title="You have a picture of this moment" aria-label="Show a picture you have of this moment" onClick={() => setOpen((v) => !v)}>
        📷
      </button>
      {open && (
        <span className="ad-scene-match-pop" role="dialog" aria-label="A picture you have of this moment">
          <img src={mediaUrl(match.image_id)} alt="" />
          <span className="ad-scene-match-note small">You already have this — no need to draw it again.</span>
          <button type="button" className="button-ghost small" onClick={() => setOpen(false)}>
            Close
          </button>
        </span>
      )}
    </span>
  );
}
