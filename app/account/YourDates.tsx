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

/**
 * The account page's "Your dates": every date the user hosts or whose characters they own, 10 a page, filtered by
 * who sees it. Each row carries both characters' avatars, one on each side, so a date reads at a glance.
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
        <p className="muted">{all === 0 ? "No dates yet." : `No ${filter} dates.`}</p>
      ) : (
        <ul className="account-dates">
          {data.episodes.map((e) => (
            <li key={e.episode_id}>
              <Avatar seed={e.a.id} name={e.a.name} hue={e.a.hue} house={e.a.house} portraitSrc={e.a.portrait} size={36} />
              <div className="account-date-main">
                <Link href={e.share_path}>{e.title}</Link>
                {e.is_host ? (
                  <label className="visibility-pick">
                    <span className="muted small">who sees it</span>
                    <select value={e.visibility} onChange={(ev) => setVisibility(e.episode_id, ev.target.value)}>
                      <option value="public">Public — in the feed</option>
                      <option value="unlisted">Unlisted — link only</option>
                      <option value="private">Private — only me</option>
                    </select>
                  </label>
                ) : (
                  <span className="badge">{e.visibility}</span>
                )}
              </div>
              <Avatar seed={e.b.id} name={e.b.name} hue={e.b.hue} house={e.b.house} portraitSrc={e.b.portrait} size={36} />
            </li>
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
