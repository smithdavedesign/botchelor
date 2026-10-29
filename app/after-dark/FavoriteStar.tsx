"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/** ⭐ on a picture or clip of theirs (media_favorites): starred ones gather under the gallery's Favorites. */
export default function FavoriteStar({ id, on = false, onChange }: { id: string; on?: boolean; onChange?: (on: boolean) => void }) {
  const [now, setNow] = useState(on);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const res = await requestJson("/api/admin/after-dark/favorites", { media_id: id, on: !now }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return;
    setNow(!now);
    onChange?.(!now);
  }
  return (
    <button type="button" className={`ad-rate-btn${now ? " on" : ""}`} aria-pressed={now} aria-label={now ? "A favorite" : "Make it a favorite"} title={now ? "A favorite: tap to take the star away" : "Make it a favorite"} disabled={busy} onClick={() => void toggle()}>
      {now ? "★" : "☆"}
    </button>
  );
}
