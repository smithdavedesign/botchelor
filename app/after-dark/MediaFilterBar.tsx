"use client";

import type { Media } from "@/lib/adult/media";
import { DEFAULT_FILTER, MEDIA_TYPE_LABEL, mediaFacets, RATING_LABEL, RATING_VIEWS, type MediaFilter, type RatingView } from "@/lib/media-filter";
import { actLabel, placeLabel } from "@/lib/showcase-labels";

/**
 * The filters over a gallery (lib/media-filter.ts), the same everywhere After Dark lists pictures and clips: what it
 * is, the pose, the place, first person, favorites, the rating (no 👎 or 1–3★ by default) and the Archive. A chip shows
 * only when there's something behind it, with its count.
 */
export default function MediaFilterBar<T extends Media>({ items, value, onChange, ratingOf, shown }: { items: readonly T[]; value: MediaFilter; onChange: (f: MediaFilter) => void; ratingOf?: (m: T) => 1 | -1 | null; shown: number }) {
  const f = mediaFacets(items, ratingOf);
  const chip = (on: boolean, label: string, patch: Partial<MediaFilter>, n?: number) => (
    <button key={label} type="button" className={`chip${on ? " chip-on" : ""}`} aria-pressed={on} onClick={() => onChange({ ...value, ...patch })}>
      {label}
      {n !== undefined && <span className="media-filter-count">{n}</span>}
    </button>
  );
  const changed = JSON.stringify(value) !== JSON.stringify(DEFAULT_FILTER);
  return (
    <div className="media-filters" role="group" aria-label="Filter these">
      <div className="media-filter-row">
        {f.type.length > 1 && f.type.map(([t, n]) => chip(value.type === t, MEDIA_TYPE_LABEL[t], { type: value.type === t ? null : t }, n))}
        {f.pov > 0 && chip(value.pov, "First person", { pov: !value.pov }, f.pov)}
        {f.favorites > 0 && chip(value.favorites, "⭐ Favorites", { favorites: !value.favorites }, f.favorites)}
        {f.archived > 0 && chip(value.archived, "🗄 Archived", { archived: !value.archived }, f.archived)}
        <label className="media-filter-rating small">
          <span className="sr-only">Rating</span>
          <select value={value.rating} onChange={(e) => onChange({ ...value, rating: e.target.value as RatingView })} aria-label="Rating">
            {RATING_VIEWS.map((r) => (
              <option key={r} value={r}>
                {RATING_LABEL[r]}
                {r === "disliked" && f.hidden ? ` (${f.hidden})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {f.act.length > 0 && (
        <div className="media-filter-row" role="group" aria-label="Pose">
          <span className="media-filter-label small">Pose</span>
          {f.act.map(([k, n]) => chip(value.act === k, actLabel(k), { act: value.act === k ? null : k }, n))}
        </div>
      )}
      {f.place.length > 0 && (
        <div className="media-filter-row" role="group" aria-label="Place">
          <span className="media-filter-label small">Place</span>
          {f.place.map(([k, n]) => chip(value.place === k, placeLabel(k), { place: value.place === k ? null : k }, n))}
        </div>
      )}
      <p className="muted small media-filter-shown" role="status">
        {shown} shown
        {value.rating === "good" && f.hidden ? ` · ${f.hidden} with a 👎 or 1–3★ hidden` : ""}
        {changed && (
          <>
            {" · "}
            <button type="button" className="linklike" onClick={() => onChange(DEFAULT_FILTER)}>
              Clear the filters
            </button>
          </>
        )}
      </p>
    </div>
  );
}
