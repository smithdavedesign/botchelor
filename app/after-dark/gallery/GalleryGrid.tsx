"use client";

import Link from "next/link";
import { useState } from "react";
import { useInViewAutoplay } from "@/app/useInViewAutoplay";
import { tileRatio } from "@/app/studio/FormatChips";
import type { GalleryItem } from "@/lib/adult/gallery";
import type { Reel } from "@/lib/adult/reels";
import { DEFAULT_FILTER, filterMedia, type MediaFilter } from "@/lib/media-filter";
import RateMedia from "../[a]/[b]/RateMedia";
import MediaFilterBar from "../MediaFilterBar";
import TrimmableClip from "../TrimmableClip";
import ReelTile from "./ReelTile";
import TileTags from "./TileTags";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;
const first = (name: string | null) => (name ?? "").split(/\s+/)[0] || "Someone";

/** Where it was made: the pair's night, or the Studio for a picture of one. */
const homeOf = (m: GalleryItem): { href: string; label: string } | null => {
  if (!m.character_id) return null;
  if (m.character_b) return { href: `/after-dark/${m.character_id}/${m.character_b}`, label: "their night" };
  return { href: `/after-dark/studio/${m.character_id}`, label: "their Studio" };
};

/**
 * The Gallery's grid, one for each tab: the filters on top (MediaFilterBar, lib/media-filter.ts: where it was made, what
 * it is, the pose, the place; no 👎, 1–3★ or Archive by default), then every tile with its tags (TileTags: Night or
 * Studio, and a video's kind), who's in it, what it shows, 👍/👎 (they steer the next pictures, lib/adult/steering.ts)
 * and a link to where it was made. Under Videos the nights' videos are tiles among the clips (ReelTile; David,
 * 2026-11-18: "we have reels and clips, really they are the same thing ... have one combined section ... still offer
 * the filtering at the top"). Its clips play by themselves while on screen, muted, once they're shown
 * (app/useInViewAutoplay.ts).
 */
export default function GalleryGrid({ items }: { items: GalleryItem[] }) {
  const [filter, setFilter] = useState<MediaFilter>(DEFAULT_FILTER);
  const [rated, setRated] = useState<Record<string, 1 | -1 | null>>({});
  // A reel changed in its player (a shot to the Archive, one filmed again), and the one reel playing.
  const [reels, setReels] = useState<Record<string, Reel>>({});
  const [open, setOpen] = useState<string | null>(null);
  const ratingOf = (m: GalleryItem) => (m.id in rated ? rated[m.id] : (m.rating ?? null));
  const shown = filterMedia(items, filter, ratingOf);
  const [grid, setGrid] = useState<HTMLUListElement | null>(null);
  useInViewAutoplay(grid);
  return (
    <>
      <MediaFilterBar items={items} value={filter} onChange={setFilter} ratingOf={ratingOf} shown={shown.length} />
      {shown.length ? (
        <ul className="after-dark-gallery" data-gallery ref={setGrid}>
          {shown.map((m) => {
            if (m.reel) {
              const reel = { ...m.reel, ...reels[m.id] };
              return (
                <ReelTile
                  key={m.id}
                  item={{ ...m, reel }}
                  open={open === m.id}
                  onOpen={() => setOpen(m.id)}
                  onClose={() => setOpen(null)}
                  onChange={(n) => setReels((x) => ({ ...x, [m.id]: n }))}
                />
              );
            }
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
                <TileTags m={m} />
                <span className="small">
                  <strong>{who}</strong>
                  <span className="muted">
                    {m.shows && ` · ${m.shows}`}
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
