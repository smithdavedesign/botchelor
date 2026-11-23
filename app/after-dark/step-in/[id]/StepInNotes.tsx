"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { StepInSceneView } from "@/lib/adult/step-in-shared";
import LocalTime from "../../LocalTime";

/** When a note was written, as a day and a time in the viewer's own clock. */
const WHEN = { weekday: "short", hour: "numeric", minute: "2-digit" } as const;
const NOTES = "/api/admin/after-dark/step-in/notes";

const post = (body: unknown) => fetch(NOTES, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * Over a line the character wrote first (lib/adult/step-in-notes.ts): that they did, and when. It reads as any line of
 * theirs otherwise.
 */
export function NoteMark({ at }: { at: string }) {
  return (
    <span className="ad-si-noted muted small" data-step-in-note>
      <span aria-hidden="true">✉ </span>wrote first · <LocalTime iso={at} format={WHEN} />
    </span>
  );
}

/**
 * A note was waiting in this scene and its page is open: they've seen it. Said once, from the browser, so it's only
 * ever a page somebody is looking at that takes the mark away (never a link being prefetched).
 */
export function useNoteSeen(sceneId: string, waiting: boolean): void {
  const told = useRef(false);
  useEffect(() => {
    if (!waiting || told.current) return;
    told.current = true;
    void post({ action: "seen", scene_id: sceneId }).catch(() => {});
  }, [sceneId, waiting]);
}

/**
 * The scene's ⋯ menu's rows for the character writing first. Off for the viewer: where to turn it on (the After Dark
 * account page). On: this scene's own switch ("{name} doesn't write first in this scene"). For an admin, a way to have
 * one written now, to see it work. Plain buttons throughout: the menu sits inside the composer's form.
 */
export function StepInNotesRows({ view, name, onScene }: { view: StepInSceneView; name: string; onScene: (scene: StepInSceneView) => void }) {
  const [busy, setBusy] = useState<"scene" | "now" | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const { notes } = view;
  if (view.ended) return null;

  async function ask(action: "scene" | "now", body: Record<string, unknown>) {
    if (busy) return;
    setBusy(action);
    setSaid(null);
    try {
      const res = await post({ action, scene_id: view.id, ...body });
      const d = (await res.json().catch(() => null)) as { scene?: StepInSceneView; message?: string } | null;
      if (d?.scene) onScene(d.scene);
      if (!res.ok) setSaid(d?.message ?? "That didn't go through. Try again in a moment.");
    } catch {
      setSaid("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!notes.on) {
    return (
      <Link className="button-ghost small" href="/after-dark/account#notes" data-step-in-notes="off">
        ✉ {name} can write to you first: off
      </Link>
    );
  }
  return (
    <>
      <button type="button" className="button-ghost small" disabled={busy !== null} aria-pressed={notes.scene_off} onClick={() => void ask("scene", { off: !notes.scene_off })} data-step-in-notes={notes.scene_off ? "scene-off" : "on"}>
        {notes.scene_off ? `✉ ${name} doesn't write first in this scene` : `✉ ${name} can write first here: on`}
      </button>
      {notes.try_now && !notes.scene_off && (
        <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void ask("now", {})} data-step-in-note-now>
          {busy === "now" ? `${name} is writing…` : `✉ Have ${name} write first now (admins)`}
        </button>
      )}
      {said && (
        <span className="muted small" role="status" data-step-in-notes-said>
          {said}
        </span>
      )}
    </>
  );
}
