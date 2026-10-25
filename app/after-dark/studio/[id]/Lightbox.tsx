"use client";

import { useEffect } from "react";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/**
 * A full-screen viewer for a gallery asset (David, 2026-10-25: "no way to go full screen with the assets … a vertical
 * video on desktop full screen gets cut off"). The asset sits centered and whole — `object-fit: contain`, never
 * cropped, portrait or landscape — over a blurred copy of itself that fills the frame, so there are no stark black bars.
 * Click the backdrop, press Esc, or the ✕ to close. A video plays with controls, looped.
 */
export default function Lightbox({ id, video, onClose }: { id: string; video: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Don't scroll the page behind the viewer while it's open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const src = mediaUrl(id);
  return (
    <div className="ad-lightbox" role="dialog" aria-modal="true" aria-label="Full screen" onClick={onClose}>
      <div className="ad-lightbox-fill" style={{ backgroundImage: video ? undefined : `url(${src})` }} aria-hidden />
      <button type="button" className="ad-lightbox-close" onClick={onClose} aria-label="Close full screen">
        ✕
      </button>
      {/* Stop a click on the asset itself from closing. */}
      {video ? (
        <video className="ad-lightbox-media" src={src} controls autoPlay loop playsInline aria-label="Clip, full screen" onClick={(e) => e.stopPropagation()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- private, presigned media; not for next/image
        <img className="ad-lightbox-media" src={src} alt="Full screen" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}
