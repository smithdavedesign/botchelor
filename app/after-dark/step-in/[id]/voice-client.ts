/**
 * A piece of a Step in reply, out loud, as the page gets it (app/api/admin/after-dark/step-in/[id]/voice;
 * lib/adult/step-in-voice.ts): asked for by the message and the piece's place in it, answered with the audio itself,
 * held here as a blob link to play and let go of. "Hear it" under a reply and the call both play these.
 */

export type VoicePiece = { ok: true; url: string } | { ok: false; error: string; message: string };

const DOWN = { ok: false as const, error: "network", message: "Their voice didn't come through. Check your connection and try again." };

/** Piece `piece` of a reply's voice, as a link to play. The caller revokes the link when it's done with it. */
export async function fetchVoicePiece(sceneId: string, messageId: string, piece: number, signal?: AbortSignal): Promise<VoicePiece> {
  try {
    const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(sceneId)}/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message_id: messageId, piece }),
      signal,
    });
    if (res.ok && (res.headers.get("content-type") ?? "").startsWith("audio/")) return { ok: true, url: URL.createObjectURL(await res.blob()) };
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    return { ok: false, error: data?.error ?? "voice_down", message: data?.message ?? "Their voice didn't come through. Try again in a moment." };
  } catch {
    return DOWN;
  }
}

/** Plays a link to its end on an element: true when it played through, false when it couldn't play or was stopped. */
export function playOn(el: HTMLAudioElement, url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onFail);
      el.removeEventListener("pause", onPause);
      resolve(ok);
    };
    const onEnded = () => finish(true);
    const onFail = () => finish(false);
    // Paused before its end: someone stopped it (Stop, Interrupt, the call ending).
    const onPause = () => {
      if (!el.ended) finish(false);
    };
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onFail);
    el.addEventListener("pause", onPause);
    el.src = url;
    el.play().catch(onFail);
  });
}
