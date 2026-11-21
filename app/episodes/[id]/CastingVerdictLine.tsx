"use client";

import { useEffect, useState } from "react";
import { okJson } from "@/lib/ok-json";

type Note = { first: string; lead: string; hour: number; minute?: number };

/**
 * The verdict card's one line for a casting date (lib/casting.ts: a new character's first date with the season's lead):
 * when the roses are handed out and that the owner will hear. Its own component, reading its own data
 * (GET /api/casting/walk-on?episode=), so the card itself carries no casting props; it renders nothing for any other date.
 */
export default function CastingVerdictLine({ episodeId }: { episodeId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/casting/walk-on?episode=${encodeURIComponent(episodeId)}`, { credentials: "same-origin" })
      .then(okJson)
      .then((d: { note?: Note | null } | null) => {
        if (live && d?.note) setNote(d.note);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [episodeId]);
  if (!note) return null;
  return (
    <p className="muted small" data-casting-line>
      Roses are handed out Sunday at {String(note.hour).padStart(2, "0")}:{String(note.minute ?? 0).padStart(2, "0")} UTC. {note.first} will text you.
    </p>
  );
}
