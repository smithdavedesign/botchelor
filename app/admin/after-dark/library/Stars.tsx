"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { LibraryItem } from "@/lib/adult/library";

/** One item's stars: the viewer's own (tap a star; tap it again to take it back) and everyone's average. */
export default function Stars({ id, initial }: { id: string; initial: LibraryItem["rating"] }) {
  const [rating, setRating] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rate(n: number) {
    setBusy(true);
    setError(null);
    const stars = rating.mine === n ? null : n;
    const res = await requestJson("/api/admin/after-dark/ratings", { id, stars }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setError(res ? res.message : "Network error.");
    setRating(res.data.rating as LibraryItem["rating"]);
  }

  return (
    <div className="ad-stars">
      <span role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating.mine === n}
            className={`ad-star${rating.mine !== null && n <= rating.mine ? " on" : ""}`}
            disabled={busy}
            onClick={() => void rate(n)}
            title={rating.mine === n ? "Take your rating back" : `${n} star${n === 1 ? "" : "s"}`}
          >
            ★
          </button>
        ))}
      </span>
      <span className="muted small">{rating.count ? `${rating.average} avg · ${rating.count} rating${rating.count === 1 ? "" : "s"}` : "Not rated"}</span>
      {error && (
        <span className="small" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
