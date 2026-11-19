"use client";

import Link from "next/link";
import { AUTOPLAY_ATTR } from "@/app/useInViewAutoplay";
import type { GalleryItem } from "@/lib/adult/gallery";
import { chaptersLabel } from "@/lib/adult/nights";
import type { Reel } from "@/lib/adult/reels";
import { readyShots, SeamlessPlayer } from "../[a]/[b]/Reels";
import TileTags from "./TileTags";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;
const first = (name: string | null) => (name ?? "").split(/\s+/)[0] || "Someone";

/** What a reel filmed: its chapters ("Whole night, chapters 1–2"), else the whole night or simply their video. */
export const reelLabel = (r: Pick<Reel, "chapters" | "scope">): string =>
  r.chapters?.length ? chaptersLabel(r.chapters) : r.scope === "night" ? "Whole night" : "Their video";

/**
 * A night's video as one tile among the Gallery's videos (David, 2026-11-15: each night's video as ONE card, not its
 * shots as loose tiles; 2026-11-18: in the one grid with the clips, "they are all still just videos"). Like a clip, its
 * first shot plays by itself, muted, while it's on screen (the grid's app/useInViewAutoplay.ts), from its keyframe; ▶
 * swaps in the pair page's own player (Reels.tsx SeamlessPlayer: shots back to back, captions, theater, 👍/👎, Archive)
 * across the grid, one open at a time, because that player downloads every shot of its reel as it mounts.
 */
export default function ReelTile({ item, open, onOpen, onClose, onChange }: { item: GalleryItem & { reel: Reel }; open: boolean; onOpen: () => void; onClose: () => void; onChange: (r: Reel) => void }) {
  const r = item.reel;
  const shots = readyShots(r);
  const who = `${first(item.a_name)} × ${first(item.b_name)}`;
  const cover = shots[0];
  const playing = open && shots.length > 0;
  return (
    <li data-media={r.id} data-reel={r.id} className={playing ? "is-open" : undefined}>
      {playing ? (
        <SeamlessPlayer key={r.id} shots={shots} onChange={onChange} autoStart />
      ) : r.status === "making" ? (
        <p className="ad-reel-card-wait muted small" role="status">
          Being filmed… it plays here once it&apos;s in.
        </p>
      ) : cover?.media_id ? (
        <video
          src={mediaUrl(cover.media_id)}
          poster={cover.frame_id ? mediaUrl(cover.frame_id) : undefined}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={`The first shot of ${who}'s video`}
          {...{ [AUTOPLAY_ATTR]: "" }}
        />
      ) : null}
      <TileTags m={item} />
      <span className="small">
        <strong>{who}</strong>
        <span className="muted">
          {" · "}
          {reelLabel(r)}
          {item.shows && ` · ${item.shows}`}
          {r.a && r.b && (
            <>
              {" · "}
              <Link href={`/after-dark/${r.a}/${r.b}`}>their night</Link>
            </>
          )}
        </span>
      </span>
      {shots.length > 0 &&
        (playing ? (
          <button type="button" className="button-ghost small" onClick={onClose}>
            Close the player
          </button>
        ) : (
          <button type="button" className="button small" onClick={onOpen} data-play-reel>
            ▶ Play the reel
          </button>
        ))}
    </li>
  );
}
