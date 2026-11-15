"use client";

import Link from "next/link";
import { useState } from "react";
import { AiTag } from "@/app/AiLabel";
import { chaptersLabel } from "@/lib/adult/nights";
import type { GalleryReel, Reel } from "@/lib/adult/reels";
import { readyShots, SeamlessPlayer } from "../[a]/[b]/Reels";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;
const first = (name: string | null) => (name ?? "").split(/\s+/)[0] || "Someone";

/** What a reel filmed: its chapters ("Whole night, chapters 1–2"), else the whole night or simply their video. */
export const reelLabel = (r: Pick<Reel, "chapters" | "scope">): string =>
  r.chapters?.length ? chaptersLabel(r.chapters) : r.scope === "night" ? "Whole night" : "Their video";

/**
 * The Gallery's Videos → Reels (David, 2026-11-15): each night's video as ONE card, not its shots as loose tiles. The
 * card shows the first shot's keyframe (or the shot itself); ▶ swaps in the pair page's own player (Reels.tsx
 * SeamlessPlayer: shots back to back, captions, theater, 👍/👎, Archive), one open at a time, because that player
 * downloads every shot of its reel as it mounts.
 */
export default function ReelCards({ reels: initial }: { reels: GalleryReel[] }) {
  const [reels, setReels] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const changed = (n: Reel) => setReels((rs) => rs.map((r) => (r.id === n.id ? { ...r, ...n } : r)));
  return (
    <ul className="after-dark-gallery ad-reel-cards" data-reels>
      {reels.map((r) => {
        const shots = readyShots(r);
        const who = `${first(r.a_name)} × ${first(r.b_name)}`;
        const cover = shots[0];
        const playing = open === r.id && shots.length > 0;
        return (
          <li key={r.id} data-reel={r.id} className={playing ? "is-open" : undefined}>
            {playing ? (
              <SeamlessPlayer key={r.id} shots={shots} onChange={changed} autoStart />
            ) : r.status === "making" ? (
              <p className="ad-reel-card-wait muted small" role="status">
                Being filmed… it plays here once it&apos;s in.
              </p>
            ) : cover?.frame_id ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private file from the media route
              <img src={mediaUrl(cover.frame_id)} alt={`The first shot of ${who}'s video`} loading="lazy" />
            ) : cover?.media_id ? (
              <video src={`${mediaUrl(cover.media_id)}#t=0.1`} preload="metadata" muted playsInline aria-label={`The first shot of ${who}'s video`} />
            ) : null}
            <AiTag />
            <span className="small">
              <strong>{who}</strong>
              <span className="muted">
                {" · "}
                {reelLabel(r)}
                {shots.length > 0 && ` · ${shots.length} ${shots.length === 1 ? "shot" : "shots"}`}
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
                <button type="button" className="button-ghost small" onClick={() => setOpen(null)}>
                  Close the player
                </button>
              ) : (
                <button type="button" className="button small" onClick={() => setOpen(r.id)} data-play-reel>
                  ▶ Play the reel
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
