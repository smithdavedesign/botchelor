"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Step in with someone in one click (lib/adult/step-in.ts quickStepIn; David, 2026-11-22: "one click step in, but still
 * allow for role play", as the show's Characters page texts someone in one: app/companion/TalkButton.tsx). With a scene
 * already running with them (`sceneId`) it's a plain link to it. Otherwise the click makes the scene (their place, no
 * roleplay: nothing to choose) and lands on it at once; the scene's page has them open it (`?open=1`). A place, a
 * roleplay or a written opening is the set-up page's (`/after-dark/step-in?with=<id>`), linked beside this.
 *
 * With a `roleplay` (a card on the front page's shelf: ./StepInShelf.tsx) the click starts that story with them: always
 * a new scene, at their place, the viewer on the side named, opened the same way.
 */
export default function StepInButton({
  characterId,
  name,
  sceneId = null,
  className = "button",
  label,
  resumeLabel,
  roleplay = null,
  about,
}: {
  characterId: string;
  /** Their first name, for the button's words and its accessible name. */
  name: string;
  /** The viewer's running scene with them, when there is one. */
  sceneId?: string | null;
  className?: string;
  /** What the button says for a new scene, and for one to pick up; with neither, "Step in with {name}" and "Continue with {name}". */
  label?: string;
  resumeLabel?: string;
  /** One of After Dark's roleplays and the viewer's side of it (0: its first role): a new scene in it, whatever is running. */
  roleplay?: { id: string; you: 0 | 1 } | null;
  /** What the button starts, for its accessible name where several say the same words (a shelf of cards with one person). */
  about?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sceneId && !roleplay) {
    return (
      <Link className={className} href={`/after-dark/step-in/${encodeURIComponent(sceneId)}`} aria-label={`Continue your scene with ${name}`} data-step-in-quick="resume">
        {resumeLabel ?? `Continue with ${name}`}
      </Link>
    );
  }
  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/after-dark/step-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character_id: characterId, quick: true, ...(roleplay ? { roleplay } : {}) }) });
      const data = (await res.json().catch(() => null)) as { id?: string; resumed?: boolean; message?: string } | null;
      if (res.ok && typeof data?.id === "string") {
        // A new scene has nothing said yet: its page has them open it. One picked up is as it was left.
        router.push(`/after-dark/step-in/${encodeURIComponent(data.id)}${data.resumed ? "" : "?open=1"}`);
        return;
      }
      setError(data?.message ?? "That didn't start. Try again in a moment.");
    } catch {
      setError("That didn't start. Check your connection and try again.");
    }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className={className} onClick={() => void go()} disabled={busy} aria-label={about ? `Step in with ${name}: ${about}` : `Step in with ${name}`} data-step-in-quick="start">
        {busy ? "Stepping in…" : (label ?? `Step in with ${name}`)}
      </button>
      {error && (
        <span className="error small ad-step-in-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
