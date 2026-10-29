"use client";

import { DEFAULT_PG_FILTER, PG_MADE_LABEL, pgFacets, type PgFilter } from "@/lib/media-filter";
import { PG_GROUPS } from "@/lib/studio/pg-catalog";
import type { PgPicture } from "@/lib/studio/pg";

const PLACES = new Map<string, string>([...(PG_GROUPS.find((g) => g.id === "place")?.options ?? []).map((o) => [o.id, o.label] as [string, string]), ["own", "Your own places"]]);

/**
 * The PG Studio gallery's filters (lib/media-filter.ts): what made a picture, where, PG or suggestive, and what's on the
 * showcase. A chip shows only when there's something behind it, with its count.
 */
export default function PgFilterBar({ items, value, onChange, shown }: { items: readonly PgPicture[]; value: PgFilter; onChange: (f: PgFilter) => void; shown: number }) {
  const f = pgFacets(items);
  const chip = (on: boolean, label: string, patch: Partial<PgFilter>, n: number) => (
    <button key={label} type="button" className={`chip${on ? " chip-on" : ""}`} aria-pressed={on} onClick={() => onChange({ ...value, ...patch })}>
      {label}
      <span className="media-filter-count">{n}</span>
    </button>
  );
  const changed = JSON.stringify(value) !== JSON.stringify(DEFAULT_PG_FILTER);
  if (f.made.length < 2 && !f.place.length && !f.suggestive && !f.posted) return null;
  return (
    <div className="media-filters" role="group" aria-label="Filter these">
      <div className="media-filter-row">
        {f.made.length > 1 && f.made.map(([m, n]) => chip(value.made === m, PG_MADE_LABEL[m], { made: value.made === m ? null : m }, n))}
        {f.suggestive > 0 && f.suggestive < items.length && (
          <>
            {chip(value.rating === "pg", "PG", { rating: value.rating === "pg" ? null : "pg" }, items.length - f.suggestive)}
            {chip(value.rating === "suggestive", "Suggestive", { rating: value.rating === "suggestive" ? null : "suggestive" }, f.suggestive)}
          </>
        )}
        {f.posted > 0 && chip(value.posted, "📣 On the showcase", { posted: !value.posted }, f.posted)}
      </div>
      {f.place.length > 0 && (
        <div className="media-filter-row" role="group" aria-label="Place">
          <span className="media-filter-label small">Place</span>
          {f.place.map(([k, n]) => chip(value.place === k, PLACES.get(k) ?? k.replace(/_/g, " "), { place: value.place === k ? null : k }, n))}
        </div>
      )}
      <p className="muted small media-filter-shown" role="status">
        {shown} shown
        {changed && (
          <>
            {" · "}
            <button type="button" className="linklike" onClick={() => onChange(DEFAULT_PG_FILTER)}>
              Clear the filters
            </button>
          </>
        )}
      </p>
    </div>
  );
}
