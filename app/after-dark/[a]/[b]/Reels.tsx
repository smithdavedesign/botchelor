"use client";

import { useEffect, useState } from "react";
import type { Reel } from "@/lib/adult/reels";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/**
 * Their videos of the night (lib/adult/reels.ts): each plays its shots in order, with the line as a caption. A reel still
 * being made is polled until it's done (the poll is what moves it along).
 */
export default function Reels({ reels, onChange }: { reels: Reel[]; onChange: (r: Reel) => void }) {
  const making = reels.filter((r) => r.status === "making").map((r) => r.id).join(",");
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(async () => {
      for (const id of making.split(",")) {
        const res = await fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (res?.reel) onChange(res.reel as Reel);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [making, onChange]);

  if (!reels.length) return null;
  return (
    <section>
      <h2>Their videos</h2>
      <ul className="after-dark-reels">
        {reels.map((r) => (
          <li key={r.id}>
            <ReelPlayer reel={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReelPlayer({ reel }: { reel: Reel }) {
  const shots = reel.shots.filter((s) => s.status === "ready" && s.media_id);
  const [i, setI] = useState(0);
  const done = reel.shots.filter((s) => s.status !== "queued").length;
  if (reel.status === "making") {
    return (
      <p className="muted small" role="status">
        🎬 Making the video: {done} of {reel.shots.length} shots done. It takes a few minutes; you can leave and come back.
      </p>
    );
  }
  if (!shots.length) return <p className="muted small">That video didn&apos;t come through, and its tokens are back.</p>;
  const shot = shots[i % shots.length];
  return (
    <figure className="after-dark-reel">
      <video key={shot.media_id} src={mediaUrl(shot.media_id!)} controls autoPlay={i > 0} playsInline onEnded={() => setI((n) => (n + 1 < shots.length ? n + 1 : n))} />
      <figcaption>
        <span className="muted small">
          Shot {(i % shots.length) + 1} of {shots.length}
          {reel.shots.length > shots.length ? ` (${reel.shots.length - shots.length} discarded by the check)` : ""} ·{" "}
        </span>
        “{shot.text}”{" "}
        {i > 0 && (
          <button type="button" className="linklike" onClick={() => setI(0)}>
            From the top
          </button>
        )}
      </figcaption>
    </figure>
  );
}
