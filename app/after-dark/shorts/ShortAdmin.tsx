"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/** The owner's undo on a Short's own page (lib/adult/shorts.ts setShortPublished): take it down, or put it back up. */
export default function ShortAdmin({ id, published: initial }: { id: string; published: boolean }) {
  const [published, setPublished] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  async function toggle() {
    setBusy(true);
    const res = await requestJson("/api/admin/after-dark/shorts", { id, published: !published }, "PATCH").catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't go through. Try again.", error: true });
    setPublished(!published);
    setNote({ text: published ? "Taken down: viewers no longer see it, or its teaser." : "Published again." });
  }
  return (
    <p className="muted small">
      {published ? "Published: entitled viewers can watch it." : "Taken down: only you see it."}{" "}
      <button type="button" className="button-ghost small" disabled={busy} onClick={() => void toggle()}>
        {published ? "Take it down" : "Publish it again"}
      </button>
      {note && (
        <span className={note.error ? "error" : undefined} role="status">
          {" "}
          {note.text}
        </span>
      )}
    </p>
  );
}
