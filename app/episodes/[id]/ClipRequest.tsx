"use client";

import { useEffect, useState } from "react";
import ClipActions from "@/app/clips/ClipActions";
import { requestJson } from "@/app/request";
import type { ClipView } from "@/lib/clip-requests";

/** How often a waiting clip asks whether it's ready (one Mac renders them, a few minutes each). */
const POLL_MS = 15_000;

/**
 * "Make a clip to post" (lib/clip-requests.ts), for the owner of one side of a finished date: a short vertical clip of
 * it, credited to them, to post to their own followers. Then "rendering, we'll tell you", then the clip with Download,
 * Share and a caption. Its own small component, apart from VerdictCard, on the episode page below the share area.
 * `price`: what this press costs ("your first one is free", "1 bought date"); `initial`: a request already made.
 */
export default function ClipRequest({ episodeId, characterId, initial, price }: { episodeId: string; characterId: string; initial: ClipView | null; price: string }) {
  const [clip, setClip] = useState<ClipView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = clip?.status === "queued" || clip?.status === "rendering";

  useEffect(() => {
    if (!waiting || !clip) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/clips/${encodeURIComponent(clip.id)}`).catch(() => null);
      const got = res?.ok ? ((await res.json().catch(() => null)) as { clip?: ClipView } | null)?.clip : null;
      if (got && got.status !== clip.status) setClip(got);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, clip]);

  async function ask() {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/clips", { episode_id: episodeId, character_id: characterId }).catch(() => null);
    setBusy(false);
    const got = res?.ok ? ((res.data as { clip?: ClipView }).clip ?? null) : null;
    if (!got) return setError(res?.message ?? "That didn't go through. Try again.");
    setClip(got);
  }

  return (
    <section className="card clip-request" aria-label="A clip to post" data-clip-request={clip?.status ?? "none"}>
      <h2>🎬 Post this date</h2>
      {clip?.status === "ready" ? (
        <>
          <p className="muted small">Your clip: the best lines, voiced, and how it ended, credited &ldquo;{clip.credit}&rdquo;.</p>
          <ClipActions clip={clip} owner />
          <p className="muted small">
            <a href={clip.page}>Its own page</a> plays it for anyone you send the link to.
          </p>
        </>
      ) : waiting ? (
        <p role="status">Rendering your clip. We&apos;ll tell you when it&apos;s ready (usually within the hour).</p>
      ) : (
        <>
          <p className="muted small">
            A short vertical video of this date, with your character&apos;s art, the best lines voiced, how it ended and your credit, ready for
            TikTok, Reels or Shorts.
          </p>
          {clip?.status === "failed" && <p className="muted small">The last one couldn&apos;t be made. Nothing was charged for it.</p>}
          <p>
            <button type="button" className="button small" onClick={() => void ask()} disabled={busy} data-track="clip-request">
              {busy ? "Asking…" : "Make a clip to post"}
            </button>
            {!busy && <span className="muted small"> · {price}</span>}
          </p>
        </>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
