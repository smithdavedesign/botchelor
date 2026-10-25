"use client";

import { useEffect, useState } from "react";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/**
 * If the pair already has a picture of what's happening in the scene right now (lib/adult/scene-match.ts, found by the
 * theater's useSceneMedia hook; David, 2026-10-24: "show images in the theater if we have one that matches the scene"),
 * a 📷 chip opens it — no drawing, no spend. Nothing shows when there's no match.
 */
export default function SceneMatch({ match }: { match: { image_id: string } | null }) {
  const [open, setOpen] = useState(false);
  // A fresh match (the scene moved on) starts closed.
  useEffect(() => setOpen(false), [match?.image_id]);
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
