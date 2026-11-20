"use client";

import { useEffect, useRef } from "react";
import Sheet from "@/app/Sheet";
import { flush, queueEvent } from "@/app/engagement";
import type { CutLink } from "./ColdOpenCard";

/** Where the short version was opened from: the episode's hero, or the theater's cold open. */
export type CutPlace = "hero" | "cold_open";

/**
 * The date's short version (lib/home-clip.ts episodeCut): the same voiced vertical cut the show posts, in a sheet, playing
 * with sound since a tap opened it. Mounted only while open. Counts, once per opening: `cut_play` when it opens,
 * `cut_ended` and `date_watched` (via "cut") when it plays to its end, else `cut_left` with how far it got.
 */
export default function CutPlayer({ cut, title, place, onClose }: { cut: CutLink; title: string; place: CutPlace; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const counted = useRef(false);
  const settled = useRef(false);
  const of = Math.round(cut.seconds);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    queueEvent("cut_play", { place, of });
    // Opened by a tap, so it may start with its voices; where a browser refuses, the controls are there.
    video.current?.play().catch(() => {});
  }, [place, of]);
  const leave = (via: "close" | "hidden") => {
    if (settled.current) return;
    settled.current = true;
    const at = Math.round(video.current?.currentTime ?? 0);
    queueEvent("cut_left", { place, via, at, of, pct: of ? Math.min(100, Math.round((100 * at) / of)) : 0 });
    if (via === "hidden") flush();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") leaveRef.current("hidden");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  const ended = () => {
    if (settled.current) return;
    settled.current = true;
    queueEvent("cut_ended", { place, of });
    // Watched to its ending, in the short version: the funnel's "watched it end" (lib/engagement.ts) counts it too.
    queueEvent("date_watched", { via: "cut", just_filmed: false, skipped: false, ms_since_start: null });
  };
  return (
    <Sheet
      open
      fit
      title={title}
      onClose={() => {
        leave("close");
        onClose();
      }}
    >
      <video ref={video} className="cut-video" src={cut.src} poster={cut.poster_src} controls playsInline preload="metadata" onEnded={ended} data-cut-place={place} />
    </Sheet>
  );
}
