"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { RATING_CATEGORIES, type RatingCategory } from "@/lib/rules";
import type { RatingCounts, RatingMine } from "@/lib/ratings";
import { trackConversion } from "@/app/conversion";

type Props = { characterId: string; counts: RatingCounts; mine: RatingMine; isOwner: boolean };

/** The audience rating control on a contestant card: a toggle chip per category, with live counts. */
export default function RatingButtons({ characterId, counts, mine, isOwner }: Props) {
  const [state, setState] = useState<{ counts: RatingCounts; mine: RatingMine }>({ counts, mine });
  const [busy, setBusy] = useState<RatingCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(category: RatingCategory) {
    setBusy(category);
    setError(null);
    const res = await requestJson(`/api/characters/${characterId}/ratings`, { category });
    setBusy(null);
    if (res.ok) {
      if (res.data.rated) trackConversion("character_rated", { category });
      setState((s) => ({
        counts: (res.data.counts as RatingCounts) ?? s.counts,
        mine: { ...s.mine, [category]: Boolean(res.data.rated) },
      }));
    } else {
      setError(res.message);
    }
  }

  if (isOwner) {
    return (
      <div className="ratings">
        {RATING_CATEGORIES.map((c) => (
          <span key={c.id} className="rating-chip is-count">
            {c.emoji} {state.counts[c.id]} {c.label.toLowerCase()}
          </span>
        ))}
        <p className="muted">Others rate your character — you can&apos;t rate your own.</p>
      </div>
    );
  }

  return (
    <div className="ratings">
      {RATING_CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`rating-chip${state.mine[c.id] ? " on" : ""}`}
          disabled={busy === c.id}
          aria-pressed={state.mine[c.id]}
          onClick={() => toggle(c.id)}
        >
          <span aria-hidden>{c.emoji}</span> {state.counts[c.id]} <span>{c.label}</span>
        </button>
      ))}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
