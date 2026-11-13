"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "../Avatar";
import { requestJson } from "../request";

type Visibility = "public" | "private" | "unlisted";
type Side = { id: string; name: string; hue: number | null; house: boolean; portrait: string | null };
type EpisodeCard = {
  episode_id: string;
  share_path: string;
  title: string;
  visibility: Visibility;
  is_host: boolean;
  a: Side;
  b: Side;
};
type DatesPage = { episodes: EpisodeCard[]; page: number; pages: number; total: number; counts: Record<Visibility, number> };

const FILTERS: { id: Visibility | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "public", label: "Public" },
  { id: "unlisted", label: "Unlisted" },
  { id: "private", label: "Private" },
];

/** What each choice means, said once over the list (the chips themselves say one word). */
const VISIBILITY: { id: Visibility; label: string; means: string }[] = [
  { id: "public", label: "Public", means: "in the feed" },
  { id: "unlisted", label: "Unlisted", means: "link only" },
  { id: "private", label: "Private", means: "only you" },
];

/**
 * One date as a compact row (2026-11-13 design lift: each row carried a full-width "Public — in the feed" dropdown and
 * ran to four lines on a phone): the two faces, the title, and who sees it as a small chip, a select when you host it.
 */
export function DateRow({ e, onVisibility }: { e: EpisodeCard; onVisibility: (episodeId: string, visibility: string) => void }) {
  return (
    <li className="account-date">
      <span className="pair-faces" aria-hidden="true">
        <Avatar seed={e.a.id} name={e.a.name} hue={e.a.hue} house={e.a.house} portraitSrc={e.a.portrait} size={32} decorative />
        <Avatar seed={e.b.id} name={e.b.name} hue={e.b.hue} house={e.b.house} portraitSrc={e.b.portrait} size={32} decorative />
      </span>
      <Link href={e.share_path} className="account-date-title">
        {e.title}
      </Link>
      {e.is_host ? (
        <select className="visibility-chip" aria-label={`Who sees ${e.title}`} value={e.visibility} onChange={(ev) => onVisibility(e.episode_id, ev.target.value)}>
          {VISIBILITY.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="chip account-date-chip">{e.visibility}</span>
      )}
    </li>
  );
}

/**
 * The account page's "Your dates": every date the user hosts or whose characters they own, 10 a page, filtered by
 * who sees it. Each row carries both characters' faces, the title and who sees it (DateRow).
 */
export default function YourDates() {
  const [filter, setFilter] = useState<Visibility | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DatesPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page) });
    if (filter) q.set("visibility", filter);
    const d = (await fetch(`/api/me/episodes?${q}`).then((r) => r.json())) as DatesPage;
    // A change of visibility can empty the last page of a filter: step back to the new last one.
    if (d.episodes.length === 0 && d.page > d.pages) setPage(d.pages);
    else setData(d);
  }, [page, filter]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setVisibility(episodeId: string, visibility: string) {
    setData((d) => d && { ...d, episodes: d.episodes.map((e) => (e.episode_id === episodeId ? { ...e, visibility: visibility as Visibility } : e)) });
    const { ok, message } = await requestJson(`/api/episodes/${episodeId}/visibility`, { visibility }, "PATCH").catch(() => ({ ok: false, message: "Network error." }));
    setError(ok ? null : message);
    // Refresh either way: the counts move, and under a filter the date may no longer belong on this list.
    await load();
  }

  const counts = data?.counts;
  const all = counts ? counts.public + counts.private + counts.unlisted : 0;

  return (
    <section className="card" id="your-dates">
      <h2>Your dates</h2>
      {data && all > 0 && (
        <p className="muted small account-dates-legend">
          Who sees each one: {VISIBILITY.map((v, i) => `${i ? " · " : ""}${v.label}, ${v.means}`).join("")}.
        </p>
      )}
      {data && all > 0 && (
        <div className="segmented" role="group" aria-label="Filter by who sees it">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              className="segmented-tab"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setPage(1);
              }}
            >
              {f.label} <span className="segmented-count">{f.id ? counts![f.id] : all}</span>
            </button>
          ))}
        </div>
      )}
      {!data ? (
        <p className="muted" aria-busy="true">Loading…</p>
      ) : data.episodes.length === 0 ? (
        // #1042 (the 2026-10-30 prod loop: "says No dates yet, although After Dark had six scenes"): these are the show's
        // dates; After Dark's scenes are kept apart, and never named here.
        <p className="muted">{all === 0 ? "No dates on the show yet." : `No ${filter} dates.`}</p>
      ) : (
        <ul className="account-dates">
          {data.episodes.map((e) => (
            <DateRow key={e.episode_id} e={e} onVisibility={(id, v) => void setVisibility(id, v)} />
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {data && data.pages > 1 && (
        <nav className="pager" aria-label="Your dates pages">
          {data.page > 1 ? (
            <button type="button" className="link-button" onClick={() => setPage(data.page - 1)}>
              ← Newer
            </button>
          ) : (
            <span />
          )}
          <span className="muted">
            Page {data.page} of {data.pages}
          </span>
          {data.page < data.pages ? (
            <button type="button" className="link-button" onClick={() => setPage(data.page + 1)}>
              Older →
            </button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
