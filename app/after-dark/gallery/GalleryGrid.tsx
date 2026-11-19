"use client";

import Link from "next/link";
import { useState } from "react";
import { AiTag } from "@/app/AiLabel";
import { useInViewAutoplay } from "@/app/useInViewAutoplay";
import { tileRatio } from "@/app/studio/FormatChips";
import type { Media } from "@/lib/adult/media";
import { SOURCE_LABEL, sourceOf, type MediaSource } from "@/lib/adult/gallery";
import { DEFAULT_FILTER, filterMedia, type MediaFilter } from "@/lib/media-filter";
import RateMedia from "../[a]/[b]/RateMedia";
import MediaFilterBar from "../MediaFilterBar";
import TrimmableClip from "../TrimmableClip";

type Item = Media & { a_name: string | null; b_name: string | null };

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;
const first = (name: string | null) => (name ?? "").split(/\s+/)[0] || "Someone";

/** Where it was made: the pair's night, or the Studio for a picture of one. */
const homeOf = (m: Item): { href: string; label: string } | null => {
  if (!m.character_id) return null;
  if (m.character_b) return { href: `/after-dark/${m.character_id}/${m.character_b}`, label: "their night" };
  return { href: `/after-dark/studio/${m.character_id}`, label: "their Studio" };
};

/**
 * The Gallery's grid: the night's filters (lib/media-filter.ts: no 👎, 1–3★ or Archive by default), each tile with who's
 * in it, what it is, 👍/👎 (they steer the next pictures, lib/adult/steering.ts) and a link to where it was made. When
 * it holds both, a first row splits what came from their nights from what came from the Studio (lib/adult/gallery.ts).
 * Its clips play by themselves while on screen, muted, once they're shown (app/useInViewAutoplay.ts; David,
 * 2026-11-18: "videos should play on hover or automatically preferably").
 */
export default function GalleryGrid({ items }: { items: Item[] }) {
  const [filter, setFilter] = useState<MediaFilter>(DEFAULT_FILTER);
  const [source, setSource] = useState<MediaSource | null>(null);
  const [rated, setRated] = useState<Record<string, 1 | -1 | null>>({});
  const ratingOf = (m: Item) => (m.id in rated ? rated[m.id] : (m.rating ?? null));
  const bySource = { night: items.filter((m) => sourceOf(m) === "night"), studio: items.filter((m) => sourceOf(m) === "studio") };
  const both = bySource.night.length > 0 && bySource.studio.length > 0;
  const pool = both && source ? bySource[source] : items;
  const shown = filterMedia(pool, filter, ratingOf);
  const [grid, setGrid] = useState<HTMLUListElement | null>(null);
  useInViewAutoplay(grid);
  return (
    <>
      {both && (
        <div className="media-filter-row ad-gallery-sources" role="group" aria-label="Made where">
          {(["night", "studio"] as const).map((k) => (
            <button key={k} type="button" className={`chip${source === k ? " chip-on" : ""}`} aria-pressed={source === k} onClick={() => setSource(source === k ? null : k)} data-source={k}>
              {SOURCE_LABEL[k]}
              <span className="media-filter-count">{bySource[k].length}</span>
            </button>
          ))}
        </div>
      )}
      <MediaFilterBar items={pool} value={filter} onChange={setFilter} ratingOf={ratingOf} shown={shown.length} />
      {shown.length ? (
        <ul className="after-dark-gallery" data-gallery ref={setGrid}>
          {shown.map((m) => {
            const home = homeOf(m);
            const who = m.character_b ? `${first(m.a_name)} × ${first(m.b_name)}` : first(m.a_name);
            return (
              <li key={m.id} data-media={m.id}>
                {m.kind === "video" ? (
                  m.status === "ready" ? (
                    <TrimmableClip id={m.id} src={mediaUrl(m.id)} trim={m.trim ?? null} canTrim={false} label={`A clip of ${who}`} autoplay />
                  ) : (
                    <p className="muted small">{m.status === "failed" ? "The clip failed." : "Clip on its way…"}</p>
                  )
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(m.id)} alt={`A picture of ${who}`} loading="lazy" style={{ aspectRatio: tileRatio(m.aspect) }} />
                )}
                <AiTag />
                <span className="small">
                  <strong>{who}</strong>
                  <span className="muted">
                    {" · "}
                    {m.shows ?? (m.kind === "video" ? (sourceOf(m) === "studio" ? "Studio clip" : "clip") : m.studio ? "Studio" : "picture")}
                    {home && (
                      <>
                        {" · "}
                        <Link href={home.href}>{home.label}</Link>
                      </>
                    )}
                  </span>
                </span>
                {m.status === "ready" && (
                  <RateMedia id={m.id} kind={m.kind} rating={ratingOf(m)} tags={m.tags ?? []} onRated={(r) => setRated((x) => ({ ...x, [m.id]: r }))} />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Nothing matches these filters.</p>
      )}
    </>
  );
}
