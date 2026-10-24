"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { tagsFor } from "@/lib/adult/rating-tags";

type Rated = { rating: 1 | -1 | null; tags: string[] };

/** What's been said on this page since it loaded, by media id: a shot comes back round in a player with it still showing. */
const said = new Map<string, Rated>();

/**
 * 👍/👎 on one of their pictures or videos, and on a 👎 what was off (lib/adult/rating-tags.ts). Their own next pictures
 * and videos of the character steer by it (lib/adult/steering.ts): the face, fixed words, the light. Personal, and never
 * a dataset.
 */
export default function RateMedia({ id, kind, rating = null, tags = [] }: { id: string; kind: string; rating?: 1 | -1 | null; tags?: string[] }) {
  const [now, setNow] = useState<Rated>(() => said.get(id) ?? { rating, tags });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function save(r: 1 | -1 | 0, t: string[]) {
    setBusy(true);
    setFailed(false);
    const res = await requestJson("/api/admin/after-dark/rate", { media_id: id, rating: r, tags: t }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setFailed(true);
    const next: Rated = { rating: r === 0 ? null : r, tags: (res.data.tags as string[] | undefined) ?? [] };
    said.set(id, next);
    setNow(next);
  }
  const offs = Object.entries(tagsFor(kind));
  return (
    <div className="ad-rate">
      <button
        type="button"
        className={`ad-rate-btn${now.rating === 1 ? " on" : ""}`}
        aria-pressed={now.rating === 1}
        aria-label="More like this"
        title="More like this"
        disabled={busy}
        onClick={() => void save(now.rating === 1 ? 0 : 1, [])}
      >
        👍
      </button>
      <button
        type="button"
        className={`ad-rate-btn${now.rating === -1 ? " on" : ""}`}
        aria-pressed={now.rating === -1}
        aria-label="Not right"
        title="Not right: say what's off"
        disabled={busy}
        onClick={() => void save(now.rating === -1 ? 0 : -1, now.tags)}
      >
        👎
      </button>
      {now.rating === -1 && (
        <div className="ad-rate-tags" role="group" aria-label="What's off">
          {offs.map(([k, label]) => {
            const on = now.tags.includes(k);
            return (
              <button
                key={k}
                type="button"
                className={`chip${on ? " chip-on" : ""}`}
                aria-pressed={on}
                disabled={busy}
                onClick={() => void save(-1, on ? now.tags.filter((t) => t !== k) : [...now.tags, k])}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {failed && (
        <span className="error small" role="status">
          That didn&apos;t save. Try again.
        </span>
      )}
    </div>
  );
}
