"use client";

import { useRef, useState } from "react";
import type { Trim } from "@/lib/adult/trim";
import TrimPanel from "./TrimPanel";
import TrimmedVideo from "./TrimmedVideo";

/**
 * A clip tile that plays its trim and, for its owner, trims it (lib/adult/trim.ts; David, 2026-10-25): ✂️ opens the
 * panel under the clip, where "Now" reads this player's time. The Studio's and the scene gallery's clips.
 */
export default function TrimmableClip({ id, src, trim: first = null, canTrim, label }: { id: string; src: string; trim?: Trim | null; canTrim: boolean; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [trim, setTrim] = useState<Trim | null>(first);
  const [open, setOpen] = useState(false);
  return (
    <>
      <TrimmedVideo ref={video} src={src} trim={trim} controls playsInline preload="metadata" aria-label={label} />
      {canTrim && (
        <button
          type="button"
          className={`button-ghost small ad-trim-toggle${trim ? " on" : ""}`}
          aria-expanded={open}
          onClick={() => {
            video.current?.pause();
            setOpen((v) => !v);
          }}
        >
          ✂️ {trim ? "Trimmed" : "Trim"}
        </button>
      )}
      {open && <TrimPanel id={id} trim={trim} duration={video.current?.duration ?? NaN} now={() => video.current?.currentTime ?? 0} onSaved={setTrim} onClose={() => setOpen(false)} />}
    </>
  );
}
