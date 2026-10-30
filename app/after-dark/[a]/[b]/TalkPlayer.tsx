"use client";

/**
 * A talking moment playing over the stage (lib/adult/talks.ts): one of them saying the line, with its sound; the theater
 * waits while it plays. Closes itself at the end, or with ✕.
 */
export default function TalkPlayer({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  return (
    <div className="ad-talk-player" role="dialog" aria-label={`${name}, saying it`}>
      <video src={src} autoPlay playsInline controls onEnded={onClose} />
      <button type="button" className="theater-icon ad-talk-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  );
}
