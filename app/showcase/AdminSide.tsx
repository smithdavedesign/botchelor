"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import type { Post } from "@/lib/showcase";

/**
 * An admin's fix for a post on the wrong side (lib/showcase-moderation.ts reratePost): 🌙 to After Dark at once, or ☀️
 * the PG check again, which brings a picture down to safe for work only if it passes. The page then shows it where it
 * now belongs.
 */
export default function AdminSide({ post }: { post: Post }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function rerate(to: "after_dark" | "check") {
    setBusy(true);
    setNote(to === "check" ? "Checking…" : null);
    const res = await requestJson("/api/admin/showcase", { post_id: post.id, rerate: to }).catch(() => null);
    setBusy(false);
    setNote(res?.ok ? String(res.data.note ?? "Done.") : (res?.message ?? "That didn't go through."));
    if (res?.ok) router.refresh();
  }
  const picture = !post.mime.startsWith("video/");
  return (
    <p className="small showcase-admin-side">
      <span className="muted">Admin: </span>
      {post.rating !== "nsfw" && (
        <button type="button" className="button-ghost small" disabled={busy} onClick={() => void rerate("after_dark")} title="It's explicit: move it to After Dark">
          🌙 Move to After Dark
        </button>
      )}
      {post.rating === "nsfw" && picture && (
        <button type="button" className="button-ghost small" disabled={busy} onClick={() => void rerate("check")} title="Run the PG check again: if it passes, it moves to safe for work">
          ☀️ Check if it&apos;s safe for work
        </button>
      )}
      {note && (
        <span className="muted" role="status">
          {" "}
          {note}
        </span>
      )}
    </p>
  );
}
