"use client";

import { useRef, useState } from "react";
import { AUTOPLAY_ATTR } from "@/app/useInViewAutoplay";
import type { Media } from "@/lib/adult/media";
import type { Trim } from "@/lib/adult/trim";
import MomentTools from "./MomentTools";
import TrimPanel from "./TrimPanel";
import TrimmedVideo from "./TrimmedVideo";

/**
 * A clip tile that plays its trim and, for its owner, trims it (lib/adult/trim.ts; David, 2026-10-25): ✂️ opens the
 * panel under the clip, where "Now" reads this player's time. With `onMoment`, 📸 Moments opens the clip's moments
 * (app/after-dark/MomentTools.tsx: a still of the second it's paused on, a boomerang, a loop), and what's made is handed
 * back for the gallery. The Studio's and the scene gallery's clips. With `autoplay` (the Gallery's grid, 2026-11-18) it
 * plays muted and looping while it's on screen (app/useInViewAutoplay.ts, the grid's), except while a panel is open.
 * `poster`: the picture it was made from (lib/adult/media.ts Media.poster), shown until it plays; a tile with no tools
 * then loads nothing of the clip before it plays (the 2026-11-22 audit: each tile fetched its video's start to show a frame).
 */
export default function TrimmableClip({
  id,
  src,
  trim: first = null,
  canTrim,
  label,
  onMoment,
  autoplay = false,
  poster = null,
}: {
  id: string;
  src: string;
  trim?: Trim | null;
  canTrim: boolean;
  label: string;
  onMoment?: (m: Media) => void;
  autoplay?: boolean;
  poster?: string | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [trim, setTrim] = useState<Trim | null>(first);
  const [open, setOpen] = useState<"trim" | "moments" | null>(null);
  const toggle = (what: "trim" | "moments") => {
    video.current?.pause();
    setOpen((v) => (v === what ? null : what));
  };
  return (
    <>
      <TrimmedVideo
        ref={video}
        src={src}
        trim={trim}
        controls
        playsInline
        poster={poster ? `/api/admin/after-dark/media/${encodeURIComponent(poster)}?w=640` : undefined}
        // ✂️ and 📸 read the clip's length, so a tile with them still loads that much.
        preload={poster && !canTrim && !onMoment ? "none" : "metadata"}
        aria-label={label}
        {...(autoplay ? { muted: true, loop: true, ...(open ? {} : { [AUTOPLAY_ATTR]: "" }) } : {})}
      />
      {canTrim && (
        <button type="button" className={`button-ghost small ad-trim-toggle${trim ? " on" : ""}`} aria-expanded={open === "trim"} onClick={() => toggle("trim")}>
          ✂️ {trim ? "Trimmed" : "Trim"}
        </button>
      )}
      {onMoment && (
        <button type="button" className="button-ghost small ad-trim-toggle" aria-expanded={open === "moments"} onClick={() => toggle("moments")} title="Save a still of this moment, or make a boomerang or a loop">
          📸 Moments
        </button>
      )}
      {open === "trim" && <TrimPanel id={id} trim={trim} duration={video.current?.duration ?? NaN} now={() => video.current?.currentTime ?? 0} onSaved={setTrim} onClose={() => setOpen(null)} />}
      {open === "moments" && onMoment && <MomentTools mediaId={id} now={() => video.current?.currentTime ?? 0} pause={() => video.current?.pause()} onMedia={onMoment} />}
    </>
  );
}
