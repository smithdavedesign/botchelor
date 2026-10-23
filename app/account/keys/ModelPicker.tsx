"use client";

import { useId, useMemo, useState } from "react";
import { TAG_LABEL, type ModelOption, type ModelTag } from "@/lib/connections-shared";

/** The most rows shown at once: OpenRouter lists hundreds, and the filter narrows them. */
export const SHOWN = 40;
/** Tags a person can filter by (Recommended is always first anyway). */
const FILTER_TAGS: ModelTag[] = ["free", "fast", "vision"];

/**
 * The model step (docs/PRDs/connections.md, M2), the way OpenRouter's and Cursor's pickers do it: the models this key can
 * use, Recommended first, each with its tags (free, fast, vision) and a price hint ("≈ 1¢ a date"). A long list gets a
 * filter box and tag toggles. Radios, so it works with a keyboard and a screen reader.
 */
export default function ModelPicker({
  options,
  value,
  onChange,
  loading = false,
  source,
}: {
  options: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  source?: "provider" | "curated";
}) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<Set<ModelTag>>(new Set());
  const long = options.length > 8;
  const present = FILTER_TAGS.filter((t) => options.some((o) => o.tags.includes(t)));
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => (!q || o.id.toLowerCase().includes(q) || (o.note ?? "").toLowerCase().includes(q)) && [...tags].every((t) => o.tags.includes(t)));
  }, [options, query, tags]);
  const shown = matches.slice(0, SHOWN);
  const chosen = options.find((o) => o.id === value);

  return (
    <div className="model-picker">
      {long && (
        <div className="model-filter">
          <label>
            <span className="sr-only">Filter models</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${options.length} models`} autoComplete="off" />
          </label>
          {present.length > 0 && (
            <div className="model-filter-tags" role="group" aria-label="Show only">
              {present.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip-toggle${tags.has(t) ? " is-on" : ""}`}
                  aria-pressed={tags.has(t)}
                  onClick={() =>
                    setTags((s) => {
                      const next = new Set(s);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                >
                  {TAG_LABEL[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {chosen && long && (
        <p className="muted small model-chosen">
          Picked: <strong>{chosen.id}</strong>
          {chosen.perDate ? ` · ${chosen.perDate}` : ""}
        </p>
      )}
      <div className="model-list" role="radiogroup" aria-label="Model" aria-busy={loading}>
        {shown.map((o) => (
          <label key={o.id} className={`model-row${o.id === value ? " is-picked" : ""}`}>
            <input type="radio" name={`${ids}-model`} value={o.id} checked={o.id === value} onChange={() => onChange(o.id)} />
            <span className="model-row-main">
              <span className="model-id">{o.id}</span>
              {o.note && <span className="muted small">{o.note}</span>}
            </span>
            <span className="model-row-side">
              {o.tags.map((t) => (
                <span key={t} className={`chip model-tag tag-${t}`}>
                  {TAG_LABEL[t]}
                </span>
              ))}
              {o.perDate && <span className="muted small model-price">{o.perDate}</span>}
            </span>
          </label>
        ))}
        {shown.length === 0 && <p className="muted small">No model matches. Clear the filter to see them all.</p>}
      </div>
      <p className="muted small" aria-live="polite">
        {loading
          ? "Loading the models this key can use…"
          : matches.length > SHOWN
            ? `Showing ${SHOWN} of ${matches.length}: type to narrow it down.`
            : source === "curated"
              ? "Our picks for this job (the provider didn't list its models)."
              : null}
        {!loading && options.some((o) => o.perDate) ? " Prices are estimates for one date's worth of lines on your key." : null}
      </p>
    </div>
  );
}
