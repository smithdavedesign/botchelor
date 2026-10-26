"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { Media } from "@/lib/adult/media";
import FixCompare from "./FixCompare";

/**
 * 🩹 Fix faces (lib/adult/fix-faces.ts): one of their pictures with only its faces redrawn, each the face that person
 * keeps, kept beside the original, then a before and after to compare. Free, counted against the month's pictures.
 * Bolder (`nudge`) when they've just said it doesn't look like them.
 */
export default function FixFaces({ id, src, label, onFixed, nudge = false }: { id: string; src: (id: string) => string; label: string; onFixed?: (picture: Media) => void; nudge?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Media | null>(null);

  async function fix() {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/fix-faces", { media_id: id }, "POST", { timeoutMs: 290_000 }).catch(() => null);
    setBusy(false);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    const picture = res.data.picture as Media;
    setFixed(picture);
    onFixed?.(picture);
  }

  if (fixed) {
    return (
      <div className="ad-fix" role="status">
        <FixCompare before={src(id)} after={src(fixed.id)} label={label} />
        <p className="small muted">
          Kept beside the original: both are in the gallery.{" "}
          <button type="button" className="linklike" onClick={() => setFixed(null)}>
            Done
          </button>
        </p>
      </div>
    );
  }
  return (
    <div className={`ad-fix${nudge ? " nudge" : ""}`}>
      {nudge && <p className="small">Only the faces get redrawn, each from the face they keep. Free.</p>}
      <button type="button" className={`small ${nudge ? "secondary" : "button-ghost"}`} disabled={busy} onClick={() => void fix()} title="Redraw only the faces, each the face they keep (free)">
        {busy ? "Fixing the faces… about a minute" : "🩹 Fix faces"}
      </button>
      {error && (
        <p className="error small" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
