"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/** ♥ on a showcase post (lib/showcase-social.ts): signed-in people; a count only once there's one. */
export default function LikeButton({ postId, likes, liked }: { postId: string; likes: number; liked: boolean }) {
  const [now, setNow] = useState({ likes, liked });
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    const res = await requestJson(`/api/showcase/posts/${postId}/like`, { on: !now.liked }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setHint(res?.status === 401 ? "Sign in to like it." : null);
    setNow((x) => ({ likes: x.likes + (x.liked ? -1 : 1), liked: !x.liked }));
  }
  return (
    <span className="showcase-like">
      <button type="button" className={`showcase-like-btn${now.liked ? " on" : ""}`} aria-pressed={now.liked} aria-label={now.liked ? "Liked" : "Like"} disabled={busy} onClick={() => void toggle()}>
        {now.liked ? "♥" : "♡"}
        {now.likes > 0 && <span className="small"> {now.likes}</span>}
      </button>
      {hint && <span className="muted small"> {hint}</span>}
    </span>
  );
}
