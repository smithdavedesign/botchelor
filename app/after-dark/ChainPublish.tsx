"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import PublishButton from "@/app/showcase/PublishButton";
import type { Media } from "@/lib/adult/media";

/** How often it asks whether the join is in. */
const POLL_MS = 4_000;
/** How long it keeps asking before saying to look in the gallery later (a night joins in a minute or two). */
const GIVE_UP_MS = 10 * 60_000;

/**
 * 📣 Post the chain as one reel (David, 2026-11-10: "once we continue from a clip we should be able to post the two
 * clips as one reel for the showcase page", then the whole night's film): the clips joined into one video on the server
 * (lib/adult/moments.ts joinClips: each as its trim keeps it, with its voice), kept in their gallery like a boomerang,
 * then published like any other (the showcase's own 📣, caption and all). It's made in the background: asked again with
 * the same clips until it's in. Free; the same clips again are the one made.
 */
export default function ChainPublish({ mediaIds, what = "clip", onMade }: { mediaIds: readonly string[]; what?: "clip" | "shot"; onMade?: (m: Media) => void }) {
  const [joined, setJoined] = useState<Media | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (mediaIds.length < 2) return null;

  async function ask(started: number) {
    const res = await requestJson("/api/admin/after-dark/moments", { action: "join", media_ids: mediaIds }).catch(() => null);
    if (res?.ok && res.data.making) {
      if (Date.now() - started > GIVE_UP_MS) {
        setBusy(false);
        return setNote("It's still being joined: it'll be in the gallery when it's done.");
      }
      timer.current = setTimeout(() => void ask(started), POLL_MS);
      return;
    }
    setBusy(false);
    if (!res) return setNote("That didn't reach the server. Try again in a minute.");
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
        <button
          type="button"
          className="button-ghost small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNote(null);
            void ask(Date.now());
          }}
          title={`Join these ${mediaIds.length} ${what}s into one video, and post it on the showcase as one reel`}
        >
          {busy ? `Joining ${mediaIds.length} ${what}s… (a minute or two for a long one)` : `📣 Post all ${mediaIds.length} as one reel`}
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
