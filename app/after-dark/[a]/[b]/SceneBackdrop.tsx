"use client";

import { useEffect, useRef, useState } from "react";
import { SHOWN_ATTR } from "@/lib/adult/discreet";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

export type Backdrop = { kind: "clip" | "image"; id: string };

/**
 * Media the pair already has of the moment, standing behind the drawn scene as a living backdrop (lib/adult/scene-match.ts
 * sceneBackdrop; David, 2026-10-24/25: "if they have a short reel like blowjob it can repeat in the background … if we
 * have a fuzzy match for the scene put it as the background"). A clip loops muted (most immersive); a still just sits
 * there. It fades in only once the file has loaded (so the set never flashes), and the viewer can turn it off — then the
 * drawn set shows as before. Nothing renders when there's no match. A new match turns it back on.
 */
export default function SceneBackdrop({ backdrop, onShape }: { backdrop: Backdrop | null; onShape?: (ratio: number | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(true);
  const [ready, setReady] = useState(false);
  // Discreet mode blurs it until shown (app/after-dark/DiscreetMedia.tsx), but a backdrop takes no taps: its own button.
  const [revealed, setRevealed] = useState(false);
  const id = backdrop?.id ?? null;
  // A new backdrop starts hidden until it has loaded (so the set doesn't flash), and re-enabled if it was turned off.
  useEffect(() => {
    setReady(false);
    setOn(true);
    setRevealed(false);
  }, [id]);
  // The theater sizes the stage to the media's own shape (width ÷ height) while it shows; null when nothing does.
  const showing = Boolean(backdrop && on);
  useEffect(() => {
    if (!showing) onShape?.(null);
  }, [showing, onShape]);
  useEffect(() => () => onShape?.(null), [onShape]);
  if (!backdrop || !on) return null;
  const shaped = (w: number, h: number) => {
    if (w > 0 && h > 0) onShape?.(w / h);
  };
  return (
    <>
      {/*
        The whole frame, never cropped (David, 2026-10-25: "fit the video in it… doesn't cut off the scene"), over a
        blurred copy of itself stretched to fill the rest, the way a player fills the bars around a video.
      */}
      {backdrop.kind === "clip" ? (
        <>
          <video ref={fill} className={`ad-scene-backdrop-fill${ready ? " on" : ""}`} src={mediaUrl(backdrop.id)} muted loop autoPlay playsInline preload="auto" aria-hidden />
          <video
            ref={ref}
            className={`ad-scene-backdrop${ready ? " on" : ""}`}
            src={mediaUrl(backdrop.id)}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            aria-hidden
            onLoadedMetadata={(e) => shaped(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            onCanPlay={() => {
              setReady(true);
              void ref.current?.play().catch(() => {});
              void fill.current?.play().catch(() => {});
            }}
          />
        </>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media, decorative backdrop */}
          <img className={`ad-scene-backdrop-fill${ready ? " on" : ""}`} src={mediaUrl(backdrop.id)} alt="" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media, decorative backdrop */}
          <img
            className={`ad-scene-backdrop${ready ? " on" : ""}`}
            src={mediaUrl(backdrop.id)}
            alt=""
            aria-hidden
            onLoad={(e) => {
              shaped(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
              setReady(true);
            }}
          />
        </>
      )}
      {ready && !revealed && (
        // Only shown in discreet mode (CSS): un-blurs both layers, as a tap on any other picture does.
        <button
          type="button"
          className="ad-scene-backdrop-reveal"
          onClick={(e) => {
            // #1017 (the 2026-10-30 prod loop: "the theater portraits stayed blurred squares the whole time"): Show shows the
            // stage, the two of them included, not only the backdrop. Leaving the page blurs it all again.
            const area = e.currentTarget.closest(".theater-stage") ?? e.currentTarget.parentElement;
            for (const el of area?.querySelectorAll(".ad-scene-backdrop, .ad-scene-backdrop-fill, img, video") ?? []) el.setAttribute(SHOWN_ATTR, "");
            setRevealed(true);
          }}
        >
          👁 Show
        </button>
      )}
      {ready && (
        <button type="button" className="ad-scene-backdrop-off" onClick={() => setOn(false)} title="Show the drawn scene instead" aria-label="Turn off the scene backdrop">
          ⊗ {backdrop.kind === "clip" ? "Clip" : "Photo"}
        </button>
      )}
    </>
  );
}
