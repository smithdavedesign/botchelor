"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/** Follow a creator (lib/showcase-social.ts): their posts in the showcase's Following, a quiet notice when they post. */
export default function FollowButton({ handle, followers, following }: { handle: string; followers: number; following: boolean }) {
  const [now, setNow] = useState({ followers, following });
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    const res = await requestJson(`/api/creators/${handle}/follow`, { on: !now.following }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setHint(res?.status === 401 ? "Sign in to follow." : "That didn't go through.");
    setNow({ followers: Number(res.data.followers), following: Boolean(res.data.following) });
  }
  return (
    <p className="creator-follow">
      <button type="button" className={now.following ? "secondary small" : "primary small"} aria-pressed={now.following} disabled={busy} onClick={() => void toggle()}>
        {now.following ? "Following" : "Follow"}
      </button>{" "}
      <span className="muted small">
        {now.followers} follower{now.followers === 1 ? "" : "s"}
      </span>
      {hint && <span className="muted small"> · {hint}</span>}
    </p>
  );
}
