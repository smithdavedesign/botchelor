"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import PublishButton from "@/app/showcase/PublishButton";
import type { Media } from "@/lib/adult/media";

/** Joining a chain re-encodes it (the moments route, the one ffmpeg runs in): just under the route's 120 s. */
const TIMEOUT_MS = 115_000;

/**
 * 📣 Post the chain as one reel (David, 2026-11-10: "once we continue from a clip we should be able to post the two
 * clips as one reel for the showcase page"): a clip and the ones kept going from it, joined into one video on the server
 * (lib/adult/moments.ts joinClips: each as its trim keeps it, with its voice), kept in their gallery like a boomerang,
 * then published like any other (the showcase's own 📣, caption and all). Free; the same chain again is the one made.
 */
export default function ChainPublish({ mediaIds, onMade }: { mediaIds: readonly string[]; onMade?: (m: Media) => void }) {
  const [joined, setJoined] = useState<Media | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (mediaIds.length < 2) return null;

  async function join() {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/moments", { action: "join", media_ids: mediaIds }, "POST", { timeoutMs: TIMEOUT_MS }).catch(() => null);
    setBusy(false);
    if (!res) return setNote("That didn't reach the server, or took too long. Try again in a minute.");
    if (!res.ok) return setNote(res.message);
    const media = res.data.media as Media;
    setJoined(media);
    onMade?.(media);
  }

  return (
    <div className="ad-chain-publish">
      {joined ? (
        <>
          <p className="muted small">🎞 All {mediaIds.length} joined into one reel: it&apos;s in the gallery too.</p>
          <PublishButton source="after_dark" mediaId={joined.id} post={joined.post ?? null} startOpen />
        </>
      ) : (
        <button type="button" className="button-ghost small" disabled={busy} onClick={() => void join()} title="Join the clip and every one kept going from it into one video, and post it on the showcase as one reel">
          {busy ? "Joining them…" : `📣 Post all ${mediaIds.length} as one reel`}
        </button>
      )}
      {note && (
        <p className="error small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
