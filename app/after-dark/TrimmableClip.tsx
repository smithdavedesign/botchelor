"use client";

import { useRef, useState } from "react";
import type { Media } from "@/lib/adult/media";
import type { Trim } from "@/lib/adult/trim";
import MomentTools from "./MomentTools";
import TrimPanel from "./TrimPanel";
import TrimmedVideo from "./TrimmedVideo";

/**
 * A clip tile that plays its trim and, for its owner, trims it (lib/adult/trim.ts; David, 2026-10-25): ✂️ opens the
 * panel under the clip, where "Now" reads this player's time. With `onMoment`, 📸 Moments opens the clip's moments
 * (app/after-dark/MomentTools.tsx: a still of the second it's paused on, a boomerang, a loop), and what's made is handed
 * back for the gallery. The Studio's and the scene gallery's clips.
 */
export default function TrimmableClip({
  id,
  src,
  trim: first = null,
  canTrim,
  label,
  onMoment,
}: {
  id: string;
  src: string;
  trim?: Trim | null;
  canTrim: boolean;
  label: string;
  onMoment?: (m: Media) => void;
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
      <TrimmedVideo ref={video} src={src} trim={trim} controls playsInline preload="metadata" aria-label={label} />
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
